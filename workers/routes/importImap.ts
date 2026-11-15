// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * HTTP controls for a mailbox's IMAP import:
 *   POST .../import/imap/test              sign in and list folders, import nothing
 *   POST .../import/imap/start             start an import
 *   GET  .../import/imap/status            progress, failures
 *   POST .../import/imap/cancel            stop the running import
 *   POST .../import/imap/retry-failed      re-run only the failed messages
 *   POST .../import/imap/dismiss-failures  clear the failure log
 *
 * The password is accepted on test, start and retry-failed and is never
 * returned or logged.
 */
import type { Context } from "hono";
import { z } from "zod";
import type { FolderTarget } from "../../shared/import";
import { accessEmail } from "../lib/access-identity";
import { parseJsonBody } from "../lib/http";
import { ImapAuthError, ImapCommandError, ImapConnectionError, type ImapCredentials } from "../lib/imap/client";
import { isValidTarget } from "../lib/imap/folders";
import { validateImapHost } from "../lib/imap/hosts";
import { probeImap } from "../lib/imap/probe";
import type { MailboxContext } from "../lib/mailbox";

type AppContext = Context<MailboxContext>;

const ConnectionSchema = z.object({
	host: z.string().min(1).max(253),
	port: z.number().int().positive().default(993),
	security: z.enum(["tls", "starttls"]).optional(),
	username: z.string().min(1).max(320),
	password: z.string().min(1).max(1024),
});

const StartSchema = ConnectionSchema.extend({
	folderMap: z.record(z.string().max(500), z.string().max(90).nullable()).optional(),
});

const RetrySchema = z.object({ password: z.string().min(1).max(1024) });

function stubFor(c: AppContext) {
	const mailboxId = decodeURIComponent(c.req.param("mailboxId")!);
	return { mailboxId, stub: c.env.IMPORT_JOB.get(c.env.IMPORT_JOB.idFromName(mailboxId)) };
}

/** Validate the host and port and fill in the connection security. */
function toCredentials(c: AppContext, body: z.infer<typeof ConnectionSchema>): { creds: ImapCredentials } | { response: Response } {
	const check = validateImapHost(body.host, body.port, c.env.IMPORT_ALLOWED_PORTS);
	if (!check.ok) return { response: c.json({ error: check.error, code: "host" }, 400) };
	return {
		creds: {
			host: check.host,
			port: check.port,
			security: body.security ?? (check.port === 143 ? "starttls" : "tls"),
			username: body.username,
			password: body.password,
		},
	};
}

export function describeConnectError(e: unknown): { status: 400 | 422 | 502; body: { error: string; code: string } } {
	if (e instanceof ImapAuthError) return { status: 422, body: { error: e.message, code: "auth" } };
	if (e instanceof ImapConnectionError) return { status: 502, body: { error: e.message, code: "connect" } };
	if (e instanceof ImapCommandError) return { status: 502, body: { error: e.message, code: "server" } };
	return { status: 502, body: { error: "Could not talk to the mail server.", code: "connect" } };
}

export async function handleProbeImap(c: AppContext) {
	const parsed = await parseJsonBody(c, ConnectionSchema);
	if (!parsed.ok) return parsed.response;
	const built = toCredentials(c, parsed.data);
	if ("response" in built) return built.response;
	try {
		return c.json(await probeImap(built.creds));
	} catch (e) {
		const { status, body } = describeConnectError(e);
		return c.json(body, status);
	}
}

export async function handleStartImapImport(c: AppContext) {
	const parsed = await parseJsonBody(c, StartSchema);
	if (!parsed.ok) return parsed.response;
	const built = toCredentials(c, parsed.data);
	if ("response" in built) return built.response;

	const folderMap: Record<string, FolderTarget> = {};
	for (const [path, target] of Object.entries(parsed.data.folderMap ?? {})) {
		if (!isValidTarget(target)) return c.json({ error: `Invalid destination for "${path}"`, code: "folderMap" }, 400);
		folderMap[path] = target;
	}

	const { mailboxId, stub } = stubFor(c);
	try {
		const status = await stub.startImport({
			mailboxId,
			startedBy: accessEmail(c.req.raw),
			host: built.creds.host,
			port: built.creds.port,
			security: built.creds.security,
			username: built.creds.username,
			password: built.creds.password,
			folderMap,
		});
		return c.json(status, 202);
	} catch (e) {
		return c.json({ error: (e as Error).message, code: "running" }, 409);
	}
}

export async function handleGetImapImportStatus(c: AppContext) {
	return c.json(await stubFor(c).stub.getStatus());
}

export async function handleCancelImapImport(c: AppContext) {
	return c.json(await stubFor(c).stub.cancel());
}

export async function handleRetryFailedImport(c: AppContext) {
	const parsed = await parseJsonBody(c, RetrySchema);
	if (!parsed.ok) return parsed.response;
	try {
		return c.json(await stubFor(c).stub.retryFailed(parsed.data.password), 202);
	} catch (e) {
		return c.json({ error: (e as Error).message, code: "retry" }, 409);
	}
}

export async function handleDismissImportFailures(c: AppContext) {
	return c.json(await stubFor(c).stub.dismissFailures());
}
