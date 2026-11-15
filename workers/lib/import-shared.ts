// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Stores one imported message. Used by the IMAP import job.
 *
 * Deliberately NOT shared with receiveEmail() (../index.ts) and it never
 * references EMAIL_AGENT, so nothing that flows through here can trigger an
 * auto-draft or an agent-initiated send. Imported mail is history, not new
 * mail.
 */
import PostalMime from "postal-mime";
import { Folders } from "../../shared/folders";
import { MAX_IMPORT_SIZE } from "../../shared/import";
import type { MailboxDO } from "../durableObject";
import type { Env } from "../types";
import type { StoredAttachment } from "./attachments";
import { normalizeSubject, pickImportThread } from "./imap/threading";
import { resolveReceivedDate } from "./received-date";

export { MAX_IMPORT_SIZE };

function addrList(list?: { address?: string | null }[]): string | null {
	const joined = (list ?? [])
		.map((a) => a.address)
		.filter(Boolean)
		.join(", ");
	return joined || null;
}

function extractMsgId(s: string): string {
	const m = s.match(/<([^>]+)>/);
	return m ? m[1] : s.trim().split(/\s+/)[0];
}

export interface ImportOptions {
	/** Folder id or name to store the message in. */
	folder?: string | null;
	read?: boolean;
	starred?: boolean;
	/** The Message-ID to store (the real one, or a synthetic one for messages that lack it). */
	messageId?: string | null;
	/** Skip the per-message browser notification; the caller notifies once per batch. */
	silent?: boolean;
}

export type ImportOutcome = { id: string; duplicate: false } | { id: null; duplicate: true };

export async function importParsedEmail(
	bucket: Env["BUCKET"],
	mailboxStub: DurableObjectStub<MailboxDO>,
	raw: Uint8Array,
	options: ImportOptions,
): Promise<ImportOutcome> {
	const parsed = await new PostalMime().parse(raw);
	const originalMessageId = options.messageId ?? (parsed.messageId ? extractMsgId(parsed.messageId) : null);

	if (originalMessageId && (await mailboxStub.hasMessageId(originalMessageId))) {
		return { id: null, duplicate: true };
	}

	const id = crypto.randomUUID();
	const storedKeys: string[] = [];
	const attachmentData: StoredAttachment[] = [];

	try {
		for (const att of parsed.attachments ?? []) {
			const attachmentId = crypto.randomUUID();
			const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
			const key = `attachments/${id}/${attachmentId}/${filename}`;
			await bucket.put(key, att.content);
			storedKeys.push(key);
			attachmentData.push({
				id: attachmentId,
				email_id: id,
				filename,
				mimetype: att.mimeType,
				size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
				content_id: att.contentId || null,
				disposition: att.disposition || "attachment",
			});
		}

		const inReplyTo = parsed.inReplyTo ? extractMsgId(parsed.inReplyTo) : null;
		const references = parsed.references ? parsed.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
		const date = resolveReceivedDate(parsed.date);
		const sender = (parsed.from?.address || "").toLowerCase();
		const recipient = addrList(parsed.to) || "";
		const subject = parsed.subject || "";

		// Thread: the nearest stored ancestor named in the headers, otherwise a
		// careful subject match, otherwise a new thread rooted at the first reference.
		let threadId = references[0] || inReplyTo || id;
		if (inReplyTo || references.length > 0) {
			const ancestors = [inReplyTo, ...[...references].reverse()].filter(Boolean) as string[];
			const parentThread = await mailboxStub.findThreadByMessageIds(ancestors);
			if (parentThread) threadId = parentThread;
		} else {
			const normalized = normalizeSubject(subject);
			if (normalized) {
				const candidates = await mailboxStub.findImportThreadCandidates(normalized);
				const joined = pickImportThread(candidates, { subject, sender, recipient, date });
				if (joined) threadId = joined;
			}
		}

		await mailboxStub.createEmail(
			options.folder || Folders.INBOX,
			{
				id,
				subject,
				sender,
				recipient,
				cc: addrList(parsed.cc),
				bcc: addrList(parsed.bcc),
				date,
				read: !!options.read,
				starred: !!options.starred,
				body: parsed.html || parsed.text || "",
				in_reply_to: inReplyTo,
				email_references: references.length > 0 ? JSON.stringify(references) : null,
				thread_id: threadId,
				message_id: originalMessageId,
				raw_headers: JSON.stringify(parsed.headers),
			},
			attachmentData,
			{ silent: options.silent },
		);
	} catch (e) {
		// Do not leave attachment files behind for a message that was not stored.
		await Promise.all(storedKeys.map((k) => bucket.delete(k).catch(() => {})));
		throw e;
	}

	return { id, duplicate: false };
}
