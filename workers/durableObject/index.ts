// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/durable-sqlite";
import { eq, and, or, asc, desc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
import { applyMigrations, mailboxMigrations } from "./migrations";
import { splitLikeTerm } from "../lib/search";
import { buildFtsQuery, FTS_SETUP_STATEMENTS } from "../lib/fts";
import { buildReferencesChain, buildThreadingHeaders, generateMessageId, resolveOriginalEmail, validateSender } from "../lib/email-helpers";
import { deliverRaw } from "../lib/send";
import { aliasesOf } from "../lib/aliases";
import { readMailboxSettings } from "../lib/mailbox-settings";
import type { ScheduleRequest, ScheduledEmailSummary } from "../lib/scheduled";
import type { EmailFull } from "../lib/schemas";
import { buildBulkWhere, type BulkRequest } from "../lib/bulk";
import { buildContacts, type Contact, type ContactSource } from "../lib/contacts";

/**
 * SQL expression to normalize email subjects by stripping common
 * reply/forward prefixes (Re:, Fwd:, FW:, AW:, WG:, Réf:, SV:).
 * Used for conversation grouping. Hardcoded to the `subject` column.
 */
const NORMALIZED_SUBJECT_SQL = `LOWER(TRIM(
	REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
		LOWER(subject),
		'aw: ', ''), 'wg: ', ''), 'réf: ', ''), 'sv: ', ''),
		're: ', ''), 'fwd: ', ''), 'fw: ', '')
))`;

const ALLOWED_SORT_COLUMNS = [
	"id",
	"subject",
	"sender",
	"recipient",
	"date",
	"read",
	"starred",
] as const;

type SortColumn = (typeof ALLOWED_SORT_COLUMNS)[number];

/**
 * Map SortColumn string names to Drizzle column references for safe
 * ORDER BY construction (no string interpolation into SQL).
 */
const SORT_COLUMN_MAP = {
	id: schema.emails.id,
	subject: schema.emails.subject,
	sender: schema.emails.sender,
	recipient: schema.emails.recipient,
	date: schema.emails.date,
	read: schema.emails.read,
	starred: schema.emails.starred,
} satisfies Record<SortColumn, typeof schema.emails[keyof typeof schema.emails]>;

interface SearchFilterOptions {
	query: string;
	folder?: string;
	from?: string;
	to?: string;
	subject?: string;
	date_start?: string;
	date_end?: string;
	is_read?: boolean;
	is_starred?: boolean;
	has_attachment?: boolean;
}

interface GetEmailsOptions {
	folder?: string;
	thread_id?: string;
	page?: number;
	limit?: number;
	sortColumn?: SortColumn;
	sortDirection?: "ASC" | "DESC";
}

interface EmailData {
	id: string;
	subject: string;
	sender: string;
	recipient: string;
	cc?: string | null;
	bcc?: string | null;
	date: string;
	body: string;
	read?: boolean;
	starred?: boolean;
	in_reply_to?: string | null;
	email_references?: string | null;
	thread_id?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
}

interface AttachmentData {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

export class MailboxDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;
	db: ReturnType<typeof drizzle>;

	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.db = drizzle(this.ctx.storage, { schema });
		applyMigrations(this.ctx.storage.sql, mailboxMigrations, this.ctx.storage);
		this.#fts = this.#setupFts();
	}

	// ── Live updates (#89) ─────────────────────────────────────────

	/** Browsers connect here (via /api/v1/mailboxes/:id/events) to hear about changes. */
	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return new Response("Expected a WebSocket upgrade", { status: 426 });
		}
		const pair = new WebSocketPair();
		// Hibernation API: the object can be evicted while sockets stay connected.
		this.ctx.acceptWebSocket(pair[1]);
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		// Keep-alive from the client
		if (message === "ping") ws.send("pong");
	}

	async webSocketClose(ws: WebSocket, code: number): Promise<void> {
		try {
			ws.close(code === 1005 ? 1000 : code);
		} catch {
			// already closed
		}
	}

	/** Tell connected browsers that something changed so they refetch. Never throws. */
	#notify(scope: "emails" | "folders" | "scheduled" | "all"): void {
		try {
			const sockets = this.ctx.getWebSockets();
			if (sockets.length === 0) return;
			const message = JSON.stringify({ type: "changed", scope });
			for (const ws of sockets) {
				try {
					ws.send(message);
				} catch {
					// a socket that just closed
				}
			}
		} catch {
			// notifications are best effort
		}
	}

	/** True when the FTS5 index exists and search can use it (#89). */
	#fts = false;

	/**
	 * Create the full-text index if it isn't there yet. All-or-nothing, and never
	 * fatal: if FTS5 is unavailable the mailbox still works and search falls back
	 * to LIKE.
	 */
	#setupFts(): boolean {
		try {
			const sql = this.ctx.storage.sql;
			const exists = [...sql.exec(`SELECT 1 FROM sqlite_master WHERE name = 'emails_fts'`)].length > 0;
			if (!exists) {
				this.ctx.storage.transactionSync(() => {
					for (const statement of FTS_SETUP_STATEMENTS) sql.exec(statement);
				});
			}
			return true;
		} catch (e) {
			console.error("Full-text index unavailable, falling back to LIKE search:", (e as Error).message);
			return false;
		}
	}

	// ── Email CRUD (Drizzle) ───────────────────────────────────────

	async getEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			thread_id,
			page = 1,
			limit: rawLimit = 25,
			sortColumn: rawSortColumn = "date",
			sortDirection = "DESC",
		} = options;

		// Cap pagination limit to prevent unbounded queries
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		const sortColumn: SortColumn = ALLOWED_SORT_COLUMNS.includes(
			rawSortColumn as SortColumn,
		)
			? rawSortColumn
			: "date";

		const offset = (page - 1) * limit;

		const conditions: SQL[] = [];
		if (folder) {
			conditions.push(
				sql`${schema.emails.folder_id} = (SELECT id FROM folders WHERE name = ${folder} OR id = ${folder} LIMIT 1)`,
			);
		}
		if (thread_id) {
			conditions.push(eq(schema.emails.thread_id, thread_id));
		}

		const orderCol = SORT_COLUMN_MAP[sortColumn];
		const orderDir = sortDirection === "ASC" ? asc(orderCol) : desc(orderCol);

		const result = this.db
			.select({
				id: schema.emails.id,
				subject: schema.emails.subject,
				sender: schema.emails.sender,
				recipient: schema.emails.recipient,
				cc: schema.emails.cc,
				bcc: schema.emails.bcc,
				date: schema.emails.date,
				read: schema.emails.read,
				starred: schema.emails.starred,
				in_reply_to: schema.emails.in_reply_to,
				email_references: schema.emails.email_references,
				thread_id: schema.emails.thread_id,
				folder_id: schema.emails.folder_id,
				snippet: sql<string>`SUBSTR(${schema.emails.body}, 1, 300)`,
			})
			.from(schema.emails)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(orderDir)
			.limit(limit)
			.offset(offset)
			.all();

		return result.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
		}));
	}

	/**
	 * Count total emails matching the given filters (for pagination).
	 */
	async countEmails(options: { folder?: string; thread_id?: string } = {}) {
		const { folder, thread_id } = options;
		const conditions: string[] = [];
		const params: (string | number)[] = [];

		if (folder) {
			conditions.push(
				"folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)",
			);
			params.push(folder);
		}

		if (thread_id) {
			conditions.push(`thread_id = ?${params.length + 1}`);
			params.push(thread_id);
		}

		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const row = [
			...this.ctx.storage.sql.exec(
				`SELECT COUNT(*) as total FROM emails ${where}`,
				...params,
			),
		][0] as { total: number } | undefined;

		return row?.total ?? 0;
	}

	// ── Threaded queries (raw SQL — too complex for Drizzle's builder) ──

	async getThreadedEmails(options: GetEmailsOptions = {}) {
		const {
			folder,
			page = 1,
			limit: rawLimit = 25,
		} = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);

		if (!folder) {
			// Fallback to regular getEmails if no folder specified
			return this.getEmails(options);
		}

		const offset = (page - 1) * limit;

		// Thread grouping strategy:
		// For DRAFT folder: group by in_reply_to (the email being replied to).
		//   This ensures reply-drafts to different emails stay separate, even if
		//   they share a thread_id or subject. New drafts (no in_reply_to) each
		//   get their own group via their unique id.
		// For other folders:
		//   1. Primary: group by thread_id (from email threading headers)
		//   2. Fallback: group by normalized subject (strips Re:/Fwd:/FW: prefixes)
		//      for legacy emails that lack threading headers (thread_id IS NULL).
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const result = this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT *,
						COALESCE(in_reply_to, id) as draft_group_key
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				draft_stats AS (
					SELECT
						draft_group_key,
						COUNT(*) as thread_count,
						SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
						GROUP_CONCAT(DISTINCT sender) as participants
					FROM folder_emails
					GROUP BY draft_group_key
				),
				latest_per_group AS (
					SELECT
						fe.*,
						ROW_NUMBER() OVER (
							PARTITION BY fe.draft_group_key
							ORDER BY fe.date DESC
						) as rn
					FROM folder_emails fe
				)
				SELECT
					lp.id, lp.subject, lp.sender, lp.recipient, lp.date,
					lp.read, lp.starred, lp.thread_id, lp.folder_id,
					lp.in_reply_to, lp.email_references,
					SUBSTR(lp.body, 1, 300) as snippet,
					ds.thread_count, ds.thread_unread_count, ds.participants
				FROM latest_per_group lp
				JOIN draft_stats ds ON lp.draft_group_key = ds.draft_group_key
				WHERE lp.rn = 1
				ORDER BY lp.date DESC
				LIMIT ?2 OFFSET ?3`,
				folder, limit, offset
			);

			const rows = [...result];
			return rows.map((row: any) => ({
				...row,
				read: !!row.read,
				starred: !!row.starred,
				thread_count: row.thread_count || 1,
				thread_unread_count: row.thread_unread_count || 0,
				participants: row.participants || row.sender,
			}));
		}

		// Non-draft folders: full threading logic
		const result = this.ctx.storage.sql.exec(
			`WITH
			folder_emails AS (
				SELECT *,
					COALESCE(thread_id, id) as raw_thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
				FROM emails
				WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
			),
			thread_to_conversation AS (
				SELECT
					raw_thread_id,
					normalized_subject,
					CASE
						WHEN thread_id IS NOT NULL THEN raw_thread_id
						ELSE MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
					END as conversation_id
				FROM folder_emails
				GROUP BY raw_thread_id, normalized_subject, thread_id
			),
			all_emails_with_conversation AS (
				SELECT
					e.*,
					COALESCE(tc.conversation_id, COALESCE(e.thread_id, e.id)) as conversation_id
				FROM emails e
				LEFT JOIN thread_to_conversation tc
					ON COALESCE(e.thread_id, e.id) = tc.raw_thread_id
			),
			conversation_stats AS (
				SELECT
					conversation_id,
					COUNT(*) as thread_count,
					SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as thread_unread_count,
					SUM(CASE WHEN read = 1 THEN 1 ELSE 0 END) as thread_read_count,
					GROUP_CONCAT(DISTINCT sender) as participants,
					SUM(CASE WHEN folder_id = (SELECT id FROM folders WHERE name = 'draft' LIMIT 1) THEN 1 ELSE 0 END) as has_draft
				FROM all_emails_with_conversation
				WHERE conversation_id IN (
					SELECT DISTINCT conversation_id FROM all_emails_with_conversation
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				)
				GROUP BY conversation_id
			),
			latest_message_per_conversation AS (
				SELECT
					conversation_id,
					folder_id,
					ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY date DESC) as rn
				FROM all_emails_with_conversation
			),
			latest_in_folder AS (
				SELECT
					fe.*,
					COALESCE(tc.conversation_id, fe.raw_thread_id) as conversation_id,
					ROW_NUMBER() OVER (
						PARTITION BY COALESCE(tc.conversation_id, fe.raw_thread_id)
						ORDER BY fe.date DESC
					) as rn
				FROM folder_emails fe
				LEFT JOIN thread_to_conversation tc
					ON fe.raw_thread_id = tc.raw_thread_id
			)
			SELECT
				lif.id, lif.subject, lif.sender, lif.recipient, lif.date,
				lif.read, lif.starred, lif.thread_id, lif.folder_id,
				lif.in_reply_to, lif.email_references,
				SUBSTR(lif.body, 1, 300) as snippet,
				cs.thread_count, cs.thread_unread_count, cs.participants,
				CASE WHEN lmc.folder_id != (SELECT id FROM folders WHERE name = 'sent' LIMIT 1)
					AND lmc.folder_id != (SELECT id FROM folders WHERE name = 'draft' LIMIT 1)
					AND cs.thread_read_count > 0
					THEN 1 ELSE 0 END as needs_reply,
				CASE WHEN cs.has_draft > 0 THEN 1 ELSE 0 END as has_draft
			FROM latest_in_folder lif
			JOIN conversation_stats cs ON lif.conversation_id = cs.conversation_id
			LEFT JOIN latest_message_per_conversation lmc
				ON lmc.conversation_id = lif.conversation_id AND lmc.rn = 1
			WHERE lif.rn = 1
			ORDER BY lif.date DESC
			LIMIT ?2 OFFSET ?3`,
			folder, limit, offset
		);

		const rows = [...result];
		return rows.map((row: any) => ({
			...row,
			read: !!row.read,
			starred: !!row.starred,
			thread_count: row.thread_count || 1,
			thread_unread_count: row.thread_unread_count || 0,
			participants: row.participants || row.sender,
			needs_reply: !!row.needs_reply,
			has_draft: !!row.has_draft,
		}));
	}

	/**
	 * Count threaded conversations in a folder (for pagination).
	 * Returns the number of conversation groups, not individual emails.
	 */
	async countThreadedEmails(folder: string) {
		const isDraftFolder = folder === Folders.DRAFT;

		if (isDraftFolder) {
			const row = [
				...this.ctx.storage.sql.exec(
					`SELECT COUNT(DISTINCT COALESCE(in_reply_to, id)) as total
					 FROM emails
					 WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)`,
					folder,
				),
			][0] as { total: number } | undefined;
			return row?.total ?? 0;
		}

		const row = [
			...this.ctx.storage.sql.exec(
				`WITH
				folder_emails AS (
					SELECT
						COALESCE(thread_id, id) as raw_thread_id,
						thread_id,
					${NORMALIZED_SUBJECT_SQL} as normalized_subject
					FROM emails
					WHERE folder_id = (SELECT id FROM folders WHERE name = ?1 OR id = ?1 LIMIT 1)
				),
				thread_to_conversation AS (
					SELECT
						raw_thread_id,
						CASE
							WHEN thread_id IS NOT NULL THEN raw_thread_id
							WHEN normalized_subject != '' THEN MIN(raw_thread_id) OVER (PARTITION BY normalized_subject)
							ELSE raw_thread_id
						END as conversation_id
					FROM folder_emails
					GROUP BY raw_thread_id, normalized_subject, thread_id
				)
				SELECT COUNT(DISTINCT conversation_id) as total
				FROM thread_to_conversation`,
				folder,
			),
		][0] as { total: number } | undefined;
		return row?.total ?? 0;
	}

	// ── Single email operations (Drizzle) ──────────────────────────

	async getEmail(id: string) {
		const email = this.db
			.select()
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select()
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		return {
			...email,
			read: !!email.read,
			starred: !!email.starred,
			attachments: emailAttachments,
		};
	}

	/**
	 * Fetch all emails in a thread with full bodies and attachments in
	 * two queries (one for emails, one for attachments) instead of
	 * N+1 individual getEmail calls.
	 */
	async getThreadEmails(threadId: string) {
		const emailRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM emails WHERE thread_id = ?1 ORDER BY date ASC`,
				threadId,
			),
		] as any[];

		if (emailRows.length === 0) return [];

		const emailIds = emailRows.map((e) => e.id as string);

		// Batch-fetch all attachments for the thread in a single query
		const placeholders = emailIds.map((_, i) => `?${i + 1}`).join(",");
		const attachmentRows = [
			...this.ctx.storage.sql.exec(
				`SELECT * FROM attachments WHERE email_id IN (${placeholders})`,
				...emailIds,
			),
		] as any[];

		// Group attachments by email_id
		const attachmentsByEmail = new Map<string, any[]>();
		for (const att of attachmentRows) {
			const list = attachmentsByEmail.get(att.email_id) || [];
			list.push(att);
			attachmentsByEmail.set(att.email_id, list);
		}

		return emailRows.map((email) => ({
			...email,
			read: !!email.read,
			starred: !!email.starred,
			attachments: attachmentsByEmail.get(email.id) || [],
		}));
	}

	async updateEmail(
		id: string,
		{ read, starred }: { read?: boolean; starred?: boolean },
	) {
		this.#notify("emails");
		const data: { read?: number; starred?: number } = {};
		if (read !== undefined) {
			data.read = read ? 1 : 0;
		}
		if (starred !== undefined) {
			data.starred = starred ? 1 : 0;
		}

		if (Object.keys(data).length === 0) {
			return this.getEmail(id);
		}

		this.db
			.update(schema.emails)
			.set(data)
			.where(eq(schema.emails.id, id))
			.run();

		return this.getEmail(id);
	}

	async markThreadRead(threadId: string) {
		this.#notify("emails");
		this.ctx.storage.sql.exec(
			`UPDATE emails SET read = 1 WHERE thread_id = ? AND read = 0`,
			threadId,
		);
		return { threadId, markedRead: true };
	}

	async deleteEmail(id: string) {
		this.#notify("emails");
		const email = this.db
			.select({ id: schema.emails.id })
			.from(schema.emails)
			.where(eq(schema.emails.id, id))
			.get();

		if (!email) return null;

		const emailAttachments = this.db
			.select({
				id: schema.attachments.id,
				filename: schema.attachments.filename,
			})
			.from(schema.attachments)
			.where(eq(schema.attachments.email_id, id))
			.all();

		this.db
			.delete(schema.emails)
			.where(eq(schema.emails.id, id))
			.run();

		return emailAttachments;
	}

	async getAttachment(id: string) {
		return (
			this.db
				.select()
				.from(schema.attachments)
				.where(eq(schema.attachments.id, id))
				.get() ?? null
		);
	}

	// ── Folders (Drizzle) ──────────────────────────────────────────

	async getFolders() {
		const result = this.db
			.select({
				id: schema.folders.id,
				name: schema.folders.name,
				unreadCount: sql<number>`COALESCE(SUM(CASE WHEN ${schema.emails.read} = 0 THEN 1 ELSE 0 END), 0)`.mapWith(Number),
			})
			.from(schema.folders)
			.leftJoin(schema.emails, eq(schema.emails.folder_id, schema.folders.id))
			.groupBy(schema.folders.id, schema.folders.name)
			.all();
		return result;
	}

	async createFolder(id: string, name: string, is_deletable: number = 1) {
		this.#notify("folders");
		try {
			const result = this.db
				.insert(schema.folders)
				.values({ id, name, is_deletable })
				.returning({ id: schema.folders.id, name: schema.folders.name })
				.get();
			return { ...result, unreadCount: 0 };
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("UNIQUE constraint failed")) {
				return null;
			}
			throw e;
		}
	}

	async updateFolder(id: string, name: string) {
		this.#notify("folders");
		// Only custom folders can be renamed; Inbox, Sent, etc. keep their names (#89).
		const existing = this.db
			.select({ is_deletable: schema.folders.is_deletable })
			.from(schema.folders)
			.where(eq(schema.folders.id, id))
			.get();
		if (!existing || existing.is_deletable === 0) return undefined;

		const result = this.db
			.update(schema.folders)
			.set({ name })
			.where(eq(schema.folders.id, id))
			.returning({ id: schema.folders.id, name: schema.folders.name })
			.get();
		return result;
	}

	async deleteFolder(id: string) {
		this.#notify("all");
		const folder = this.db
			.select({ is_deletable: schema.folders.is_deletable })
			.from(schema.folders)
			.where(eq(schema.folders.id, id))
			.get();

		if (!folder || folder.is_deletable === 0) {
			return false;
		}

		// Deleting a folder must not delete its mail (the foreign key cascades):
		// move the messages to Archive first (#89).
		this.ctx.storage.sql.exec(`UPDATE emails SET folder_id = ? WHERE folder_id = ?`, Folders.ARCHIVE, id);

		this.db
			.delete(schema.folders)
			.where(eq(schema.folders.id, id))
			.run();

		return true;
	}

	async moveEmail(id: string, folderId: string) {
		this.#notify("emails");
		const folder = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(eq(schema.folders.id, folderId))
			.get();

		if (!folder) return false;

		this.db
			.update(schema.emails)
			.set({ folder_id: folderId })
			.where(eq(schema.emails.id, id))
			.run();

		return true;
	}

	// ── Search (raw SQL — dynamic condition builder) ───────────────

	/**
	 * Build WHERE conditions and params for search queries.
	 * Shared between searchEmails and countSearchResults.
	 */
	#buildSearchConditions(
		options: SearchFilterOptions,
		tableAlias = "",
	): { conditions: string[]; params: (string | number)[] } {
		const { query, folder, from, to, subject, date_start, date_end, is_read, is_starred, has_attachment } = options;
		const prefix = tableAlias ? `${tableAlias}.` : "";
		const conditions: string[] = [];
		const params: (string | number)[] = [];
		let paramIdx = 0;

		const addParam = (value: string | number) => {
			paramIdx++;
			params.push(value);
			return `?${paramIdx}`;
		};

		// DO SQLite rejects LIKE patterns over 50 bytes, so a long term is split
		// into <=48-byte chunks that are ANDed together (each chunk may match in
		// any of the given columns). Short terms behave exactly as before (#36).
		const likeAny = (columns: string[], term: string): string =>
			splitLikeTerm(term)
				.map((chunk) => {
					const p = addParam(`%${chunk}%`);
					return `(${columns.map((col) => `${prefix}${col} LIKE ${p}`).join(" OR ")})`;
				})
				.join(" AND ");

		if (query) {
			const match = this.#fts ? buildFtsQuery(query) : null;
			if (match) {
				// Indexed word search over subject, body and addresses (#89)
				conditions.push(`${prefix}rowid IN (SELECT rowid FROM emails_fts WHERE emails_fts MATCH ${addParam(match)})`);
			} else {
				const c = likeAny(["subject", "body", "sender", "recipient", "cc", "bcc"], query);
				if (c) conditions.push(`(${c})`);
			}
		}
		if (folder) {
			const p = addParam(folder);
			conditions.push(`${prefix}folder_id = (SELECT id FROM folders WHERE name = ${p} OR id = ${p} LIMIT 1)`);
		}
		if (from) { const c = likeAny(["sender"], from); if (c) conditions.push(`(${c})`); }
		if (to) { const c = likeAny(["recipient", "cc", "bcc"], to); if (c) conditions.push(`(${c})`); }
		if (subject) { const c = likeAny(["subject"], subject); if (c) conditions.push(`(${c})`); }
		if (date_start) { const p = addParam(date_start); conditions.push(`${prefix}date >= ${p}`); }
		if (date_end) { const p = addParam(date_end); conditions.push(`${prefix}date <= ${p}`); }
		if (is_read !== undefined) { const p = addParam(is_read ? 1 : 0); conditions.push(`${prefix}read = ${p}`); }
		if (is_starred !== undefined) { const p = addParam(is_starred ? 1 : 0); conditions.push(`${prefix}starred = ${p}`); }
		if (has_attachment) { conditions.push(`${prefix}id IN (SELECT DISTINCT email_id FROM attachments)`); }

		return { conditions, params };
	}

	async searchEmails(options: SearchFilterOptions & { page?: number; limit?: number }) {
		const { page = 1, limit: rawLimit = 25 } = options;
		const limit = Math.min(Math.max(rawLimit, 1), 100);
		const { conditions, params } = this.#buildSearchConditions(options, "e");

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const offset = (page - 1) * limit;

		const query = `
			SELECT e.id, e.subject, e.sender, e.recipient, e.cc, e.bcc, e.date,
				e.read, e.starred, e.in_reply_to, e.email_references,
				e.thread_id, e.folder_id,
				SUBSTR(e.body, 1, 300) as snippet,
				f.name as folder_name
			FROM emails e
			LEFT JOIN folders f ON e.folder_id = f.id
			${where}
			ORDER BY e.date DESC LIMIT ?${params.length + 1} OFFSET ?${params.length + 2}`;
		params.push(limit, offset);

		const result = this.ctx.storage.sql.exec(query, ...params);
		return [...result].map((row: any) => ({
			...row,
			read: !!row.read,
			starred: !!row.starred,
		}));
	}

	/**
	 * Count total search results matching the given filters (for pagination).
	 */
	async countSearchResults(options: SearchFilterOptions) {
		const { conditions, params } = this.#buildSearchConditions(options);

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const query = `SELECT COUNT(*) as total FROM emails ${where}`;

		const row = [...this.ctx.storage.sql.exec(query, ...params)][0] as
			| { total: number }
			| undefined;
		return row?.total ?? 0;
	}

	// ── Threading helpers (raw SQL) ────────────────────────────────

	async findThreadBySubject(subject: string, senderAddress?: string): Promise<string | null> {
		const normalized = subject
			.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
			.trim()
			.toLowerCase();

		if (!normalized) return null;

		const result = this.ctx.storage.sql.exec(
			`SELECT thread_id, subject,
			        GROUP_CONCAT(DISTINCT LOWER(sender)) as senders,
			        GROUP_CONCAT(DISTINCT LOWER(recipient)) as recipients
			 FROM emails
			 WHERE thread_id IS NOT NULL
			   AND thread_id != id
			   AND date >= datetime('now', '-7 days')
			 GROUP BY thread_id
			 ORDER BY MAX(date) DESC
			 LIMIT 50`,
		);

		const normalizedSender = senderAddress?.toLowerCase().trim();

		for (const row of result) {
			const rowSubject = String((row as any).subject || "")
				.replace(/^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv)\s*:\s*)+/i, "")
				.trim()
				.toLowerCase();
			if (rowSubject !== normalized) continue;

			if (normalizedSender) {
				const threadSenders = String((row as any).senders || "");
				const threadRecipients = String((row as any).recipients || "");
				const allParticipants = `${threadSenders},${threadRecipients}`;
				if (!allParticipants.includes(normalizedSender)) {
					continue;
				}
			}

			return String((row as any).thread_id);
		}
		return null;
	}

	/**
	 * Find the thread of an already-stored message by its RFC 5322 Message-ID.
	 *
	 * `messageIds` is ordered by priority (nearest ancestor first); the thread of
	 * the first one that is stored wins. Returns null if none are stored.
	 */
	async findThreadByMessageIds(messageIds: string[]): Promise<string | null> {
		const ids = [...new Set(messageIds.filter(Boolean))].slice(0, 25);
		if (ids.length === 0) return null;

		const placeholders = ids.map(() => "?").join(", ");
		const rows = this.ctx.storage.sql
			.exec(`SELECT id, thread_id, message_id FROM emails WHERE message_id IN (${placeholders})`, ...ids)
			.toArray();

		for (const id of ids) {
			const row = rows.find((r) => (r as any).message_id === id) as any;
			if (row) return String(row.thread_id || row.id);
		}
		return null;
	}

	// ── Scheduled sends ("send later") ─────────────────────────────

	async scheduleEmail(item: { id: string; mailboxId: string; request: ScheduleRequest; sendAt: string }): Promise<string> {
		this.#notify("scheduled");
		this.ctx.storage.sql.exec(
			`INSERT INTO scheduled_emails (id, kind, original_email_id, payload, send_at, status, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
			item.id,
			item.request.kind,
			item.request.originalEmailId ?? null,
			JSON.stringify({ mailboxId: item.mailboxId, request: item.request }),
			item.sendAt,
			new Date().toISOString(),
		);
		await this.#armAlarm();
		return item.id;
	}

	async listScheduled(): Promise<ScheduledEmailSummary[]> {
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT id, kind, payload, send_at, status, error FROM scheduled_emails ORDER BY send_at ASC LIMIT 200`,
			),
		] as any[];
		return rows.map((r) => {
			let to = "";
			let subject = "";
			try {
				const email = JSON.parse(r.payload).request.email;
				to = Array.isArray(email.to) ? email.to.join(", ") : String(email.to ?? "");
				subject = String(email.subject ?? "");
			} catch {
				// leave blank
			}
			return { id: r.id, kind: r.kind, send_at: r.send_at, status: r.status, error: r.error ?? null, to, subject };
		});
	}

	/** Cancel a scheduled message. A message that is mid-send can't be cancelled. */
	async cancelScheduled(id: string): Promise<boolean> {
		this.#notify("scheduled");
		const row = [...this.ctx.storage.sql.exec(`SELECT status FROM scheduled_emails WHERE id = ?`, id)][0] as { status: string } | undefined;
		if (!row || row.status === "sending") return false;
		this.ctx.storage.sql.exec(`DELETE FROM scheduled_emails WHERE id = ?`, id);
		await this.#armAlarm();
		return true;
	}

	async alarm(): Promise<void> {
		await this.#sendDueScheduled();
		await this.#armAlarm();
	}

	async #armAlarm(): Promise<void> {
		const next = [
			...this.ctx.storage.sql.exec(`SELECT MIN(send_at) AS next FROM scheduled_emails WHERE status = 'pending'`),
		][0] as { next: string | null } | undefined;
		if (next?.next) {
			await this.ctx.storage.setAlarm(Math.max(new Date(next.next).getTime(), Date.now() + 1000));
		} else {
			await this.ctx.storage.deleteAlarm();
		}
	}

	async #sendDueScheduled(): Promise<void> {
		const sql = this.ctx.storage.sql;
		const now = new Date();
		// A row left in 'sending' means the object was interrupted mid-send. Don't
		// retry it blindly (that could double-send): flag it for the user instead.
		sql.exec(
			`UPDATE scheduled_emails SET status = 'failed', error = ?, updated_at = ? WHERE status = 'sending' AND updated_at < ?`,
			"Interrupted while sending. Check Sent before sending it again.",
			now.toISOString(),
			new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
		);
		const due = [
			...sql.exec(`SELECT id, payload FROM scheduled_emails WHERE status = 'pending' AND send_at <= ? ORDER BY send_at ASC LIMIT 20`, now.toISOString()),
		] as { id: string; payload: string }[];

		for (const row of due) {
			sql.exec(`UPDATE scheduled_emails SET status = 'sending', updated_at = ? WHERE id = ?`, new Date().toISOString(), row.id);
			try {
				const { mailboxId, request } = JSON.parse(row.payload) as { mailboxId: string; request: ScheduleRequest };
				await this.#sendScheduled(mailboxId, request);
				sql.exec(`DELETE FROM scheduled_emails WHERE id = ?`, row.id);
			} catch (e) {
				const message = (e as Error)?.message || "unknown error";
				console.error(`Scheduled send ${row.id} failed:`, message);
				sql.exec(`UPDATE scheduled_emails SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`, message, new Date().toISOString(), row.id);
			}
		}
		if (due.length > 0) this.#notify("scheduled");
	}

	/** Send one scheduled message and file it in Sent (compose or reply). Throws on failure. */
	async #sendScheduled(mailboxId: string, request: ScheduleRequest): Promise<void> {
		const { to, cc, bcc, from, subject, html, text } = request.email;
		const aliases = aliasesOf(await readMailboxSettings(this.env.BUCKET, mailboxId));
		const { toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId, aliases);

		const rateLimitError = await this.checkSendRateLimit();
		if (rateLimitError) throw new Error(rateLimitError);

		let threading: { originalMsgId: string; references: string[]; threadId: string } | null = null;
		if (request.kind === "reply") {
			const raw = (await this.getEmail(request.originalEmailId!)) as EmailFull | null;
			if (!raw) throw new Error("The message being replied to no longer exists");
			const original = await resolveOriginalEmail(this as any, raw);
			threading = buildReferencesChain(original);
		}

		const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
		const delivery = await deliverRaw(
			this.env.EMAIL,
			{ to, cc, bcc, from, subject, html, text, ...(threading ? { headers: buildThreadingHeaders(threading.originalMsgId, threading.references) } : {}) },
			outgoingMessageId,
		);
		if (!delivery.ok) throw new Error(delivery.error);

		const join = (v: unknown) => (Array.isArray(v) ? v.join(", ") : (v as string | undefined));
		await this.createEmail(
			Folders.SENT,
			{
				id: messageId,
				subject,
				sender: fromEmail,
				recipient: toStr,
				cc: cc ? join(cc)!.toLowerCase() : null,
				bcc: bcc ? join(bcc)!.toLowerCase() : null,
				date: new Date().toISOString(),
				body: html || text || "",
				in_reply_to: threading?.originalMsgId ?? null,
				email_references: threading ? JSON.stringify(threading.references) : null,
				thread_id: threading?.threadId ?? messageId,
				message_id: delivery.messageId,
				raw_headers: JSON.stringify([
					{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
					{ key: "to", value: join(to) },
					...(cc ? [{ key: "cc", value: join(cc) }] : []),
					...(bcc ? [{ key: "bcc", value: join(bcc) }] : []),
					{ key: "subject", value: subject },
					{ key: "date", value: new Date().toISOString() },
					{ key: "message-id", value: `<${delivery.messageId}>` },
					...(threading ? [{ key: "in-reply-to", value: `<${threading.originalMsgId}>` }] : []),
				]),
			},
			[],
		);
		if (threading) await this.markThreadRead(threading.threadId);
	}

	// ── Purge (mailbox deletion) ───────────────────────────────────

	/**
	 * Delete everything this mailbox stores and return its attachment keys so the
	 * caller can remove the blobs from R2. The schema is re-applied afterwards so
	 * the same address can be created again.
	 */
	async purgeAll(): Promise<{ email_id: string; id: string; filename: string }[]> {
		this.#notify("all");
		const attachments = [
			...this.ctx.storage.sql.exec(`SELECT email_id, id, filename FROM attachments`),
		] as unknown as { email_id: string; id: string; filename: string }[];
		await this.ctx.storage.deleteAll();
		applyMigrations(this.ctx.storage.sql, mailboxMigrations, this.ctx.storage);
		this.#fts = this.#setupFts();
		return attachments;
	}

	// ── Bulk actions ───────────────────────────────────────────────

	async bulkUpdate(req: BulkRequest): Promise<
		{ count: number; attachments: { email_id: string; id: string; filename: string }[] } | { error: string }
	> {
		this.#notify("emails");
		const { where, params } = buildBulkWhere(req);
		const sql = this.ctx.storage.sql;
		// rowsWritten also counts index writes, so count the matched rows instead.
		const matched = (): number =>
			Number(([...sql.exec(`SELECT COUNT(*) AS n FROM emails WHERE ${where}`, ...params)][0] as { n: number }).n);

		switch (req.action) {
			case "read":
			case "unread": {
				const count = matched();
				sql.exec(`UPDATE emails SET read = ? WHERE ${where}`, req.action === "read" ? 1 : 0, ...params);
				return { count, attachments: [] };
			}
			case "star":
			case "unstar": {
				const count = matched();
				sql.exec(`UPDATE emails SET starred = ? WHERE ${where}`, req.action === "star" ? 1 : 0, ...params);
				return { count, attachments: [] };
			}
			case "move": {
				const folder = [...sql.exec(`SELECT id FROM folders WHERE id = ? LIMIT 1`, req.folderId!)][0] as { id: string } | undefined;
				if (!folder) return { error: "Folder not found" };
				const count = matched();
				sql.exec(`UPDATE emails SET folder_id = ? WHERE ${where}`, folder.id, ...params);
				return { count, attachments: [] };
			}
			case "delete": {
				const ids = [...sql.exec(`SELECT id FROM emails WHERE ${where}`, ...params)].map((r: any) => String(r.id));
				if (ids.length === 0) return { count: 0, attachments: [] };
				const marks = ids.map(() => "?").join(", ");
				const attachments = [
					...sql.exec(`SELECT email_id, id, filename FROM attachments WHERE email_id IN (${marks})`, ...ids),
				] as unknown as { email_id: string; id: string; filename: string }[];
				sql.exec(`DELETE FROM emails WHERE id IN (${marks})`, ...ids);
				return { count: ids.length, attachments };
			}
		}
	}

	// ── Contacts (recipient suggestions) ────────────────────────────

	async searchContacts(query: string, self?: string, limit = 8): Promise<Contact[]> {
		const rows = [
			...this.ctx.storage.sql.exec(
				`SELECT sender, recipient, cc, bcc, date FROM emails ORDER BY date DESC LIMIT 3000`,
			),
		] as ContactSource[];
		return buildContacts(rows, { self, query, limit });
	}

	// ── Rate limiting (raw SQL) ────────────────────────────────────

	/**
	 * Check if the mailbox has exceeded the send rate limit.
	 * Limits: 20 emails per hour, 100 per day per mailbox.
	 * Returns null if under limit, or an error message string if exceeded.
	 */
	async checkSendRateLimit(): Promise<string | null> {
		const hourRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 hour')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((hourRow?.cnt ?? 0) >= 20) {
			return "Rate limit exceeded: max 20 emails per hour per mailbox";
		}

		const dayRow = [...this.ctx.storage.sql.exec(
			`SELECT COUNT(*) as cnt FROM emails
			 WHERE folder_id = ?1
			   AND date >= datetime('now', '-1 day')`,
			Folders.SENT,
		)][0] as { cnt: number } | undefined;

		if ((dayRow?.cnt ?? 0) >= 100) {
			return "Rate limit exceeded: max 100 emails per day per mailbox";
		}

		return null;
	}

	// ── Email creation (Drizzle) ───────────────────────────────────

	async createEmail(
		folder: string,
		email: EmailData,
		attachments: AttachmentData[],
	) {
		this.#notify("emails");
		// Resolve folder name or ID to the actual folder ID.
		const folderRow = this.db
			.select({ id: schema.folders.id })
			.from(schema.folders)
			.where(or(eq(schema.folders.id, folder), eq(schema.folders.name, folder)))
			.limit(1)
			.get();

		if (!folderRow) {
			throw new Error(
				`createEmail: folder "${folder}" not found. ` +
					"Ensure the folder exists before inserting an email.",
			);
		}

		const folderId = folderRow.id;
		const isSent = folderId === Folders.SENT;

		// Sent emails are always read — the sender obviously knows what they wrote.
		// This prevents sent replies from inflating thread_unread_count.
		this.db
			.insert(schema.emails)
			.values({
				id: email.id,
				folder_id: folderId,
				subject: email.subject,
				sender: email.sender,
				recipient: email.recipient,
				cc: email.cc ?? null,
				bcc: email.bcc ?? null,
				date: email.date,
				read: isSent ? 1 : (email.read ? 1 : 0),
				starred: email.starred ? 1 : 0,
				body: email.body,
				in_reply_to: email.in_reply_to ?? null,
				email_references: email.email_references ?? null,
				thread_id: email.thread_id ?? null,
				message_id: email.message_id ?? null,
				raw_headers: email.raw_headers ?? null,
			})
			.run();

		if (attachments.length > 0) {
			this.db.insert(schema.attachments).values(attachments).run();
		}
	}
}
