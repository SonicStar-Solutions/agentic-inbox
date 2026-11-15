// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { ImapAuthError, ImapClient, ImapCommandError, ImapConnectionError, type ImapCredentials, type ImapTransport } from "./client";

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * A scripted IMAP server. `respond(tag, command)` returns the bytes to send
 * back for each command the client writes. Responses are delivered in small
 * chunks to exercise the reader's reassembly.
 */
function fakeServer(respond: (tag: string, cmd: string) => string, greeting = "* OK ready\r\n", chunk = 7) {
	const sent: string[] = [];
	const queue: Uint8Array[] = [];
	let waiter: ((v: Uint8Array | null) => void) | null = null;
	let closed = false;
	let tlsStarted = false;

	const push = (text: string) => {
		const bytes = enc.encode(text);
		for (let i = 0; i < bytes.length; i += chunk) queue.push(bytes.slice(i, i + chunk));
		if (waiter) {
			const w = waiter;
			waiter = null;
			w(queue.shift() ?? null);
		}
	};
	push(greeting);

	const transport: ImapTransport = {
		read() {
			if (queue.length) return Promise.resolve(queue.shift()!);
			if (closed) return Promise.resolve(null);
			return new Promise((resolve) => {
				waiter = resolve;
			});
		},
		async write(data) {
			const line = dec.decode(data).replace(/\r\n$/, "");
			sent.push(line);
			const [tag, ...rest] = line.split(" ");
			push(respond(tag, rest.join(" ")));
		},
		async startTls() {
			tlsStarted = true;
		},
		async close() {
			closed = true;
			if (waiter) waiter(null);
		},
	};
	return { transport, sent, get tlsStarted() { return tlsStarted; } };
}

const creds: ImapCredentials = { host: "imap.example.com", port: 993, security: "tls", username: "me@example.com", password: "s3cret" };
const open = (s: ReturnType<typeof fakeServer>) => async () => s.transport;

const okLogin = (tag: string, cmd: string) =>
	cmd.startsWith("LOGIN") ? `${tag} OK logged in\r\n` : cmd === "LOGOUT" ? `* BYE\r\n${tag} OK bye\r\n` : "";

