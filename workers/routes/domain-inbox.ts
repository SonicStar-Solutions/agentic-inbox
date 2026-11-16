// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * "All inboxes" for a domain: one merged, paginated list across every mailbox on that domain.
 *
 * Each mailbox is its own Durable Object, so a request fans out to all of them in parallel, each
 * returns its newest rows older than the cursor, and the results are merged. The cursor is keyset
 * (date + id of the last row), not an offset, so archiving or deleting a row between pages cannot
 * make the next page skip one. Mutations stay on the per-mailbox routes: every row says which
 * mailbox it belongs to.
 */
import type { Context } from "hono";
import { listMailboxes } from "../lib/email-helpers";
import { parseDomains } from "../lib/domains";
import { findOverlongSearchTerm, MAX_SEARCH_TERM_LENGTH } from "../lib/search";
import {
	decodeCursor,
	encodeCursor,
	mailboxesInDomain,
	mergeNewestFirst,
	sumFolderUnread,
	type Cursor,
} from "../lib/domain-inbox";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";

type DomainContext = Context<{ Bindings: Env }>;

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

type Stub = any;

interface DomainScope {
	mailboxIds: string[];
	stubOf: (mailboxId: string) => Stub;
}

/** The domain's mailboxes and their stubs, or the 404 to return when this deployment doesn't serve it. */
async function resolveDomain(c: DomainContext): Promise<DomainScope | Response> {
	const domain = decodeURIComponent(c.req.param("domain") ?? "").toLowerCase();
	const served = parseDomains(c.env.DOMAINS);
	// No configured domains means "no restriction" (local development), as elsewhere.
	if (!domain || (served.length > 0 && !served.includes(domain))) {
		return c.json({ error: "Not found" }, 404);
	}
	const mailboxIds = mailboxesInDomain(await listMailboxes(c.env.BUCKET), domain).map((m) => m.id);
	const ns = c.env.MAILBOX;
	return { mailboxIds, stubOf: (id) => ns.get(ns.idFromName(id)) as Stub };
}

function pageSize(c: DomainContext): number {
	const n = Number(c.req.query("limit"));
	if (!c.req.query("limit") || Number.isNaN(n)) return DEFAULT_LIMIT;
	return Math.min(Math.max(Math.trunc(n), 1), MAX_LIMIT);
}

function boolQuery(c: DomainContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

type Row = { id: string; date: string; thread_id?: string | null };

/**
 * Tag each mailbox's rows with their mailbox, merge, attach labels (looked up only for the rows
 * that made the page) and work out the cursor for the next page.
 */
async function mergePage(
	scope: DomainScope,
	perMailbox: Row[][],
	limit: number,
): Promise<{ emails: any[]; nextCursor: string | null }> {
	const tagged = perMailbox.map((rows, i) => rows.map((r) => ({ ...r, mailboxId: scope.mailboxIds[i] })));
	const merged = mergeNewestFirst(tagged, limit);
	const fetched = tagged.reduce((n, rows) => n + rows.length, 0);
	// More may exist if rows were dropped by the merge, or some mailbox filled its whole page.
	const mayHaveMore = fetched > merged.length || tagged.some((rows) => rows.length >= limit);
	const last = merged.at(-1);
	const nextCursor = last && mayHaveMore ? encodeCursor({ date: last.date, id: last.id }) : null;

	const labelled = new Map<string, any>();
	await Promise.all(
		scope.mailboxIds.map(async (mailboxId) => {
			const mine = merged.filter((r) => r.mailboxId === mailboxId);
			if (mine.length === 0) return;
			const withLabels: any[] = await scope.stubOf(mailboxId).withLabels(mine);
			for (const row of withLabels) labelled.set(`${mailboxId}\u0000${row.id}`, row);
		}),
	);
	const emails = merged.map((r) => labelled.get(`${r.mailboxId}\u0000${r.id}`) ?? r);
	return { emails, nextCursor };
}

function readCursor(c: DomainContext): Cursor | undefined | Response {
	const parsed = decodeCursor(c.req.query("cursor"));
	return parsed.ok ? parsed.cursor : c.json({ error: "Invalid cursor" }, 400);
}

export async function handleDomainEmails(c: DomainContext) {
	const scope = await resolveDomain(c);
	if (scope instanceof Response) return scope;
	const cursor = readCursor(c);
	if (cursor instanceof Response) return cursor;

	const folder = c.req.query("folder") || Folders.INBOX;
	const threaded = boolQuery(c, "threaded") === true;
	const limit = pageSize(c);

	const [perMailbox, counts] = await Promise.all([
		Promise.all(scope.mailboxIds.map((id) => {
			const stub = scope.stubOf(id);
			const options = { folder, limit, before: cursor };
			return (threaded ? stub.getThreadedEmails(options) : stub.getEmails(options)) as Promise<Row[]>;
		})),
		Promise.all(scope.mailboxIds.map((id) => {
			const stub = scope.stubOf(id);
			return (threaded ? stub.countThreadedEmails(folder) : stub.countEmails({ folder })) as Promise<number>;
		})),
	]);

	const { emails, nextCursor } = await mergePage(scope, perMailbox, limit);
	return c.json({ emails, totalCount: counts.reduce((a, b) => a + b, 0), nextCursor });
}

export async function handleDomainSearch(c: DomainContext) {
	const scope = await resolveDomain(c);
	if (scope instanceof Response) return scope;
	const cursor = readCursor(c);
	if (cursor instanceof Response) return cursor;

	const filters: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
		group_by_thread: c.req.query("group") === "thread",
	};
	const overlong = findOverlongSearchTerm({
		query: filters.query as string, from: filters.from as string | undefined,
		to: filters.to as string | undefined, subject: filters.subject as string | undefined,
	});
	if (overlong) {
		return c.json({ error: `Search parameter "${overlong}" is too long (max ${MAX_SEARCH_TERM_LENGTH} characters)` }, 400);
	}
	const limit = pageSize(c);

	const [perMailbox, counts] = await Promise.all([
		Promise.all(scope.mailboxIds.map((id) =>
			scope.stubOf(id).searchEmails({ ...filters, limit, before: cursor }) as Promise<Row[]>)),
		Promise.all(scope.mailboxIds.map((id) => scope.stubOf(id).countSearchResults(filters) as Promise<number>)),
	]);

	const { emails, nextCursor } = await mergePage(scope, perMailbox, limit);
	return c.json({ emails, totalCount: counts.reduce((a, b) => a + b, 0), nextCursor });
}

export async function handleDomainFolders(c: DomainContext) {
	const scope = await resolveDomain(c);
	if (scope instanceof Response) return scope;
	const perMailbox = await Promise.all(scope.mailboxIds.map((id) => scope.stubOf(id).getFolders()));
	return c.json(sumFolderUnread(perMailbox));
}
