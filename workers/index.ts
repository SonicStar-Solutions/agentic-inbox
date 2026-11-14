// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { getAgentByName } from "agents";
import { z } from "zod";
import { deliverEmail } from "./lib/send";
import { storeAttachments, type StoredAttachment } from "./lib/attachments";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildThreadingHeaders,
	listMailboxes,
} from "./lib/email-helpers";
import { SendEmailRequestSchema } from "./lib/schemas";
import { parseJsonBody } from "./lib/http";
import { BulkRequestSchema } from "./lib/bulk";
import { ScheduleRequestSchema, validateSendAt } from "./lib/scheduled";
import { aliasesOf, resolveAlias, syncAliasIndex, validateAliases } from "./lib/aliases";
import { isAllowedDomain, parseDomains } from "./lib/domains";
import { isAutoDraftEnabled, readMailboxSettings, validateAgentSettings } from "./lib/mailbox-settings";
import { resolveReceivedDate } from "./lib/received-date";
import { logRateLimitHit } from "./lib/rate-limit";
import { findOverlongSearchTerm, MAX_SEARCH_TERM_LENGTH } from "./lib/search";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";

type AppContext = Context<MailboxContext>;

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1),
	settings: z.record(z.any()).optional(), // unvalidated — agentSystemPrompt goes straight to AI
});

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().optional(),
});

// -- Helpers --------------------------------------------------------