describe("ImapClient", () => {
	it("logs in and quotes credentials", async () => {
		const s = fakeServer((tag, cmd) => okLogin(tag, cmd));
		await ImapClient.connect({ ...creds, password: 'p"w\\d' }, open(s));
		expect(s.sent[0]).toBe('A1 LOGIN "me@example.com" "p\\"w\\\\d"');
	});

	it("reports a rejected login as an auth error without echoing the password", async () => {
		const s = fakeServer((tag) => `${tag} NO [AUTHENTICATIONFAILED] bad credentials\r\n`);
		const err = await ImapClient.connect(creds, open(s)).catch((e) => e);
		expect(err).toBeInstanceOf(ImapAuthError);
		expect(err.message).not.toContain("s3cret");
	});

	it("rejects something that is not an IMAP server", async () => {
		const s = fakeServer(() => "", "HTTP/1.1 400 Bad Request\r\n");
		await expect(ImapClient.connect(creds, open(s))).rejects.toBeInstanceOf(ImapConnectionError);
	});

	it("upgrades with STARTTLS before logging in", async () => {
		const s = fakeServer((tag, cmd) => (cmd === "STARTTLS" ? `${tag} OK begin TLS\r\n` : okLogin(tag, cmd)));
		await ImapClient.connect({ ...creds, port: 143, security: "starttls" }, open(s));
		expect(s.sent[0]).toBe("A1 STARTTLS");
		expect(s.tlsStarted).toBe(true);
		expect(s.sent[1]).toContain("LOGIN");
	});

	it("lists folders with flags, delimiters and encoded names", async () => {
		const s = fakeServer((tag, cmd) => {
			if (cmd.startsWith("LIST")) {
				return [
					'* LIST (\\HasNoChildren) "/" INBOX',
					'* LIST (\\Noselect \\HasChildren) "/" "[Gmail]"',
					'* LIST (\\HasNoChildren \\Sent) "/" "[Gmail]/Sent Mail"',
					'* LIST (\\HasNoChildren) "." "Entw&APw-rfe"',
					'* LIST (\\HasNoChildren) NIL "Flat"',
					`${tag} OK done`,
					"",
				].join("\r\n");
			}
			return okLogin(tag, cmd);
		});
		const client = await ImapClient.connect(creds, open(s));
		const folders = await client.list();
		expect(folders.map((f) => f.name)).toEqual(["INBOX", "[Gmail]", "[Gmail]/Sent Mail", "Entwürfe", "Flat"]);
		expect(folders[3].path).toBe("Entw&APw-rfe");
		expect(folders[1].flags).toContain("\\Noselect");
		expect(folders[2].delimiter).toBe("/");
		expect(folders[4].delimiter).toBeNull();
	});

	it("reads STATUS and EXAMINE", async () => {
		const s = fakeServer((tag, cmd) => {
			if (cmd.startsWith("STATUS")) return `* STATUS "INBOX" (MESSAGES 42 UIDNEXT 99 UIDVALIDITY 7)\r\n${tag} OK\r\n`;
			if (cmd.startsWith("EXAMINE")) return `* 42 EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n* OK [UIDNEXT 99] ok\r\n${tag} OK [READ-ONLY] done\r\n`;
			return okLogin(tag, cmd);
		});
		const client = await ImapClient.connect(creds, open(s));
		expect(await client.status("INBOX")).toEqual({ messages: 42, uidNext: 99, uidValidity: 7 });
		expect(await client.examine("INBOX")).toEqual({ messages: 42, uidNext: 99, uidValidity: 7 });
		expect(client.selected).toBe("INBOX");
	});

	it("fetches summaries with literals and ignores unsolicited updates", async () => {
		const h1 = "Message-ID: <a@x>\r\nSubject: One\r\n\r\n";
		const h2 = "Subject: Two\r\n\r\n";
		const s = fakeServer((tag, cmd) => {
			if (cmd.startsWith("UID FETCH")) {
				return (
					`* 1 FETCH (UID 10 FLAGS (\\Seen) RFC822.SIZE 1234 BODY[HEADER.FIELDS (MESSAGE-ID DATE FROM SUBJECT)] {${h1.length}}\r\n${h1})\r\n` +
					`* 2 FETCH (FLAGS (\\Seen))\r\n` +
					`* 3 FETCH (UID 12 FLAGS (\\Flagged \\Seen) RFC822.SIZE 99 BODY[HEADER.FIELDS (MESSAGE-ID DATE FROM SUBJECT)] {${h2.length}}\r\n${h2})\r\n` +
					`${tag} OK done\r\n`
				);
			}
			return okLogin(tag, cmd);
		});
		const client = await ImapClient.connect(creds, open(s));
		const out = await client.fetchSummaries("10:12");
		expect(out.map((m) => [m.uid, m.size, m.flags])).toEqual([
			[10, 1234, ["\\Seen"]],
			[12, 99, ["\\Flagged", "\\Seen"]],
		]);
		expect(dec.decode(out[0].header!)).toBe(h1);
		expect(s.sent.at(-1)).toContain("BODY.PEEK[HEADER.FIELDS");
	});

	it("fetches a body that contains lines looking like protocol text", async () => {
		const body = "Subject: tricky\r\n\r\nA1 OK fake completion\r\n* 99 EXISTS\r\n{5}\r\n";
		const s = fakeServer((tag, cmd) =>
			cmd.startsWith("UID FETCH") ? `* 1 FETCH (UID 5 BODY[] {${enc.encode(body).length}}\r\n${body})\r\n${tag} OK done\r\n` : okLogin(tag, cmd),
		);
		const client = await ImapClient.connect(creds, open(s));
		expect(dec.decode(await client.fetchBody(5))).toBe(body);
		expect(s.sent.at(-1)).toContain("BODY.PEEK[]");
	});

	it("counts UIDs in a range", async () => {
		const s = fakeServer((tag, cmd) => (cmd.startsWith("UID SEARCH") ? `* SEARCH 1 2 5 9\r\n${tag} OK\r\n` : okLogin(tag, cmd)));
		const client = await ImapClient.connect(creds, open(s));
		expect(await client.countUids("1:9")).toBe(4);
	});

	it("throws a command error when the server says NO, and a connection error when it hangs up", async () => {
		const s = fakeServer((tag, cmd) => (cmd.startsWith("EXAMINE") ? `${tag} NO [NONEXISTENT] no such folder\r\n` : okLogin(tag, cmd)));
		const client = await ImapClient.connect(creds, open(s));
		await expect(client.examine("Nope")).rejects.toBeInstanceOf(ImapCommandError);
		await client.logout();
		await expect(client.status("INBOX")).rejects.toBeInstanceOf(ImapConnectionError);
	});

	it("says a missing message is gone", async () => {
		const s = fakeServer((tag, cmd) => (cmd.startsWith("UID FETCH") ? `${tag} OK nothing\r\n` : okLogin(tag, cmd)));
		const client = await ImapClient.connect(creds, open(s));
		await expect(client.fetchBody(7)).rejects.toBeInstanceOf(ImapCommandError);
	});
});
