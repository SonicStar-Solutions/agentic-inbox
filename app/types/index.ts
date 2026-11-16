// Copyright (c) 2026 Cloudflare, Inc.
// Modifications Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface SignatureSettings {
	enabled: boolean;
	text: string;
	html?: string;
}

export interface MailboxSettings {
	fromName?: string;
	signature?: SignatureSettings;
	agentSystemPrompt?: string;
	/** Draft a reply automatically when mail arrives (default on). */
	autoDraft?: { enabled: boolean };
	/** Workers AI model override for this mailbox, e.g. @cf/moonshotai/kimi-k2.5. */
	agentModel?: string;
	/** Extra addresses this mailbox receives at and can send from. */
	aliases?: string[];
}

export interface Mailbox {
	id: string;
	email: string;
	name: string;
	/** From name; the mailbox list returns it flat, the detail endpoint nests it in settings. */
	fromName?: string;
	settings?: MailboxSettings;
}

export interface Label {
	id: string;
	name: string;
	color: string;
	/** Messages carrying the label (not in Trash); only on the label list. */
	count?: number;
}

export interface Email {
	id: string;
	thread_id?: string | null;
	folder_id?: string | null;
	subject: string;
	sender: string;
	/** Display name from the From header, when the message had one. */
	sender_name?: string | null;
	recipient: string;
	cc?: string;
	bcc?: string;
	date: string;
	read: boolean;
	starred: boolean;
	body?: string | null;
	in_reply_to?: string | null;
	email_references?: string | null;
	message_id?: string | null;
	raw_headers?: string | null;
	attachments?: Attachment[];
	snippet?: string | null;
	labels?: Label[];
	// Thread aggregate fields (only present in threaded list view)
	thread_count?: number;
	thread_unread_count?: number;
	participants?: string;
	needs_reply?: boolean;
	has_draft?: boolean;
}

export interface Attachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string;
	disposition?: string;
}

export interface Folder {
	id: string;
	name: string;
	unreadCount: number;
}
