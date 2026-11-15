// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The real network transport for the IMAP client, built on the Workers
 * `cloudflare:sockets` API. Kept in its own file so the client and its tests do
 * not import a Workers-only module.
 *
 * Reads are pull-based (no background loop), so no read is pending between
 * commands. That is what lets STARTTLS swap the socket safely.
 */
import { connect } from "cloudflare:sockets";
import { ImapConnectionError, type ImapSecurity, type ImapTransport } from "./client";

const CONNECT_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new ImapConnectionError(message)), ms);
	});
	return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function openSocketTransport(host: string, port: number, security: ImapSecurity): Promise<ImapTransport> {
	let socket = connect({ hostname: host, port }, { secureTransport: security === "tls" ? "on" : "starttls", allowHalfOpen: false });
	try {
		await withTimeout(socket.opened, CONNECT_TIMEOUT_MS, `Could not connect to ${host}:${port}`);
	} catch (e) {
		try {
			await socket.close();
		} catch {
			// already closed
		}
		throw e instanceof ImapConnectionError ? e : new ImapConnectionError(`Could not connect to ${host}:${port}`);
	}

	let reader = socket.readable.getReader();
	let writer = socket.writable.getWriter();

	return {
		async read() {
			try {
				const { value, done } = await withTimeout(reader.read(), READ_TIMEOUT_MS, "The server stopped responding");
				return done ? null : value;
			} catch (e) {
				if (e instanceof ImapConnectionError) throw e;
				throw new ImapConnectionError("Connection lost");
			}
		},
		async write(data) {
			try {
				await writer.write(data);
			} catch {
				throw new ImapConnectionError("Connection lost");
			}
		},
		async startTls() {
			reader.releaseLock();
			writer.releaseLock();
			socket = socket.startTls({ expectedServerHostname: host });
			reader = socket.readable.getReader();
			writer = socket.writable.getWriter();
		},
		async close() {
			try {
				await socket.close();
			} catch {
				// already closed
			}
		},
	};
}
