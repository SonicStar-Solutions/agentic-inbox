// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Pure helpers for the Import page, kept out of the component so they can be tested. */
import { Folders } from "shared/folders";
import type { FolderTarget, ImapImportStatus, ProbeFolder } from "shared/import";

export const TARGET_OPTIONS: { value: string; label: string }[] = [
	{ value: Folders.INBOX, label: "Inbox" },
	{ value: Folders.SENT, label: "Sent" },
	{ value: Folders.ARCHIVE, label: "Archive" },
	{ value: Folders.TRASH, label: "Trash" },
	{ value: Folders.SPAM, label: "Spam" },
];

/** The select value for a target: a system id, "new" (create a folder of the same name) or "skip". */
export function targetToChoice(target: FolderTarget): string {
	if (target === null) return "skip";
	return target.startsWith("new:") ? "new" : target;
}

/** Turn a select value back into a target for this folder. */
export function choiceToTarget(choice: string, folder: Pick<ProbeFolder, "name" | "suggested">): FolderTarget {
	if (choice === "skip") return null;
	if (choice === "new") {
		// Keep the name the server suggested when it already was a custom folder.
		if (typeof folder.suggested === "string" && folder.suggested.startsWith("new:")) return folder.suggested;
		return `new:${folder.name.replace(/\//g, " / ").trim().slice(0, 80) || "Imported"}`;
	}
	return choice;
}

/** What the user chose for every folder, starting from the server's suggestions. */
export function buildFolderMap(folders: ProbeFolder[], overrides: Record<string, FolderTarget>): Record<string, FolderTarget> {
	const map: Record<string, FolderTarget> = {};
	for (const f of folders) map[f.path] = f.path in overrides ? overrides[f.path] : f.suggested;
	return map;
}

export function countToImport(folders: ProbeFolder[], map: Record<string, FolderTarget>): { folders: number; messages: number } {
	let n = 0;
	let m = 0;
	for (const f of folders) {
		if (map[f.path] === null || map[f.path] === undefined) continue;
		n++;
		m += f.messages;
	}
	return { folders: n, messages: m };
}

export function processed(s: Pick<ImapImportStatus, "counts">): number {
	return s.counts.imported + s.counts.skipped + s.counts.failed;
}

/** 0-100, or null when the total is not known. */
export function percentDone(s: ImapImportStatus): number | null {
	if (s.status === "done") return 100;
	const total = s.totals.messages;
	if (!total) return null;
	return Math.min(99, Math.floor((processed(s) / total) * 100));
}

export function formatDuration(ms: number): string {
	const mins = Math.round(ms / 60_000);
	if (mins < 1) return "under a minute";
	if (mins < 60) return `${mins} min`;
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return m ? `${h} h ${m} min` : `${h} h`;
}

/** Time left, or null until there is enough progress to guess. */
export function estimateRemaining(s: ImapImportStatus, now: number): number | null {
	if (s.status !== "running" || !s.startedAt || !s.totals.messages) return null;
	const done = processed(s);
	const elapsed = now - new Date(s.startedAt).getTime();
	if (done < 20 || elapsed < 15_000) return null;
	const left = Math.max(0, s.totals.messages - done);
	return (left / done) * elapsed;
}

/** A plain-language message for a failed test or start. */
export function connectionErrorMessage(code: string | undefined, message: string, providerId: string): string {
	if (code === "auth") {
		const needsAppPassword = ["gmail", "icloud", "yahoo"].includes(providerId);
		return needsAppPassword
			? "Sign-in failed. This provider needs an app password, not your normal password. Check the username too."
			: "Sign-in failed. Check the username and password, and that IMAP access is turned on for the account.";
	}
	if (code === "connect") return `${message} Check the server name and port.`;
	return message || "Something went wrong.";
}
