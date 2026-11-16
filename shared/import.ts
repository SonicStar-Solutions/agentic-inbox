// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Types and constants shared by the worker's IMAP import and the Import page.
 * No runtime dependencies, so it is safe to import from either side.
 */

/** Implicit TLS (usually port 993) or STARTTLS on a plain connection (usually port 143). */
export type ImportSecurity = "tls" | "starttls";

export interface ImportProvider {
	id: string;
	label: string;
	host: string;
	port: number;
	security: ImportSecurity;
	/** Shown under the form when this provider is picked. */
	note?: string;
	/** Where to create an app password, when the provider needs one. */
	helpUrl?: string;
}

/** Presets for the Import page. "Other" has no host and is filled in by hand. */
export const IMPORT_PROVIDERS: readonly ImportProvider[] = [
	{
		id: "gmail",
		label: "Gmail / Google Workspace",
		host: "imap.gmail.com",
		port: 993,
		security: "tls",
		note: "Turn on 2-step verification, then create an app password and use it here instead of your normal password. IMAP must be enabled in Gmail settings.",
		helpUrl: "https://support.google.com/accounts/answer/185833",
	},
	{
		id: "icloud",
		label: "iCloud Mail",
		host: "imap.mail.me.com",
		port: 993,
		security: "tls",
		note: "Use an app-specific password from appleid.apple.com, and your full iCloud address as the username.",
		helpUrl: "https://support.apple.com/en-us/102654",
	},
	{
		id: "yahoo",
		label: "Yahoo Mail",
		host: "imap.mail.yahoo.com",
		port: 993,
		security: "tls",
		note: "Create an app password in Yahoo account security and use it here.",
		helpUrl: "https://help.yahoo.com/kb/SLN15241.html",
	},
	{ id: "fastmail", label: "Fastmail", host: "imap.fastmail.com", port: 993, security: "tls", note: "Use an app password with IMAP access." },
	{ id: "purelymail", label: "Purelymail", host: "imap.purelymail.com", port: 993, security: "tls" },
	{ id: "zoho", label: "Zoho Mail", host: "imap.zoho.com", port: 993, security: "tls", note: "IMAP access must be enabled in Zoho Mail settings." },
	{ id: "other", label: "Other (enter manually)", host: "", port: 993, security: "tls" },
];

/** Hostnames that identify Microsoft's mail services, which no longer allow password IMAP. */
export function isMicrosoftMailHost(host: string): boolean {
	const h = host.trim().toLowerCase();
	return h === "outlook.office365.com" || h === "imap-mail.outlook.com" || h.endsWith(".outlook.com") || h.endsWith(".office365.com");
}

export type ImportJobStatus = "idle" | "running" | "done" | "error" | "canceled";

/**
 * Where a source folder's mail goes. A system folder id ("inbox", "sent",
 * "archive", "trash", "spam"), "new:<Name>" to create a custom folder, or null
 * to skip the folder.
 */
export type FolderTarget = string | null;

export interface SourceFolder {
	/** Name as the server wants it in commands (still modified-UTF-7 encoded). */
	path: string;
	/** Human-readable name (decoded). */
	name: string;
	delimiter: string | null;
	flags: string[];
}

export interface ProbeFolder {
	path: string;
	name: string;
	messages: number;
	suggested: FolderTarget;
}

export interface ProbeResult {
	folders: ProbeFolder[];
	totalMessages: number;
}

export interface ImportFailure {
	/** Readable folder name. */
	folder: string;
	/** Folder name as the server wants it (used to retry). */
	path: string;
	/** 0 when the whole folder could not be read. */
	uid: number;
	uidValidity: number;
	reason: string;
}

export interface ImapImportStatus {
	status: ImportJobStatus;
	/** Account being imported from (never includes the password). */
	source: { host: string; port: number; security: ImportSecurity; username: string } | null;
	startedBy: string | null;
	currentFolder: string | null;
	totals: { folders: number; messages: number };
	folderIndex: number;
	counts: { imported: number; skipped: number; failed: number };
	failures: ImportFailure[];
	/** Failures beyond the stored cap are counted here but not listed. */
	failureCount: number;
	error: string | null;
	/** Set while the job is waiting to reconnect after a dropped connection. */
	retry: { attempt: number; nextAttemptAt: string } | null;
	startedAt: string | null;
	updatedAt: string | null;
	finishedAt: string | null;
}

export const MAX_IMPORT_SIZE = 25 * 1024 * 1024;
export const MAX_STORED_FAILURES = 200;
