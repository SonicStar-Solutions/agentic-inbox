// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { FolderTarget, ImapImportStatus, ImportSecurity, ProbeResult } from "shared/import";
import type { Email, Folder, Mailbox } from "~/types";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
	status: number;
	body: Record<string, unknown>;

	constructor(status: number, body: Record<string, unknown>) {
		super((body.error as string) || `Request failed: ${status}`);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}
}

async function request<T>(
	url: string,
	options: RequestInit = {},
): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	// Combine caller signal (e.g. TanStack Query abort) with our timeout signal
	const signal = options.signal
		? AbortSignal.any([options.signal, controller.signal])
		: controller.signal;

	try {
		const res = await fetch(url, {
			...options,
			signal,
			headers: {
				"Content-Type": "application/json",
				...(options.headers as Record<string, string>),
			},
		});

		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new ApiError(res.status, body as Record<string, unknown>);
		}

		if (res.status === 204) return undefined as T;

		const contentType = res.headers.get("content-type") ?? "";
		if (contentType.includes("application/json")) {
			return res.json() as Promise<T>;
		}
		return res.blob() as unknown as T;
	} finally {
		clearTimeout(timeout);
	}
}

function get<T>(url: string, opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal }) {
	const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
	return request<T>(`${url}${query}`, {
		method: "GET",
		signal: opts?.signal,
		...(opts?.responseType === "blob" ? { headers: { Accept: "*/*" } } : {}),
	});
}

function post<T>(url: string, body?: unknown, opts?: { signal?: AbortSignal }) {
	return request<T>(url, {
		method: "POST",
		signal: opts?.signal,
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function put<T>(url: string, body?: unknown) {
	return request<T>(url, {
		method: "PUT",
		body: body != null ? JSON.stringify(body) : undefined,
	});
}

function del<T>(url: string) {
	return request<T>(url, { method: "DELETE" });
}

// ---------- Typed response shapes ----------

interface EmailListResponse {
	emails: Email[];
	totalCount: number;
}

// ---------- API client ----------

const api = {
	// Config
	getConfig: () =>
		get<{ domains: string[]; emailAddresses: string[] }>("/api/v1/config"),

	// Mailboxes
	listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
	createMailbox: (email: string, name: string, settings?: unknown) =>
		post<Mailbox>("/api/v1/mailboxes", { email, name, settings }),
	getMailbox: (mailboxId: string) =>
		get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
	updateMailbox: (mailboxId: string, settings: unknown) =>
		put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),
	deleteMailbox: (mailboxId: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}`),

	// Emails
	listEmails: (mailboxId: string, params: Record<string, string>, opts?: { signal?: AbortSignal }) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, { params, signal: opts?.signal }),
	sendEmail: (mailboxId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
	scheduleEmail: (mailboxId: string, body: unknown) =>
		post<{ id: string; send_at: string }>(`/api/v1/mailboxes/${mailboxId}/emails/schedule`, body),
	listScheduled: async (mailboxId: string) => {
		const res = await get<{ scheduled: import("~/queries/scheduled").ScheduledItem[] }>(`/api/v1/mailboxes/${mailboxId}/scheduled`);
		return res?.scheduled ?? [];
	},
	cancelScheduled: (mailboxId: string, id: string) => del<void>(`/api/v1/mailboxes/${mailboxId}/scheduled/${id}`),
	listLabels: async (mailboxId: string) => {
		const res = await get<{ labels: import("~/types").Label[] }>(`/api/v1/mailboxes/${mailboxId}/labels`);
		return res?.labels ?? [];
	},
	createLabel: (mailboxId: string, name: string, color: string) =>
		post<import("~/types").Label>(`/api/v1/mailboxes/${mailboxId}/labels`, { name, color }),
	deleteLabel: (mailboxId: string, id: string) => del<void>(`/api/v1/mailboxes/${mailboxId}/labels/${id}`),
	bulkEmails: (mailboxId: string, body: unknown) =>
		post<{ count: number }>(`/api/v1/mailboxes/${mailboxId}/emails/bulk`, body),
	getContacts: async (mailboxId: string, q: string, limit = 8) => {
		const res = await get<{ contacts: { address: string; count: number; last: string }[] }>(
			`/api/v1/mailboxes/${mailboxId}/contacts`,
			{ params: { q, limit: String(limit) } },
		);
		return res?.contacts ?? [];
	},
	getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
		get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
	updateEmail: (mailboxId: string, id: string, data: unknown) =>
		put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
	deleteEmail: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
	moveEmail: (mailboxId: string, id: string, folderId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, { folderId }),
	getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
		get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
	markThreadRead: (mailboxId: string, threadId: string) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
	getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
		get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, { responseType: "blob" }),
	saveDraft: (
		mailboxId: string,
		draft: {
			to?: string;
			cc?: string;
			bcc?: string;
			subject?: string;
			body: string;
			in_reply_to?: string;
			thread_id?: string;
			draft_id?: string;
		},
	) => post<{ draft_id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
	replyToEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
	forwardEmail: (mailboxId: string, emailId: string, email: unknown) =>
		post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

	// Folders
	listFolders: (mailboxId: string) =>
		get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),
	createFolder: (mailboxId: string, name: string) =>
		post<Folder>(`/api/v1/mailboxes/${mailboxId}/folders`, { name }),
	updateFolder: (mailboxId: string, id: string, name: string) =>
		put<Folder>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`, { name }),
	deleteFolder: (mailboxId: string, id: string) =>
		del<void>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`),

	// Search
	searchEmails: (mailboxId: string, params: Record<string, string>) =>
		get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),

	// Import from another provider (IMAP)
	probeImap: (mailboxId: string, conn: ImapConnection) =>
		post<ProbeResult>(`/api/v1/mailboxes/${mailboxId}/import/imap/test`, conn),
	startImapImport: (mailboxId: string, body: ImapConnection & { folderMap: Record<string, FolderTarget> }) =>
		post<ImapImportStatus>(`/api/v1/mailboxes/${mailboxId}/import/imap/start`, body),
	getImapImportStatus: (mailboxId: string) =>
		get<ImapImportStatus>(`/api/v1/mailboxes/${mailboxId}/import/imap/status`),
	cancelImapImport: (mailboxId: string) =>
		post<ImapImportStatus>(`/api/v1/mailboxes/${mailboxId}/import/imap/cancel`),
	retryFailedImport: (mailboxId: string, password: string) =>
		post<ImapImportStatus>(`/api/v1/mailboxes/${mailboxId}/import/imap/retry-failed`, { password }),
	dismissImportFailures: (mailboxId: string) =>
		post<ImapImportStatus>(`/api/v1/mailboxes/${mailboxId}/import/imap/dismiss-failures`),
};

export interface ImapConnection {
	host: string;
	port: number;
	security: ImportSecurity;
	username: string;
	password: string;
}

export default api;
