// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import type { SourceFolder } from "../../shared/import";
import { ImapAuthError, type ImapCredentials, ImapCommandError, ImapConnectionError, type FolderStatus, type MessageSummary } from "./imap/client";
import {
	BACKOFF_MS,
	type EngineDeps,
	ImportEngine,
	type ImportSource,
	type ImportState,
	MESSAGES_PER_TICK,
	STALE_AFTER_MS,
	expireIfStale,
	idleState,
} from "./import-engine";

const enc = new TextEncoder();

interface FakeMsg {
	uid: number;
	flags?: string[];
	id?: string | null; // Message-ID; null = header has none
	size?: number;
}
interface FakeFolder {
	flags?: string[];
	uidValidity?: number;
	msgs: FakeMsg[];
}

function makeSource(folders: Record<string, FakeFolder>, hooks: { failBody?: Set<string>; dropOnBody?: { n: number }; bodies?: string[] } = {}): ImportSource {
	let selected = "";
	const f = (p: string) => folders[p];
	const uidNext = (p: string) => Math.max(0, ...f(p).msgs.map((m) => m.uid)) + 1;
	const status = (p: string): FolderStatus => ({ messages: f(p).msgs.length, uidNext: uidNext(p), uidValidity: f(p).uidValidity ?? 1 });
	return {
		async list() {
			return Object.keys(folders).map((path): SourceFolder => ({ path, name: path, delimiter: "/", flags: f(path).flags ?? [] }));
		},
		async status(p) {
			return status(p);
		},
		async examine(p) {
			if (!folders[p]) throw new ImapCommandError("EXAMINE failed: no such folder");
			selected = p;
			return status(p);
		},
		async countUids(range) {
			const [, hi] = range.split(":").map(Number);
			return f(selected).msgs.filter((m) => m.uid <= hi).length;
		},
		async fetchSummaries(set) {
			const uids = new Set<number>();
			for (const part of set.split(",")) {
				const [a, b] = part.split(":").map(Number);
				if (b === undefined) uids.add(a);
				else for (const m of f(selected).msgs) if (m.uid >= a && m.uid <= b) uids.add(m.uid);
			}
			return f(selected)
				.msgs.filter((m) => uids.has(m.uid))
				.map((m): MessageSummary => {
					const hdr = `${m.id === null ? "" : `Message-ID: <${m.id ?? `${selected}-${m.uid}@old`}>\r\n`}Subject: s${m.uid}\r\n\r\n`;
					return { uid: m.uid, flags: m.flags ?? [], size: m.size ?? 100, header: enc.encode(hdr) };
				});
		},
		async fetchBody(uid) {
			if (hooks.dropOnBody && hooks.dropOnBody.n > 0) {
				hooks.dropOnBody.n--;
				throw new ImapConnectionError("Connection lost");
			}
			if (hooks.failBody?.has(`${selected}:${uid}`)) throw new ImapCommandError("FETCH failed: BAD parse error");
			hooks.bodies?.push(`${selected}:${uid}`);
			return enc.encode(JSON.stringify({ folder: selected, uid }));
		},
		async logout() {},
	};
}

function makeDeps(source: () => ImportSource, opts: { existing?: string[]; connectErrors?: Error[]; storeError?: (uid: number) => boolean } = {}) {
	const ids = new Set(opts.existing ?? []);
	const stored: { id: string | null; folder: string; read: boolean; starred: boolean }[] = [];
	const created: string[] = [];
	const connectErrors = [...(opts.connectErrors ?? [])];
	const log = { connects: 0, notifies: 0, clock: 1_700_000_000_000 };
	const deps: EngineDeps = {
		async connect(_creds: ImapCredentials) {
			log.connects++;
			const err = connectErrors.shift();
			if (err) throw err;
			return source();
		},
		async hasMessage(id) {
			return ids.has(id);
		},
		async ensureFolder(name) {
			created.push(name);
			return `custom-${name.toLowerCase().replace(/\W+/g, "-")}`;
		},
		async importMessage(raw, options) {
			const { uid } = JSON.parse(new TextDecoder().decode(raw));
			if (opts.storeError?.(uid)) throw new Error("database is on fire");
			if (options.messageId && ids.has(options.messageId)) return { duplicate: true };
			if (options.messageId) ids.add(options.messageId);
			stored.push({ id: options.messageId, folder: options.folder, read: options.read, starred: options.starred });
			return { duplicate: false };
		},
		async notify() {
			log.notifies++;
		},
		now: () => log.clock,
	};
	return { deps, ids, stored, created, log };
}

