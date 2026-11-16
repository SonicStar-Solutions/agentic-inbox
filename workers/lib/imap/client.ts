// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * A small IMAP4rev1 client for importing mail. It is read-only by design: it
 * only uses LOGIN, LIST, STATUS, EXAMINE, UID SEARCH, UID FETCH (with
 * BODY.PEEK, so nothing is marked as read) and LOGOUT. It never changes or
 * deletes anything on the old server.
 *
 * The network is behind `ImapTransport`, so tests drive the client with a
 * scripted fake and the real socket code lives in socket-transport.ts.
 */
import { MAX_IMPORT_SIZE, type SourceFolder } from "../../../shared/import";
import { decodeMailboxName } from "./utf7";

export type ImapSecurity = "tls" | "starttls";

export interface ImapCredentials {
	host: string;
	port: number;
	security: ImapSecurity;
	username: string;
	password: string;
}

export interface ImapTransport {
	/** Next chunk of bytes, or null when the server closed the connection. */
	read(): Promise<Uint8Array | null>;
	write(data: Uint8Array): Promise<void>;
	/** Upgrade a plain connection to TLS (STARTTLS). */
	startTls?(): Promise<void>;
	close(): Promise<void>;
}

export type OpenTransport = (host: string, port: number, security: ImapSecurity) => Promise<ImapTransport>;

/** The connection dropped or timed out. Worth retrying. */
export class ImapConnectionError extends Error {}
/** The server refused the username or password. Retrying will not help. */
export class ImapAuthError extends Error {}
/** The server answered NO/BAD to a command. */
export class ImapCommandError extends Error {}

export interface FolderStatus {
	messages: number;
	uidNext: number;
	uidValidity: number;
}

export interface MessageSummary {
	uid: number;
	flags: string[];
	size: number;
	/** Raw header block (Message-ID, Date, From, Subject), if the server sent one. */
	header: Uint8Array | null;
}

interface UntaggedResponse {
	/** The response line, with each literal replaced by a NUL placeholder. */
	line: string;
	literals: Uint8Array[];
}

const encoder = new TextEncoder();
const MAX_LITERAL = MAX_IMPORT_SIZE + 5 * 1024 * 1024;

/** Buffers transport bytes and exposes line and exact-length reads. */
class ByteReader {
	private buf: Uint8Array = new Uint8Array(0);
	private decoder = new TextDecoder();

	constructor(private transport: ImapTransport) {}

	private async fill(): Promise<void> {
		const chunk = await this.transport.read();
		if (chunk === null) throw new ImapConnectionError("The server closed the connection");
		if (this.buf.length === 0) {
			this.buf = chunk;
			return;
		}
		const merged = new Uint8Array(this.buf.length + chunk.length);
		merged.set(this.buf, 0);
		merged.set(chunk, this.buf.length);
		this.buf = merged;
	}

	async readLine(): Promise<string> {
		let from = 0;
		for (;;) {
			for (let i = from; i < this.buf.length - 1; i++) {
				if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
					const line = this.decoder.decode(this.buf.subarray(0, i));
					this.buf = this.buf.subarray(i + 2);
					return line;
				}
			}
			from = Math.max(0, this.buf.length - 1);
			await this.fill();
		}
	}

	async readExact(n: number): Promise<Uint8Array> {
		while (this.buf.length < n) await this.fill();
		const out = this.buf.slice(0, n);
		this.buf = this.buf.subarray(n);
		return out;
	}
}

function quote(s: string): string {
	return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function unquote(s: string): string {
	return s.replace(/\\(["\\])/g, "$1");
}

/** Parse `* LIST (\flags) "/" name`. Returns null for lines that are not LIST responses. */
export function parseListLine(res: UntaggedResponse): SourceFolder | null {
	const m = res.line.match(/^\* LIST \(([^)]*)\) (?:"((?:[^"\\]|\\.)*)"|NIL) (.+)$/i);
	if (!m) return null;
	const flags = m[1].split(/\s+/).filter(Boolean);
	const delimiter = m[2] === undefined ? null : unquote(m[2]);
	const nameToken = m[3].trim();
	let path: string;
	if (nameToken.startsWith('"')) {
		const q = nameToken.match(/^"((?:[^"\\]|\\.)*)"$/);
		path = q ? unquote(q[1]) : nameToken;
	} else if (nameToken === "\u0000") {
		path = new TextDecoder().decode(res.literals[0] ?? new Uint8Array(0));
	} else {
		path = nameToken;
	}
	if (!path) return null;
	return { path, name: decodeMailboxName(path), delimiter, flags };
}

export class ImapClient {
	private reader: ByteReader;
	private tagCounter = 0;
	/** Folder currently open with EXAMINE, so callers can tell if they must reopen it. */
	selected: string | null = null;

	private constructor(private transport: ImapTransport) {
		this.reader = new ByteReader(transport);
	}

	static async connect(creds: ImapCredentials, open?: OpenTransport): Promise<ImapClient> {
		const opener = open ?? (async (h, p, s) => (await import("./socket-transport")).openSocketTransport(h, p, s));
		const transport = await opener(creds.host, creds.port, creds.security);
		const client = new ImapClient(transport);
		try {
			const greeting = await client.reader.readLine();
			if (!/^\* (OK|PREAUTH)/i.test(greeting)) {
				throw new ImapConnectionError("The server did not greet us like an IMAP server");
			}
			if (creds.security === "starttls") {
				await client.command("STARTTLS");
				if (!transport.startTls) throw new ImapConnectionError("STARTTLS is not supported here");
				await transport.startTls();
				client.reader = new ByteReader(transport);
			}
			await client.login(creds.username, creds.password);
			return client;
		} catch (e) {
			await transport.close().catch(() => {});
			throw e;
		}
	}

