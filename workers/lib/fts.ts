// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Full-text search over emails with SQLite FTS5 (#89).
 *
 * The index is an external-content FTS5 table over the `emails` table, kept in
 * sync by triggers. It is created outside the numbered migrations and inside a
 * try/catch, so a runtime without FTS5 falls back to the old LIKE search instead
 * of failing to start the mailbox.
 */

export const FTS_COLUMNS = ["subject", "body", "sender", "recipient", "cc", "bcc"] as const;

const cols = FTS_COLUMNS.join(", ");
const newCols = FTS_COLUMNS.map((c) => `new.${c}`).join(", ");
const oldCols = FTS_COLUMNS.map((c) => `old.${c}`).join(", ");

/** Statements that create the index, its triggers, and fill it from existing mail. */
export const FTS_SETUP_STATEMENTS: string[] = [
	`CREATE VIRTUAL TABLE emails_fts USING fts5(${cols}, content='emails', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2')`,
	`CREATE TRIGGER emails_fts_ai AFTER INSERT ON emails BEGIN
		INSERT INTO emails_fts(rowid, ${cols}) VALUES (new.rowid, ${newCols});
	END`,
	`CREATE TRIGGER emails_fts_ad AFTER DELETE ON emails BEGIN
		INSERT INTO emails_fts(emails_fts, rowid, ${cols}) VALUES ('delete', old.rowid, ${oldCols});
	END`,
	`CREATE TRIGGER emails_fts_au AFTER UPDATE OF ${cols} ON emails BEGIN
		INSERT INTO emails_fts(emails_fts, rowid, ${cols}) VALUES ('delete', old.rowid, ${oldCols});
		INSERT INTO emails_fts(rowid, ${cols}) VALUES (new.rowid, ${newCols});
	END`,
	`INSERT INTO emails_fts(emails_fts) VALUES ('rebuild')`,
];

/**
 * Turn what the user typed into a safe FTS5 MATCH expression: each word becomes a
 * quoted prefix term and all must match (so "invoice mar" finds "invoice" and
 * "March"). Returns null when there is nothing searchable, so the caller can
 * fall back to LIKE.
 */
export function buildFtsQuery(input: string): string | null {
	const words = input.match(/[\p{L}\p{N}]+/gu);
	if (!words || words.length === 0) return null;
	return words
		.slice(0, 12)
		.map((w) => `"${w.slice(0, 64)}"*`)
		.join(" ");
}
