// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import {
	decodeCursor,
	encodeCursor,
	mailboxesInDomain,
	mergeNewestFirst,
	sumFolderUnread,
} from "./domain-inbox";

const row = (id: string, date: string) => ({ id, date });

describe("mergeNewestFirst", () => {
	it("interleaves several newest-first lists by date", () => {
		const a = [row("a1", "2026-07-10"), row("a2", "2026-07-04"), row("a3", "2026-07-01")];
		const b = [row("b1", "2026-07-09"), row("b2", "2026-07-02")];
		const c = [row("c1", "2026-07-11")];
		expect(mergeNewestFirst([a, b, c], 10).map((r) => r.id)).toEqual(["c1", "a1", "b1", "a2", "b2", "a3"]);
	});

	it("stops at the limit", () => {
		const a = [row("a1", "2026-07-10"), row("a2", "2026-07-04")];
		const b = [row("b1", "2026-07-09"), row("b2", "2026-07-02")];
		expect(mergeNewestFirst([a, b], 3).map((r) => r.id)).toEqual(["a1", "b1", "a2"]);
	});

	it("orders equal dates by id, descending, so paging is deterministic", () => {
		const a = [row("a", "2026-07-10")];
		const b = [row("b", "2026-07-10")];
		expect(mergeNewestFirst([a, b], 10).map((r) => r.id)).toEqual(["b", "a"]);
		expect(mergeNewestFirst([b, a], 10).map((r) => r.id)).toEqual(["b", "a"]);
	});

	it("handles empty and missing lists", () => {
		expect(mergeNewestFirst([], 5)).toEqual([]);
		expect(mergeNewestFirst([[], []], 5)).toEqual([]);
		expect(mergeNewestFirst([[row("a", "2026-07-10")], []], 5)).toHaveLength(1);
	});
});

describe("cursor", () => {
	it("round-trips a date and id", () => {
		const encoded = encodeCursor({ date: "2026-07-10T12:00:00.000Z", id: "<abc@example.com>" });
		expect(decodeCursor(encoded)).toEqual({ ok: true, cursor: { date: "2026-07-10T12:00:00.000Z", id: "<abc@example.com>" } });
	});

	it("treats an absent cursor as the first page", () => {
		expect(decodeCursor(undefined)).toEqual({ ok: true, cursor: undefined });
		expect(decodeCursor("")).toEqual({ ok: true, cursor: undefined });
	});

	it("rejects anything that is not a cursor this module produced", () => {
		expect(decodeCursor("not-base64-json!!")).toEqual({ ok: false });
		expect(decodeCursor(btoa(JSON.stringify({ date: 5 })))).toEqual({ ok: false });
		expect(decodeCursor(btoa("[]"))).toEqual({ ok: false });
	});

	it("survives non-ASCII ids", () => {
		const cursor = { date: "2026-07-10", id: "é-ü-日本" };
		expect(decodeCursor(encodeCursor(cursor))).toEqual({ ok: true, cursor });
	});
});

describe("mailboxesInDomain", () => {
	const all = [
		{ id: "a@example.com", email: "a@example.com" },
		{ id: "b@Example.com", email: "b@Example.com" },
		{ id: "c@other.org", email: "c@other.org" },
	];

	it("keeps only mailboxes on the domain, ignoring case", () => {
		expect(mailboxesInDomain(all, "example.com").map((m) => m.id)).toEqual(["a@example.com", "b@Example.com"]);
		expect(mailboxesInDomain(all, "EXAMPLE.COM")).toHaveLength(2);
	});

	it("returns nothing for a domain with no mailboxes", () => {
		expect(mailboxesInDomain(all, "nope.dev")).toEqual([]);
	});
});

describe("sumFolderUnread", () => {
	it("adds unread counts per system folder across mailboxes, in sidebar order", () => {
		const total = sumFolderUnread([
			[{ id: "inbox", name: "Inbox", unreadCount: 2 }, { id: "sent", name: "Sent", unreadCount: 0 }, { id: "custom-1", name: "Work", unreadCount: 9 }],
			[{ id: "inbox", name: "Inbox", unreadCount: 3 }, { id: "draft", name: "Drafts", unreadCount: 1 }],
		]);
		expect(total).toEqual([
			{ id: "inbox", name: "Inbox", unreadCount: 5 },
			{ id: "sent", name: "Sent", unreadCount: 0 },
			{ id: "draft", name: "Drafts", unreadCount: 1 },
		]);
	});

	it("leaves custom folders out, since they are per mailbox", () => {
		const total = sumFolderUnread([[{ id: "custom-1", name: "Work", unreadCount: 4 }]]);
		expect(total).toEqual([]);
	});
});
