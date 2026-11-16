// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Auto-delete ("retention"): mail older than N days is permanently removed by a daily cron.
 *
 * N is resolved per mailbox: the mailbox's own `retentionDays` setting wins, else the domain's
 * default (R2 `domains/<domain>.json`), else {@link DEFAULT_RETENTION_DAYS}. 0 means keep forever.
 */
import { listMailboxes } from "./email-helpers";
import { readMailboxSettings, type MailboxSettingsBlob } from "./mailbox-settings";
import type { Env } from "../types";

export const DEFAULT_RETENTION_DAYS = 30;
export const MAX_RETENTION_DAYS = 3650;

export type DomainSettingsBlob = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;

function isDays(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_RETENTION_DAYS;
}

/** Returns an error message, or null when [value] is a usable `retentionDays`. */
export function validateRetentionDays(value: unknown, options: { allowNull?: boolean } = {}): string | null {
	if (value === null || value === undefined) {
		return options.allowNull ? null : "retentionDays is required";
	}
	if (!isDays(value)) {
		return `retentionDays must be a whole number of days from 0 to ${MAX_RETENTION_DAYS} (0 keeps mail forever)`;
	}
	return null;
}

/** Days to keep mail in a mailbox: its own setting, else its domain's, else 30. 0 = forever. */
export function resolveRetentionDays(
	mailbox: MailboxSettingsBlob | undefined,
	domain: DomainSettingsBlob | undefined,
): number {
	if (isDays(mailbox?.retentionDays)) return mailbox!.retentionDays as number;
	if (isDays(domain?.retentionDays)) return domain!.retentionDays as number;
	return DEFAULT_RETENTION_DAYS;
}

/** Mail dated before this instant is past its retention. */
export function retentionCutoff(days: number, now: Date = new Date()): string {
	return new Date(now.getTime() - days * DAY_MS).toISOString();
}

export async function readDomainSettings(
	bucket: { get(key: string): Promise<{ json<T>(): Promise<T> } | null> },
	domain: string,
): Promise<DomainSettingsBlob> {
	try {
		const obj = await bucket.get(`domains/${domain.toLowerCase()}.json`);
		if (!obj) return {};
		const parsed = await obj.json<unknown>();
		return parsed && typeof parsed === "object" ? (parsed as DomainSettingsBlob) : {};
	} catch {
		return {};
	}
}

export interface RetentionSummary {
	mailboxes: number;
	deleted: number;
	failed: number;
}

/** One pass over every mailbox. A failing mailbox is logged and skipped, never aborts the rest. */
export async function runRetention(env: Env, now: Date = new Date()): Promise<RetentionSummary> {
	const summary: RetentionSummary = { mailboxes: 0, deleted: 0, failed: 0 };
	const domainCache = new Map<string, DomainSettingsBlob>();

	for (const { id } of await listMailboxes(env.BUCKET)) {
		summary.mailboxes++;
		try {
			const domain = id.split("@")[1]?.toLowerCase() ?? "";
			let domainSettings = domainCache.get(domain);
			if (!domainSettings) {
				domainSettings = await readDomainSettings(env.BUCKET, domain);
				domainCache.set(domain, domainSettings);
			}
			const days = resolveRetentionDays(await readMailboxSettings(env.BUCKET, id), domainSettings);
			if (days === 0) continue;

			const stub = env.MAILBOX.get(env.MAILBOX.idFromName(id));
			const { deleted, attachments } = await stub.purgeOlderThan(retentionCutoff(days, now));
			const keys = attachments.map((a) => `attachments/${a.email_id}/${a.id}/${a.filename}`);
			for (let i = 0; i < keys.length; i += 1000) await env.BUCKET.delete(keys.slice(i, i + 1000));
			summary.deleted += deleted;
		} catch (e) {
			summary.failed++;
			console.error(`Retention failed for ${id}:`, (e as Error).message);
		}
	}
	console.log(`Retention: ${summary.deleted} message(s) deleted across ${summary.mailboxes} mailbox(es), ${summary.failed} failed.`);
	return summary;
}