function newState(folderMap: ImportState["folderMap"] = {}): ImportState {
	const s = idleState();
	s.status = "running";
	s.mailboxId = "alice@example.com";
	s.startedBy = "alice@example.com";
	s.creds = { host: "imap.old.com", port: 993, security: "tls", username: "alice", password: "hunter2" };
	s.source = { host: "imap.old.com", port: 993, security: "tls", username: "alice" };
	s.folderMap = folderMap;
	s.startedAt = s.updatedAt = new Date(1_700_000_000_000).toISOString();
	return s;
}

async function run(engine: ImportEngine, state: ImportState, maxTicks = 2000): Promise<number> {
	let ticks = 0;
	while (ticks < maxTicks) {
		ticks++;
		if ((await engine.tick(state)) === null) break;
	}
	return ticks;
}

const seq = (n: number, from = 1): FakeMsg[] => Array.from({ length: n }, (_, i) => ({ uid: from + i }));

describe("import engine", () => {
	it("imports every mapped folder, Inbox first, and carries flags over", async () => {
		const folders = {
			Sent: { flags: ["\\Sent"], msgs: [{ uid: 1 }] },
			INBOX: { msgs: [{ uid: 1, flags: ["\\Seen", "\\Flagged"] }, { uid: 2 }] },
			Clients: { msgs: [{ uid: 7 }] },
			"[Gmail]": { flags: ["\\Noselect"], msgs: [] },
		};
		const t = makeDeps(() => makeSource(folders));
		const state = newState();
		await run(new ImportEngine(t.deps), state);

		expect(state.status).toBe("done");
		expect(state.counts).toEqual({ imported: 4, skipped: 0, failed: 0 });
		expect(state.totals).toEqual({ folders: 3, messages: 4 });
		expect(t.stored.map((m) => m.folder)).toEqual(["inbox", "inbox", "sent", "custom-clients"]);
		expect(t.stored[0]).toMatchObject({ read: true, starred: true });
		expect(t.stored[1]).toMatchObject({ read: false, starred: false });
		expect(t.created).toEqual(["Clients"]);
	});

	it("honours the folder map, including skipped folders", async () => {
		const folders = { INBOX: { msgs: seq(2) }, Junk: { msgs: seq(3) }, Old: { msgs: seq(1) } };
		const t = makeDeps(() => makeSource(folders));
		const state = newState({ Junk: null, Old: "archive", INBOX: "inbox" });
		await run(new ImportEngine(t.deps), state);
		expect(state.counts.imported).toBe(3);
		expect(t.stored.map((m) => m.folder).sort()).toEqual(["archive", "inbox", "inbox"]);
	});

	it("skips messages already in the mailbox without downloading them", async () => {
		const bodies: string[] = [];
		const folders = { INBOX: { msgs: [{ uid: 1, id: "dup@x" }, { uid: 2, id: "new@x" }] } };
		const t = makeDeps(() => makeSource(folders, { bodies }), { existing: ["dup@x"] });
		const state = newState();
		await run(new ImportEngine(t.deps), state);
		expect(state.counts).toEqual({ imported: 1, skipped: 1, failed: 0 });
		expect(bodies).toEqual(["INBOX:2"]);
	});

	it("imports a message once when it is in two folders (Gmail All Mail)", async () => {
		const folders = {
			INBOX: { msgs: [{ uid: 1, id: "a@x" }] },
			"[Gmail]/All Mail": { flags: ["\\All"], msgs: [{ uid: 1, id: "a@x" }, { uid: 2, id: "archived@x" }] },
		};
		const t = makeDeps(() => makeSource(folders));
		const state = newState();
		await run(new ImportEngine(t.deps), state);
		expect(state.counts).toEqual({ imported: 2, skipped: 1, failed: 0 });
		expect(t.stored.map((m) => [m.id, m.folder])).toEqual([
			["a@x", "inbox"],
			["archived@x", "archive"],
		]);
	});

	it("dedupes messages that have no Message-ID by a stable key", async () => {
		const folders = { INBOX: { msgs: [{ uid: 1, id: null }] } };
		const t = makeDeps(() => makeSource(folders));
		const first = newState();
		await run(new ImportEngine(t.deps), first);
		expect(first.counts.imported).toBe(1);
		expect(t.stored[0].id).toMatch(/^import-[0-9a-f]{32}@import\.invalid$/);

		const again = newState(); // fresh state: no cursor, so only the key can save us
		await run(new ImportEngine(t.deps), again);
		expect(again.counts).toEqual({ imported: 0, skipped: 1, failed: 0 });
	});

	it("only does a few downloads per tick and tells the browser once", async () => {
		const folders = { INBOX: { msgs: seq(12) } };
		const t = makeDeps(() => makeSource(folders));
		const state = newState();
		const engine = new ImportEngine(t.deps);
		await engine.tick(state); // builds the plan and does the first batch
		expect(state.counts.imported).toBe(MESSAGES_PER_TICK);
		expect(t.log.notifies).toBe(1);
		await run(engine, state);
		expect(state.counts.imported).toBe(12);
	});

	it("resumes after the process dies, with no duplicates and no gaps", async () => {
		const folders = { INBOX: { msgs: seq(23) } };
		const t = makeDeps(() => makeSource(folders));
		const state = newState();
		await new ImportEngine(t.deps).tick(state);
		await new ImportEngine(t.deps).tick(state);
		expect(state.counts.imported).toBe(2 * MESSAGES_PER_TICK);

		// A brand-new engine and a state that went through storage.
		const revived: ImportState = JSON.parse(JSON.stringify(state));
		await run(new ImportEngine(t.deps), revived);
		expect(revived.status).toBe("done");
		expect(t.stored).toHaveLength(23);
		expect(new Set(t.stored.map((m) => m.id)).size).toBe(23);
	});

	it("a second run for the same account only imports new mail", async () => {
		const folders: Record<string, FakeFolder> = { INBOX: { msgs: seq(6) } };
		const t = makeDeps(() => makeSource(folders));
		const first = newState();
		await run(new ImportEngine(t.deps), first);
		expect(first.counts.imported).toBe(6);

		folders.INBOX.msgs.push(...seq(2, 7));
		const second = newState();
		second.cursors = first.cursors; // what the Durable Object keeps between runs
		await run(new ImportEngine(t.deps), second);
		expect(second.counts.imported).toBe(2);
		expect(second.counts.skipped).toBe(6);
		expect(t.stored).toHaveLength(8);
	});

	it("ignores the cursor when the server rebuilt the folder (UIDVALIDITY changed)", async () => {
		const folders: Record<string, FakeFolder> = { INBOX: { uidValidity: 1, msgs: seq(3) } };
		const t = makeDeps(() => makeSource(folders));
		const first = newState();
		await run(new ImportEngine(t.deps), first);

		folders.INBOX = { uidValidity: 2, msgs: seq(3) }; // same Message-IDs, new numbering
		const second = newState();
		second.cursors = first.cursors;
		await run(new ImportEngine(t.deps), second);
		expect(second.counts).toEqual({ imported: 0, skipped: 3, failed: 0 }); // Message-ID dedupe still saves us
	});

	it("walks sparse UID ranges without a long list", async () => {
		const folders = { INBOX: { msgs: [{ uid: 1 }, { uid: 900 }, { uid: 250_000 }] } };
		const t = makeDeps(() => makeSource(folders));
		const state = newState();
		const ticks = await run(new ImportEngine(t.deps), state);
		expect(state.counts.imported).toBe(3);
		expect(ticks).toBeLessThan(10);
	});

	it("records a message that cannot be fetched or stored and keeps going", async () => {
		const folders = { INBOX: { msgs: seq(4) } };
		const t = makeDeps(() => makeSource(folders, { failBody: new Set(["INBOX:2"]) }), { storeError: (uid) => uid === 3 });
		const state = newState();
		await run(new ImportEngine(t.deps), state);
		expect(state.status).toBe("done");
		expect(state.counts).toEqual({ imported: 2, skipped: 0, failed: 2 });
		expect(state.failures.map((f) => f.uid)).toEqual([2, 3]);
		expect(state.failures[0]).toMatchObject({ folder: "INBOX", path: "INBOX", uidValidity: 1 });
		// The log holds folder, number and reason only.
		expect(JSON.stringify(state.failures)).not.toMatch(/subject|sender|@/i);
	});

	it("fails messages over the size limit without downloading them", async () => {
		const bodies: string[] = [];
		const folders = { INBOX: { msgs: [{ uid: 1, size: 30 * 1024 * 1024 }, { uid: 2 }] } };
		const t = makeDeps(() => makeSource(folders, { bodies }));
		const state = newState();
		await run(new ImportEngine(t.deps), state);
		expect(bodies).toEqual(["INBOX:2"]);
		expect(state.failures[0].reason).toMatch(/Larger than 25 MB/);
	});

	it("caps the stored failures but still counts them", async () => {
		const folders = { INBOX: { msgs: seq(260) } };
		const all = new Set(seq(260).map((m) => `INBOX:${m.uid}`));
		const t = makeDeps(() => makeSource(folders, { failBody: all }));
		const state = newState();
		await run(new ImportEngine(t.deps), state);
		expect(state.failures).toHaveLength(200);
		expect(state.failureCount).toBe(260);
		expect(state.counts.failed).toBe(260);
	});

	it("a folder that cannot be opened is reported and skipped", async () => {
		const folders = { INBOX: { msgs: seq(1) }, Weird: { msgs: seq(1) } };
		const source = makeSource(folders);
		const examine = source.examine.bind(source);
		source.examine = async (p) => {
			if (p === "Weird") throw new ImapCommandError("EXAMINE failed: permission denied");
			return examine(p);
		};
		const t = makeDeps(() => source);
		const state = newState();
		await run(new ImportEngine(t.deps), state);
		expect(state.status).toBe("done");
		expect(state.counts.imported).toBe(1);
		expect(state.failures[0]).toMatchObject({ folder: "Weird", uid: 0 });
	});

	describe("errors", () => {
		it("backs off and recovers from a dropped connection without losing or repeating a message", async () => {
			const folders = { INBOX: { msgs: seq(4) } };
			const drop = { n: 2 };
			const t = makeDeps(() => makeSource(folders, { dropOnBody: drop }));
			const state = newState();
			const engine = new ImportEngine(t.deps);

			expect(await engine.tick(state)).toBe(BACKOFF_MS[0]);
			expect(state.retry).toMatchObject({ attempt: 1 });
			expect(await engine.tick(state)).toBe(BACKOFF_MS[1]);
			expect(state.retry).toMatchObject({ attempt: 2 });

			await run(engine, state);
			expect(state.status).toBe("done");
			expect(state.retry).toBeNull();
			expect(state.counts.imported).toBe(4);
			expect(new Set(t.stored.map((m) => m.id)).size).toBe(4);
			expect(t.log.connects).toBeGreaterThan(2);
		});

		it("gives up after the last backoff and wipes the password", async () => {
			const folders = { INBOX: { msgs: seq(2) } };
			const t = makeDeps(() => makeSource(folders), { connectErrors: Array.from({ length: 20 }, () => new ImapConnectionError("Could not connect")) });
			const state = newState();
			await run(new ImportEngine(t.deps), state);
			expect(state.status).toBe("error");
			expect(state.error).toMatch(/Lost the connection/);
			expect(state.creds).toBeNull();
		});

		it("stops at once on a rejected password and wipes it", async () => {
			const t = makeDeps(() => makeSource({}), { connectErrors: [new ImapAuthError("The server rejected the username or password.")] });
			const state = newState();
			const ticks = await run(new ImportEngine(t.deps), state);
			expect(ticks).toBe(1);
			expect(state.status).toBe("error");
			expect(state.error).toBe("The server rejected the username or password.");
			expect(state.creds).toBeNull();
			expect(JSON.stringify(state)).not.toContain("hunter2");
		});

		it("never keeps the password once finished", async () => {
			const t = makeDeps(() => makeSource({ INBOX: { msgs: seq(1) } }));
			const state = newState();
			await run(new ImportEngine(t.deps), state);
			expect(state.status).toBe("done");
			expect(JSON.stringify(state)).not.toContain("hunter2");
		});

		it("an unexpected error ends the run", async () => {
			const t = makeDeps(() => makeSource({ INBOX: { msgs: seq(1) } }));
			t.deps.ensureFolder = async () => {
				throw new Error("storage unavailable");
			};
			const state = newState({ INBOX: "new:Whatever" });
			await run(new ImportEngine(t.deps), state);
			expect(state.status).toBe("error");
			expect(state.error).toBe("storage unavailable");
			expect(state.creds).toBeNull();
		});
	});

	describe("cancel and expiry", () => {
		it("stops when the status changes between ticks", async () => {
			const t = makeDeps(() => makeSource({ INBOX: { msgs: seq(30) } }));
			const state = newState();
			const engine = new ImportEngine(t.deps);
			await engine.tick(state);
			state.status = "canceled";
			state.creds = null;
			expect(await engine.tick(state)).toBeNull();
			expect(state.counts.imported).toBe(MESSAGES_PER_TICK);
		});

		it("abandons a run that made no progress for a day", () => {
			const state = newState();
			const now = new Date(state.updatedAt!).getTime() + STALE_AFTER_MS + 1000;
			expect(expireIfStale(state, now)).toBe(true);
			expect(state.status).toBe("error");
			expect(state.creds).toBeNull();
			expect(expireIfStale(newState(), new Date(state.updatedAt!).getTime() + 1000)).toBe(false);
		});
	});

	describe("retry failed", () => {
		it("re-imports only the messages that failed", async () => {
			const folders = { INBOX: { msgs: seq(5) } };
			const failBody = new Set(["INBOX:2", "INBOX:4"]);
			const bodies: string[] = [];
			const t = makeDeps(() => makeSource(folders, { failBody, bodies }));
			const first = newState();
			await run(new ImportEngine(t.deps), first);
			expect(first.failures.map((f) => f.uid)).toEqual([2, 4]);

			failBody.clear(); // the server problem is fixed
			bodies.length = 0;
			const retry = newState();
			retry.mode = "retry";
			retry.cursors = first.cursors;
			retry.retryList = first.failures;
			retry.folderMap = first.folderMap;
			await run(new ImportEngine(t.deps), retry);

			expect(retry.status).toBe("done");
			expect(bodies).toEqual(["INBOX:2", "INBOX:4"]);
			expect(retry.counts).toEqual({ imported: 2, skipped: 0, failed: 0 });
			expect(retry.totals.messages).toBe(2);
			expect(t.stored).toHaveLength(5);
		});

		it("reports failures again when the folder was rebuilt or the message is gone", async () => {
			const folders: Record<string, FakeFolder> = { INBOX: { uidValidity: 9, msgs: seq(2) } };
			const t = makeDeps(() => makeSource(folders));
			const retry = newState();
			retry.mode = "retry";
			retry.retryList = [
				{ folder: "INBOX", path: "INBOX", uid: 1, uidValidity: 1, reason: "x" }, // old validity
				{ folder: "INBOX", path: "INBOX", uid: 77, uidValidity: 9, reason: "x" }, // gone
			];
			await run(new ImportEngine(t.deps), retry);
			expect(retry.failures.map((f) => f.uid)).toEqual([1, 77]);
			expect(retry.failures[0].reason).toMatch(/rebuilt/);
			expect(retry.failures[1].reason).toMatch(/no longer on the server/);
		});
	});
});
