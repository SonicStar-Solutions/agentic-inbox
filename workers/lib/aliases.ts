// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Sending aliases (#89): extra addresses a mailbox receives mail at and can send
 * from. They live in the mailbox settings (`aliases: string[]`). An index of
 * `aliases/<alias>.json` objects in R2 maps an alias back to its mailbox so
 * inbound mail addressed to the alias can be delivered.
 */
import { z } from "zod";
import { isAllowedDomain } from "./domains";

export const MAX_ALIASES = 20;

const EmailSchema = z.string().email();

type Bucket = Pick<R2Bucket, "head" | "get" | "put" | "delete">;

export function aliasKey(alias: string): string {
	return `aliases/${alias.toLowerCase()}.json`;
}

/** The aliases in a settings blob: valid, lowercase, de-duplicated. */
export function aliasesOf(settings: Record<string, unknown> | undefined): string[] {
	const raw = settings?.aliases;
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const a of raw) {
		if (typeof a !== "string") continue;
		const alias = a.trim().toLowerCase();
		if (EmailSchema.safeParse(alias).success && !out.includes(alias)) out.push(alias);
	}
	return out;
}

/**
 * Check a proposed alias list for `mailboxId`. Returns an error message, or null
 * if every alias is on a configured domain and not taken by another mailbox.
 */
export async function validateAliases(
	bucket: Bucket,
	mailboxId: string,
	proposed: unknown,
	domains: string[],
): Promise<string | null> {
	if (proposed === undefined) return null;
	if (!Array.isArray(proposed)) return "aliases must be a list of email addresses";
	if (proposed.length > MAX_ALIASES) return `A mailbox can have at most ${MAX_ALIASES} aliases`;

	const self = mailboxId.toLowerCase();
	const seen = new Set<string>();
	for (const item of proposed) {
		const alias = typeof item === "string" ? item.trim().toLowerCase() : "";
		if (!EmailSchema.safeParse(alias).success) return `"${String(item)}" is not a valid email address`;
		if (alias === self) return "An alias can't be the mailbox's own address";
		if (seen.has(alias)) return `"${alias}" is listed twice`;
		seen.add(alias);
		if (!isAllowedDomain(alias, domains)) return `"${alias}" is not on a configured domain`;
		if (await bucket.head(`mailboxes/${alias}.json`)) return `"${alias}" is already a mailbox`;
		const owner = await bucket.get(aliasKey(alias));
		if (owner) {
			const body = (await owner.json<{ mailbox?: string }>().catch(() => ({}))) as { mailbox?: string };
			if (body.mailbox && body.mailbox.toLowerCase() !== self) return `"${alias}" is already an alias of another mailbox`;
		}
	}
	return null;
}

/** Make the R2 alias index match the new list (add new, remove dropped). */
export async function syncAliasIndex(bucket: Bucket, mailboxId: string, previous: string[], next: string[]): Promise<void> {
	for (const alias of next) {
		if (!previous.includes(alias)) await bucket.put(aliasKey(alias), JSON.stringify({ mailbox: mailboxId.toLowerCase() }));
	}
	for (const alias of previous) {
		if (!next.includes(alias)) await bucket.delete(aliasKey(alias));
	}
}

/** The mailbox that owns `address` as an alias, or null. */
export async function resolveAlias(bucket: Bucket, address: string): Promise<string | null> {
	const obj = await bucket.get(aliasKey(address));
	if (!obj) return null;
	const body = (await obj.json<{ mailbox?: string }>().catch(() => ({}))) as { mailbox?: string };
	return typeof body.mailbox === "string" && body.mailbox ? body.mailbox : null;
}
