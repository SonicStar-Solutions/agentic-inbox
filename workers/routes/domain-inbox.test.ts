// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, makeFakeEnv } from "../test-utils";

type Row = { id: string; date: string; subject?: string; folder_id?: string; read?: boolean };

/**
 * A mailbox stub that answers the Durable Object's list queries from fixed rows with the same
 * keyset behaviour the real SQL has: newest first, strictly before the cursor, capped by limit.
 */
function listStub(rows: Row[], folders: { id: string; name: string; unreadCount: number }[] = []) {
	const calls: { method: string; args: any }[] = [];
	const select = (opts: any) => {
		const before = opts?.before as { date: string; id: string } | undefined;
		return [...rows]
			.sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1))
			.filter((r) => !before || r.date < before.date || (r.date === before.date && r.id < before.id))
			.slice(0, opts?.limit ?? 25);
	};
	return {
		calls,
		async getEmails(opts: any) { calls.push({ method: "getEmails", args: opts }); return select(opts); },
		async getThreadedEmails(opts: any) { calls.push({ method: "getThreadedEmails", args: opts }); return select(opts); },
		async searchEmails(opts: any) { calls.push({ method: "searchEmails", args: opts }); return select(opts); },
		async countEmails() { return rows.length; },
		async countThreadedEmails() { return rows.length; },
		async countSearchResults() { return rows.length; },
		async withLabels(list: any[]) { return list.map((r) => ({ ...r, labels: [{ id: "l1", name: "Work" }] })); },
		async getFolders() { return folders; },
		async createEmail() {},
		async notifyChanged() {},
	} as any;
}

const get = (env: any, path: string) => app.request(path, {}, env, fakeExecutionCtx().ctx);

function setup() {
	const alice = listStub([
		{ id: "a1", date: "2026-07-10T10:00:00Z", subject: "A1" },
		{ id: "a2", date: "2026-07-04T10:00:00Z", subject: "A2" },
		{ id: "a3", date: "2026-07-01T10:00:00Z", subject: "A3" },
	], [
		{ id: "inbox", name: "Inbox", unreadCount: 2 },
		{ id: "sent", name: "Sent", unreadCount: 0 },
		{ id: "custom-1", name: "Work", unreadCount: 9 },
	]);
	const bob = listStub([
		{ id: "b1", date: "2026-07-09T10:00:00Z", subject: "B1" },
		{ id: "b2", date: "2026-07-02T10:00:00Z", subject: "B2" },
	], [{ id: "inbox", name: "Inbox", unreadCount: 3 }]);
	const other = listStub([{ id: "o1", date: "2026-07-11T10:00:00Z", subject: "Other domain" }]);
	const { env } = makeFakeEnv({
		mailboxes: ["alice@example.com", "bob@example.com", "carol@other.org"],
		stubs: { "alice@example.com": alice, "bob@example.com": bob, "carol@other.org": other },
	});
	env.DOMAINS = "example.com,other.org";
	return { env, alice, bob, other };
}