	private nextTag(): string {
		this.tagCounter++;
		return `A${this.tagCounter}`;
	}

	/** Reads responses until the tagged completion, reassembling literals. */
	private async readUntilTagged(tag: string): Promise<{ ok: boolean; text: string; untagged: UntaggedResponse[] }> {
		const untagged: UntaggedResponse[] = [];
		for (;;) {
			const line = await this.reader.readLine();
			if (line.startsWith(`${tag} `)) {
				return { ok: /^\S+ OK\b/i.test(line), text: line, untagged };
			}
			let text = line;
			const literals: Uint8Array[] = [];
			for (let m = text.match(/\{(\d+)\}$/); m; m = text.match(/\{(\d+)\}$/)) {
				const n = Number(m[1]);
				if (n > MAX_LITERAL) throw new ImapConnectionError("The server sent a message that is too large");
				literals.push(await this.reader.readExact(n));
				text = `${text.slice(0, -m[0].length)}\u0000${await this.reader.readLine()}`;
			}
			untagged.push({ line: text, literals });
		}
	}

	/** Send a command and return its responses; throws ImapCommandError on NO/BAD. */
	private async command(cmd: string, label = cmd.split(" ")[0]): Promise<UntaggedResponse[]> {
		const tag = this.nextTag();
		await this.transport.write(encoder.encode(`${tag} ${cmd}\r\n`));
		const res = await this.readUntilTagged(tag);
		if (!res.ok) throw new ImapCommandError(`${label} failed: ${res.text.replace(/^\S+\s+/, "")}`);
		return res.untagged;
	}

	private async login(username: string, password: string): Promise<void> {
		try {
			await this.command(`LOGIN ${quote(username)} ${quote(password)}`, "LOGIN");
		} catch (e) {
			if (e instanceof ImapCommandError) {
				throw new ImapAuthError("The server rejected the username or password.");
			}
			throw e;
		}
	}

	async list(): Promise<SourceFolder[]> {
		const res = await this.command('LIST "" "*"');
		return res.map(parseListLine).filter((f): f is SourceFolder => f !== null);
	}

	async status(path: string): Promise<FolderStatus> {
		const res = await this.command(`STATUS ${quote(path)} (MESSAGES UIDNEXT UIDVALIDITY)`);
		const line = res.find((r) => /^\* STATUS /i.test(r.line))?.line ?? "";
		const num = (key: string) => Number(line.match(new RegExp(`${key} (\\d+)`, "i"))?.[1] ?? 0);
		return { messages: num("MESSAGES"), uidNext: num("UIDNEXT"), uidValidity: num("UIDVALIDITY") };
	}

	/** Open a folder read-only. */
	async examine(path: string): Promise<FolderStatus> {
		const res = await this.command(`EXAMINE ${quote(path)}`);
		this.selected = path;
		const all = res.map((r) => r.line).join("\n");
		const num = (re: RegExp) => Number(all.match(re)?.[1] ?? 0);
		return {
			messages: num(/\* (\d+) EXISTS/i),
			uidNext: num(/\[UIDNEXT (\d+)\]/i),
			uidValidity: num(/\[UIDVALIDITY (\d+)\]/i),
		};
	}

	/** Count messages with a UID in the given range ("1:99"). */
	async countUids(range: string): Promise<number> {
		const res = await this.command(`UID SEARCH UID ${range}`, "SEARCH");
		const line = res.find((r) => r.line.startsWith("* SEARCH"))?.line ?? "";
		return line.slice("* SEARCH".length).trim().split(/\s+/).filter(Boolean).length;
	}

	/**
	 * Flags, size and a small header block for each message in a UID set
	 * ("120:169" or "5,9,12"). Cheap enough to run on whole windows of messages
	 * so duplicates are found without downloading them.
	 */
	async fetchSummaries(uidSet: string): Promise<MessageSummary[]> {
		const res = await this.command(
			`UID FETCH ${uidSet} (UID FLAGS RFC822.SIZE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID DATE FROM SUBJECT)])`,
			"FETCH",
		);
		const out: MessageSummary[] = [];
		for (const r of res) {
			if (!/^\* \d+ FETCH /i.test(r.line)) continue;
			const uid = r.line.match(/\bUID (\d+)/i)?.[1];
			if (!uid) continue; // an unsolicited flag update
			const flags = r.line.match(/FLAGS \(([^)]*)\)/i)?.[1].split(/\s+/).filter(Boolean) ?? [];
			const size = Number(r.line.match(/RFC822\.SIZE (\d+)/i)?.[1] ?? 0);
			out.push({ uid: Number(uid), flags, size, header: r.literals[0] ?? null });
		}
		return out.sort((a, b) => a.uid - b.uid);
	}

	/** The full RFC 5322 source of one message. */
	async fetchBody(uid: number): Promise<Uint8Array> {
		const res = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`, "FETCH");
		for (const r of res) {
			if (/^\* \d+ FETCH /i.test(r.line) && r.literals[0]) return r.literals[0];
		}
		throw new ImapCommandError("The message is no longer on the server");
	}

	/** Say goodbye (waiting at most a few seconds) and close the connection. */
	async logout(): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.command("LOGOUT"),
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, 3000);
				}),
			]);
		} catch {
			// closing anyway
		} finally {
			clearTimeout(timer);
			await this.transport.close().catch(() => {});
		}
	}
}
