// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Maps folders on the old server onto Agentic Inbox folders.
 *
 * Special-use attributes from LIST (RFC 6154: \Sent, \Trash, \Junk, ...) win
 * over names, because names differ by provider and language. Custom folders
 * are recreated under their own name.
 */
import { Folders } from "../../../shared/folders";
import type { FolderTarget, SourceFolder } from "../../../shared/import";

const NAME_TARGETS: Record<string, FolderTarget> = {
	inbox: Folders.INBOX,
	sent: Folders.SENT,
	"sent items": Folders.SENT,
	"sent messages": Folders.SENT,
	"sent mail": Folders.SENT,
	"[gmail]/sent mail": Folders.SENT,
	"inbox.sent": Folders.SENT,
	gesendet: Folders.SENT,
	archive: Folders.ARCHIVE,
	archives: Folders.ARCHIVE,
	// Drafts become archived mail: folder id "draft" opens as a live compose session.
	drafts: Folders.ARCHIVE,
	draft: Folders.ARCHIVE,
	"[gmail]/drafts": Folders.ARCHIVE,
	trash: Folders.TRASH,
	"deleted items": Folders.TRASH,
	"deleted messages": Folders.TRASH,
	"[gmail]/trash": Folders.TRASH,
	bin: Folders.TRASH,
	spam: Folders.SPAM,
	junk: Folders.SPAM,
	"junk e-mail": Folders.SPAM,
	"junk email": Folders.SPAM,
	"[gmail]/spam": Folders.SPAM,
	"bulk mail": Folders.SPAM,
};

function hasFlag(flags: string[], name: string): boolean {
	return flags.some((f) => f.toLowerCase() === name.toLowerCase());
}

/** True when the folder cannot hold messages (a bare parent such as "[Gmail]"). */
export function isNoSelect(folder: SourceFolder): boolean {
	return hasFlag(folder.flags, "\\Noselect") || hasFlag(folder.flags, "\\NonExistent");
}

/** Where a folder's mail should go by default. null means skip it. */
export function suggestTarget(folder: SourceFolder): FolderTarget {
	if (isNoSelect(folder)) return null;
	if (folder.name.toUpperCase() === "INBOX") return Folders.INBOX;

	if (hasFlag(folder.flags, "\\Sent")) return Folders.SENT;
	if (hasFlag(folder.flags, "\\Trash")) return Folders.TRASH;
	if (hasFlag(folder.flags, "\\Junk")) return Folders.SPAM;
	if (hasFlag(folder.flags, "\\Archive")) return Folders.ARCHIVE;
	if (hasFlag(folder.flags, "\\Drafts")) return Folders.ARCHIVE;
	// Gmail's "All Mail" holds archived messages that exist nowhere else. It is
	// imported last and skipped message by message when already imported from
	// another folder, so only truly archived mail lands in Archive.
	if (hasFlag(folder.flags, "\\All")) return Folders.ARCHIVE;
	// Starred / Important are virtual views over other folders.
	if (hasFlag(folder.flags, "\\Flagged") || hasFlag(folder.flags, "\\Important")) return null;

	const byName = NAME_TARGETS[folder.name.toLowerCase()];
	if (byName !== undefined) return byName;

	return `new:${customFolderName(folder)}`;
}

/** Display name for a recreated folder: the full path with the delimiter as " / ". */
export function customFolderName(folder: SourceFolder): string {
	const name = folder.delimiter ? folder.name.split(folder.delimiter).join(" / ") : folder.name;
	return name.replace(/^INBOX\s*\/\s*/i, "").trim().slice(0, 80) || "Imported";
}

/**
 * Order folders so duplicates resolve sensibly: Inbox first, then Sent, other
 * folders, Trash and Spam, and "All Mail" last.
 */
export function folderPriority(folder: SourceFolder, target: FolderTarget): number {
	if (hasFlag(folder.flags, "\\All")) return 9;
	if (target === Folders.INBOX) return 0;
	if (target === Folders.SENT) return 1;
	if (target === Folders.TRASH) return 7;
	if (target === Folders.SPAM) return 8;
	if (target === Folders.ARCHIVE) return 5;
	return 3;
}

/** A user-supplied target is valid when it is skip, a system folder, or "new:<name>". */
export function isValidTarget(target: unknown): target is FolderTarget {
	if (target === null) return true;
	if (typeof target !== "string") return false;
	if ((Object.values(Folders) as string[]).includes(target) && target !== Folders.DRAFT) return true;
	return target.startsWith("new:") && target.slice(4).trim().length > 0 && target.length <= 90;
}