function slugify(text: string) { // can return "" for non-alphanumeric input
	return text.toString().toLowerCase()
		.replace(/\s+/g, "-").replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use("/api/*", cors({
	origin: (origin) => {
		// Same-origin requests have no Origin header — allow them.
		if (!origin) return origin;
		// In development, allow localhost for Vite dev server.
		try {
			const url = new URL(origin);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
		} catch { /* invalid origin */ }
		// Block all other cross-origin requests. The app is served from the
		// same origin as the API, so legitimate browser requests never send
		// an Origin header. Returning undefined omits Access-Control-Allow-Origin.
		return undefined;
	},
}));
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Config ---------------------------------------------------------

app.get("/api/v1/config", (c) => {
	const domains = parseDomains(c.env.DOMAINS);
	const emailAddresses = c.env.EMAIL_ADDRESSES ?? [];
	return c.json({ domains, emailAddresses });
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	const allMailboxes = await listMailboxes(c.env.BUCKET);
	return c.json(allMailboxes.map((m) => ({ ...m, name: m.id })));
});

app.post("/api/v1/mailboxes", async (c) => {
	const parsed = await parseJsonBody(c, CreateMailboxBody);
	if (!parsed.ok) return parsed.response;
	const { name, settings, email: rawEmail } = parsed.data;
	const email = rawEmail.toLowerCase();
	const domains = parseDomains(c.env.DOMAINS);
	if (!isAllowedDomain(email, domains)) {
		return c.json({ error: `Mailbox domain must be one of: ${domains.join(", ")}` }, 400);
	}
	const allowedAddresses = (c.env.EMAIL_ADDRESSES ?? []) as string[];
	if (allowedAddresses.length > 0 && !allowedAddresses.map((a) => a.toLowerCase()).includes(email)) {
		return c.json({ error: "Mailbox creation is restricted to configured EMAIL_ADDRESSES" }, 403);
	}
	const key = `mailboxes/${email}.json`;
	if (await c.env.BUCKET.head(key)) return c.json({ error: "Mailbox already exists" }, 409);
	if (await resolveAlias(c.env.BUCKET, email)) return c.json({ error: "That address is already an alias of another mailbox" }, 409);
	const defaultSettings = { fromName: name, forwarding: { enabled: false, email: "" }, signature: { enabled: false, text: "" }, autoReply: { enabled: false, subject: "", message: "" } };
	const finalSettings = { ...defaultSettings, ...settings };
	await c.env.BUCKET.put(key, JSON.stringify(finalSettings));
	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
	await stub.getFolders();
	return c.json({ id: email, email, name, settings: finalSettings }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const obj = await c.env.BUCKET.get(`mailboxes/${mailboxId}.json`);
	if (!obj) return c.json({ error: "Not found" }, 404);
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings: await obj.json() });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { settings } = (await c.req.json().catch(() => ({}))) as { settings?: Record<string, unknown> };
	if (!settings || typeof settings !== "object") return c.json({ error: "settings object required" }, 400);
	const settingsError = validateAgentSettings(settings);
	if (settingsError) return c.json({ error: settingsError }, 400);
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	const aliasError = await validateAliases(c.env.BUCKET, mailboxId, settings.aliases, parseDomains(c.env.DOMAINS));
	if (aliasError) return c.json({ error: aliasError }, 400);
	const previousAliases = aliasesOf(await readMailboxSettings(c.env.BUCKET, mailboxId));
	await c.env.BUCKET.put(key, JSON.stringify(settings));
	await syncAliasIndex(c.env.BUCKET, mailboxId, previousAliases, aliasesOf(settings));
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings });
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	// Remove the mailbox's data first and the settings marker last, so a failure
	// part-way leaves the mailbox visible and the delete can simply be retried.
	const attachments = await c.env.MAILBOX.get(c.env.MAILBOX.idFromName(mailboxId)).purgeAll();
	const keys = attachments.map((a) => `attachments/${a.email_id}/${a.id}/${a.filename}`);
	for (let i = 0; i < keys.length; i += 1000) await c.env.BUCKET.delete(keys.slice(i, i + 1000));
	try {
		const agent = await getAgentByName(c.env.EMAIL_AGENT, mailboxId);
		await agent.fetch(new Request("https://agents/purge", { method: "POST" }));
	} catch (e) {
		console.error(`Could not clear agent history for ${mailboxId}:`, (e as Error).message);
	}
	await syncAliasIndex(c.env.BUCKET, mailboxId, aliasesOf(await readMailboxSettings(c.env.BUCKET, mailboxId)), []);
	await c.env.BUCKET.delete(key);
	return c.body(null, 204);
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit });
		const totalCount = await (stub as any).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection });
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const parsed = await parseJsonBody(c, SendEmailRequestSchema);
	if (!parsed.ok) return parsed.response;
	const { to, cc, bcc, from, subject, html, text, attachments, in_reply_to, references, thread_id } = parsed.data;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId, aliasesOf(await readMailboxSettings(c.env.BUCKET, mailboxId))));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await (stub as any).checkSendRateLimit();
	if (rateLimitError) {
		logRateLimitHit("compose", mailboxId, rateLimitError);
		return c.json({ error: rateLimitError }, 429);
	}
	// Deliver first: a message the binding rejects must be reported to the
	// caller and must not be filed in Sent as if it had gone out (#84).
	const delivery = await deliverEmail(c, c.env.EMAIL, {
		to, cc, bcc, from, subject, html, text,
		attachments: attachments?.map((att) => ({ content: att.content, filename: att.filename, type: att.type, disposition: att.disposition || "attachment", contentId: att.contentId })),
		...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
	}, outgoingMessageId);
	if (!delivery.ok) return delivery.response;
	// Provider-assigned Message-ID (#83): what recipients actually receive, so
	// later replies thread against a message they really have.
	const sentMessageId = delivery.messageId;

	try {
		const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);
		await stub.createEmail(Folders.SENT, {
			id: messageId, subject, sender: fromEmail, recipient: toStr,
			cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
			bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
			date: new Date().toISOString(), body: html || text || "",
			in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
			thread_id: thread_id || in_reply_to || messageId, message_id: sentMessageId,
			raw_headers: JSON.stringify([
				{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
				{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
				...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
				...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
				{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
				{ key: "message-id", value: `<${sentMessageId}>` },
			]),
		}, attachmentData);
	} catch (e) {
		// The message was delivered; don't tell the client it failed (a retry
		// would send a duplicate). Surface the storage problem in the logs.
		console.error("Sent email delivered but could not be stored:", (e as Error).message);
	}
	return c.json({ id: messageId, status: "sent" }, 202);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const parsed = await parseJsonBody(c, DraftBody);
	if (!parsed.ok) return parsed.response;
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = parsed.data;
	const stub = c.var.mailboxStub;
	if (draft_id) await stub.deleteEmail(draft_id); // not atomic — create-then-delete would be safer
	const messageId = crypto.randomUUID();
	const now = new Date().toISOString();
	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: subject || "", sender: mailboxId.toLowerCase(),
		recipient: (to || "").toLowerCase(), cc: cc?.toLowerCase() || null, bcc: bcc?.toLowerCase() || null,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: thread_id || in_reply_to || messageId,
	}, []);
	return c.json({ id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred } = (await c.req.json()) as { read?: boolean; starred?: boolean };
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, { read, starred });
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	if (attachments.length > 0) await c.env.BUCKET.delete(attachments.map((att: any) => `attachments/${id}/${att.id}/${att.filename}`));
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/bulk", async (c: AppContext) => {
	const parsed = await parseJsonBody(c, BulkRequestSchema);
	if (!parsed.ok) return parsed.response;
	const result = await (c.var.mailboxStub as any).bulkUpdate(parsed.data);
	if ("error" in result) return c.json({ error: result.error }, 400);
	if (result.attachments.length > 0) {
		await c.env.BUCKET.delete(result.attachments.map((a: any) => `attachments/${a.email_id}/${a.id}/${a.filename}`));
	}
	return c.json({ count: result.count });
});

