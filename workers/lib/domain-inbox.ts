// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Pure helpers for the domain-wide "All inboxes" view: merging per-mailbox result lists,
 * the keyset cursor that pages through the merge, and summing folder counts.
 */
import { SYSTEM_FOLDER_IDS } from "../../shared/folders";

/** Where the previous page ended: the last row's date and id. Rows after it are older. */
export interface Cursor {
	date: string;
	id: string;
}

export type CursorResult = { ok: true; cursor: Cursor | undefined } | { ok: false };

/** Opaque to clients: base64url of the JSON `{date, id}`. */
export function encodeCursor(cursor: Cursor): string {
	const bytes = new TextEncoder().encode(JSON.stringify({ date: cursor.date, id: cursor.id }));
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An absent cursor is the first page; anything not produced by [encodeCursor] is rejected. */
export function decodeCursor(raw: string | undefined | null): CursorResult {
	if (!raw) return { ok: true, cursor: undefined };
	try {
		const standard = raw.replace(/-/g, "+").replace(/_/g, "/");
		const binary = atob(standard);
		const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
		const parsed = JSON.parse(new TextDecoder().decode(bytes));
		if (parsed && typeof parsed.date === "string" && typeof parsed.id === "string") {
			return { ok: true, cursor: { date: parsed.date, id: parsed.id } };
		}
	} catch {
		// fall through to rejection
	}
	return { ok: false };
}

/**
 * Newest first, ties broken by id descending — the same order each mailbox's SQL uses, so a
 * cursor taken from the merged list means the same thing inside every mailbox.
 */
function newestFirst(a: { date: string; id: string }, b: { date: string; id: string }): number {
	if (a.date !== b.date) return a.date < b.date ? 1 : -1;
	if (a.id !== b.id) return a.id < b.id ? 1 : -1;
	return 0;
}

/** Merge several newest-first lists into one, keeping the first [limit] rows. */
export function mergeNewestFirst<T extends { date: string; id: string }>(lists: T[][], limit: number): T[] {
	return lists.flat().sort(newestFirst).slice(0, limit);
}

/** The mailboxes whose address is on [domain] (case-insensitive). */
export function mailboxesInDomain<T extends { email: string }>(mailboxes: T[], domain: string): T[] {
	const wanted = domain.toLowerCase();
	return mailboxes.filter((m) => m.email.split("@")[1]?.toLowerCase() === wanted);
}

export interface FolderCount {
	id: string;
	name: string;
	unreadCount: number;
}

/**
 * Unread totals for the system folders across mailboxes, in sidebar order. Custom folders belong
 * to one mailbox each, so a domain-wide drawer has no sensible total for them and omits them.
 */
export function sumFolderUnread(perMailbox: FolderCount[][]): FolderCount[] {
	const totals = new Map<string, FolderCount>();
	for (const folders of perMailbox) {
		for (const folder of folders) {
			if (!(SYSTEM_FOLDER_IDS as readonly string[]).includes(folder.id)) continue;
			const existing = totals.get(folder.id);
			if (existing) existing.unreadCount += folder.unreadCount;
			else totals.set(folder.id, { id: folder.id, name: folder.name, unreadCount: folder.unreadCount });
		}
	}
	return SYSTEM_FOLDER_IDS.flatMap((id) => {
		const total = totals.get(id);
		return total ? [total] : [];
	});
}