describe("GET /domains/:domain/emails", () => {
	it("merges every mailbox on the domain newest first and says which mailbox each row is in", async () => {
		const { env } = setup();
		const res = await get(env, "/api/v1/domains/example.com/emails?folder=inbox");
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.emails.map((e: any) => [e.id, e.mailboxId])).toEqual([
			["a1", "alice@example.com"],
			["b1", "bob@example.com"],
			["a2", "alice@example.com"],
			["b2", "bob@example.com"],
			["a3", "alice@example.com"],
		]);
	});

	it("leaves out mailboxes on other domains", async () => {
		const { env, other } = setup();
		const body = (await (await get(env, "/api/v1/domains/example.com/emails?folder=inbox")).json()) as any;
		expect(body.emails.some((e: any) => e.id === "o1")).toBe(false);
		expect(other.calls).toEqual([]);
	});

	it("pages with a cursor, without gaps or repeats, and ends with a null cursor", async () => {
		const { env } = setup();
		const seen: string[] = [];
		let cursor: string | null | undefined;
		let pages = 0;
		do {
			const qs = `folder=inbox&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
			const body = (await (await get(env, `/api/v1/domains/example.com/emails?${qs}`)).json()) as any;
			expect(body.emails.length).toBeLessThanOrEqual(2);
			seen.push(...body.emails.map((e: any) => e.id));
			cursor = body.nextCursor;
			pages++;
		} while (cursor && pages < 10);
		expect(seen).toEqual(["a1", "b1", "a2", "b2", "a3"]);
		expect(cursor).toBeNull();
	});

	it("asks each mailbox only for rows older than the cursor", async () => {
		const { env, alice } = setup();
		const first = (await (await get(env, "/api/v1/domains/example.com/emails?folder=inbox&limit=2")).json()) as any;
		await get(env, `/api/v1/domains/example.com/emails?folder=inbox&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
		const second = alice.calls.at(-1).args;
		expect(second.before).toEqual({ date: "2026-07-09T10:00:00Z", id: "b1" });
		expect(second.limit).toBe(2);
	});

	it("reports a total across mailboxes and gives no cursor on a single full page", async () => {
		const { env } = setup();
		const body = (await (await get(env, "/api/v1/domains/example.com/emails?folder=inbox&limit=50")).json()) as any;
		expect(body.totalCount).toBe(5);
		expect(body.nextCursor).toBeNull();
	});

	it("uses the conversation queries when threaded", async () => {
		const { env, alice } = setup();
		await get(env, "/api/v1/domains/example.com/emails?folder=inbox&threaded=true");
		expect(alice.calls.map((c: any) => c.method)).toEqual(["getThreadedEmails"]);
	});

	it("attaches labels from each mailbox", async () => {
		const { env } = setup();
		const body = (await (await get(env, "/api/v1/domains/example.com/emails?folder=inbox&limit=2")).json()) as any;
		expect(body.emails.every((e: any) => e.labels?.[0]?.name === "Work")).toBe(true);
	});

	it("defaults to the inbox and caps the page size at 100", async () => {
		const { env, alice } = setup();
		await get(env, "/api/v1/domains/example.com/emails?limit=5000");
		expect(alice.calls[0].args.folder).toBe("inbox");
		expect(alice.calls[0].args.limit).toBe(100);
	});

	it("404s for a domain this deployment does not serve", async () => {
		const { env } = setup();
		expect((await get(env, "/api/v1/domains/nope.dev/emails")).status).toBe(404);
	});

	it("400s on a cursor it did not issue", async () => {
		const { env } = setup();
		expect((await get(env, "/api/v1/domains/example.com/emails?cursor=garbage!!")).status).toBe(400);
	});

	it("returns an empty list for a served domain with no mailboxes yet", async () => {
		const { env } = makeFakeEnv({ mailboxes: [] });
		const body = (await (await get(env, "/api/v1/domains/example.com/emails")).json()) as any;
		expect(body).toEqual({ emails: [], totalCount: 0, nextCursor: null });
	});
});

describe("GET /domains/:domain/search", () => {
	it("merges matches from every mailbox on the domain and passes the filters down", async () => {
		const { env, alice, bob } = setup();
		const res = await get(env, "/api/v1/domains/example.com/search?query=invoice&from=acme&is_read=false&limit=3");
		const body = (await res.json()) as any;
		expect(body.emails.map((e: any) => e.id)).toEqual(["a1", "b1", "a2"]);
		expect(body.emails[1].mailboxId).toBe("bob@example.com");
		expect(body.totalCount).toBe(5);
		expect(body.nextCursor).toBeTruthy();
		const sent = alice.calls[0].args;
		expect(sent).toMatchObject({ query: "invoice", from: "acme", is_read: false, limit: 3 });
		expect(bob.calls[0].method).toBe("searchEmails");
	});

	it("pages with the same cursor scheme", async () => {
		const { env } = setup();
		const first = (await (await get(env, "/api/v1/domains/example.com/search?query=x&limit=3")).json()) as any;
		const second = (await (await get(env, `/api/v1/domains/example.com/search?query=x&limit=3&cursor=${encodeURIComponent(first.nextCursor)}`)).json()) as any;
		expect([...first.emails, ...second.emails].map((e: any) => e.id)).toEqual(["a1", "b1", "a2", "b2", "a3"]);
		expect(second.nextCursor).toBeNull();
	});

	it("groups by conversation when asked", async () => {
		const { env, alice } = setup();
		await get(env, "/api/v1/domains/example.com/search?query=x&group=thread");
		expect(alice.calls[0].args.group_by_thread).toBe(true);
	});

	it("rejects an overlong search term", async () => {
		const { env } = setup();
		const res = await get(env, `/api/v1/domains/example.com/search?query=${"a".repeat(501)}`);
		expect(res.status).toBe(400);
	});

	it("404s for an unserved domain", async () => {
		const { env } = setup();
		expect((await get(env, "/api/v1/domains/nope.dev/search?query=x")).status).toBe(404);
	});
});

describe("GET /domains/:domain/folders", () => {
	it("sums unread counts per system folder and leaves custom folders out", async () => {
		const { env } = setup();
		const body = (await (await get(env, "/api/v1/domains/example.com/folders")).json()) as any;
		expect(body).toEqual([
			{ id: "inbox", name: "Inbox", unreadCount: 5 },
			{ id: "sent", name: "Sent", unreadCount: 0 },
		]);
	});

	it("404s for an unserved domain", async () => {
		const { env } = setup();
		expect((await get(env, "/api/v1/domains/nope.dev/folders")).status).toBe(404);
	});
});