// -- Scheduled sends ("send later") -----------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/schedule", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const parsed = await parseJsonBody(c, ScheduleRequestSchema);
	if (!parsed.ok) return parsed.response;
	const request = parsed.data;

	const when = validateSendAt(request.send_at);
	if (!when.ok) return c.json({ error: when.error }, 400);
	try {
		validateSender(request.email.to, request.email.from, mailboxId, aliasesOf(await readMailboxSettings(c.env.BUCKET, mailboxId)));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}
	const id = crypto.randomUUID();
	await (c.var.mailboxStub as any).scheduleEmail({ id, mailboxId, request, sendAt: when.iso });
	return c.json({ id, status: "scheduled", send_at: when.iso }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId/scheduled", async (c: AppContext) => {
	return c.json({ scheduled: await (c.var.mailboxStub as any).listScheduled() });
});

app.delete("/api/v1/mailboxes/:mailboxId/scheduled/:id", async (c: AppContext) => {
	const ok = await (c.var.mailboxStub as any).cancelScheduled(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Not found, or already sending" }, 404);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const { folderId } = (await c.req.json()) as { folderId: string };
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id")!, folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => c.json(await c.var.mailboxStub.getFolders()));

app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	const f = await c.var.mailboxStub.createFolder(slug, name);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const f = await c.var.mailboxStub.updateFolder(c.req.param("id")!, name);
	return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
});

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
	};
	const overlong = findOverlongSearchTerm({
		query: searchOpts.query as string, from: searchOpts.from as string | undefined,
		to: searchOpts.to as string | undefined, subject: searchOpts.subject as string | undefined,
	});
	if (overlong) return c.json({ error: `Search parameter "${overlong}" is too long (max ${MAX_SEARCH_TERM_LENGTH} characters)` }, 400);
	const stub = c.var.mailboxStub as any;
	const emails = await stub.searchEmails({ ...searchOpts, page: intQuery(c, "page"), limit: intQuery(c, "limit") });
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Contacts (recipient suggestions) ---------------------------------

app.get("/api/v1/mailboxes/:mailboxId/contacts", async (c: AppContext) => {
	const q = (c.req.query("q") || "").slice(0, 100);
	const limit = intQuery(c, "limit") ?? 8;
	const contacts = await (c.var.mailboxStub as any).searchContacts(q, c.req.param("mailboxId"), limit);
	return c.json({ contacts });
});

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.BUCKET.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	headers.set("Content-Type", attachment.mimetype);
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	// PDFs may be previewed in the browser's viewer (?inline=1). Nothing else is
	// ever served inline: the stored type comes from the sender, and nosniff stops
	// the browser from treating a mislabelled file as HTML.
	const inline = c.req.query("inline") === "1" && attachment.mimetype.toLowerCase() === "application/pdf";
	headers.set("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(obj.body, { headers });
});

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	return result;
}

/** The subset of `ForwardableEmailMessage` that receiveEmail uses. */
export type InboundEmailEvent = Pick<ForwardableEmailMessage, "raw" | "rawSize" | "to" | "from">;

async function receiveEmail(event: InboundEmailEvent, env: Env, ctx: ExecutionContext) {
	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	const allowedAddresses = ((env.EMAIL_ADDRESSES ?? []) as string[]).map((a) => a.toLowerCase());
	const allRecipients = (parsedEmail.to || []).map((t) => t.address?.toLowerCase()).filter(Boolean) as string[];
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];

	// The SMTP envelope recipient (RCPT TO) is authoritative: it is what Email
	// Routing matched, and the only address that survives Bcc, Cc-only delivery,
	// aliases and mailing lists. The To: header is only a display/threading hint
	// and routinely names someone else (#32).
	const envelopeTo = event.to?.trim().toLowerCase();
	let mailboxId: string | undefined;
	// Mail to an alias is delivered to the mailbox that owns it (#89).
	const aliasOwner = envelopeTo ? await resolveAlias(env.BUCKET, envelopeTo) : null;
	if (aliasOwner) {
		mailboxId = aliasOwner.toLowerCase();
	} else if (envelopeTo) {
		if (allowedAddresses.length > 0 && !allowedAddresses.includes(envelopeTo)) {
			console.log(`Ignoring email: ${envelopeTo} is not in EMAIL_ADDRESSES.`);
			return;
		}
		mailboxId = envelopeTo;
	} else {
		// No envelope available (e.g. a caller that only supplies the raw message):
		// fall back to the To: header as before.
		if (!allRecipients.length) throw new Error("received email with empty to");
		if (allowedAddresses.length > 0) {
			mailboxId = allRecipients.find((addr) => allowedAddresses.includes(addr));
			if (!mailboxId) { console.log(`Ignoring email: no recipient matches EMAIL_ADDRESSES.`); return; }
		} else { mailboxId = allRecipients[0]; }
	}
	if (!mailboxId) throw new Error("received email with no valid recipient address");

	const messageId = crypto.randomUUID();
	if (!(await env.BUCKET.head(`mailboxes/${mailboxId}.json`))) { console.log(`Ignoring email for ${mailboxId}: mailbox does not exist`); return; }

	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));

	const attachmentData: StoredAttachment[] = [];
	if (parsedEmail.attachments) {
		for (const att of parsedEmail.attachments) {
			const attId = crypto.randomUUID();
			const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
			await env.BUCKET.put(`attachments/${messageId}/${attId}/${filename}`, att.content);
			attachmentData.push({ id: attId, email_id: messageId, filename, mimetype: att.mimeType,
				size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
				content_id: att.contentId || null, disposition: att.disposition || "attachment" });
		}
	}

	const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
	const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
	const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
	// Thread resolution (#85). A reply names its parent in In-Reply-To /
	// References, but the parent's stored thread_id is an internal id (or the
	// root's Message-ID), not the header value. Look the referenced messages up
	// by their stored Message-ID and join the thread of the nearest one we have.
	// If none are stored, keep the old behaviour of keying the thread on the
	// root Message-ID; messages with no threading headers fall back to subject.
	let threadId = emailReferences[0] || inReplyTo || messageId;

	if (inReplyTo || emailReferences.length > 0) {
		const candidates = [inReplyTo, ...[...emailReferences].reverse()].filter(Boolean) as string[];
		const parentThread = await (stub as any).findThreadByMessageIds(candidates);
		if (parentThread) threadId = parentThread;
	} else {
		const subjectThread = await (stub as any).findThreadBySubject(parsedEmail.subject || "", parsedEmail.from?.address || undefined);
		if (subjectThread) threadId = subjectThread;
	}

	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;

	await stub.createEmail(Folders.INBOX, {
		id: messageId, subject: parsedEmail.subject || "",
		sender: (parsedEmail.from?.address || "").toLowerCase(),
		// Header To: for context (e.g. the list address); the envelope recipient when absent.
		recipient: (allRecipients.length > 0 ? allRecipients : [mailboxId]).join(", "),
		cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
		date: resolveReceivedDate(parsedEmail.date), // the message's own Date when plausible, else receipt time
		body: parsedEmail.html || parsedEmail.text || "",
		in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId, message_id: originalMessageId, raw_headers: JSON.stringify(parsedEmail.headers),
	}, attachmentData);

	// Per-mailbox opt-out (#11): skip the agent entirely when auto-draft is off.
	const mailboxSettings = await readMailboxSettings(env.BUCKET, mailboxId);
	if (!isAutoDraftEnabled(mailboxSettings)) {
		console.log(`Auto-draft disabled for ${mailboxId}; skipping agent trigger.`);
		return;
	}

	// Resolve the agent through the SDK: getAgentByName performs the set-name
	// handshake, which a bare idFromName()/get() stub skips. Without it, an agent
	// instance that was never opened in the UI throws "Missing namespace or room
	// headers" and auto-draft silently never runs (#57).
	ctx.waitUntil(
		getAgentByName(env.EMAIL_AGENT, mailboxId)
			.then((agentStub) => agentStub.fetch(new Request("https://agents/onNewEmail", {
				method: "POST", headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mailboxId, emailId: messageId, sender: (parsedEmail.from?.address || "").toLowerCase(), subject: parsedEmail.subject || "", threadId }),
			})))
			.then((res) => {
				if (!res.ok) console.error(`Auto-draft trigger failed for ${mailboxId}: HTTP ${res.status}`);
			})
			.catch((e) => console.error(`Auto-draft trigger failed for ${mailboxId}:`, (e as Error).message)),
	);
}

export { app, receiveEmail };
