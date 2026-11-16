// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";
import { buildContacts, extractAddresses } from "./contacts";

describe("buildContacts (#88)", () => {
	const rows = [
		{ sender: "dave@example.net", recipient: "alice@example.com", date: "2026-11-01" },
		{ sender: "dave@example.net", recipient: "alice@example.com", cc: "Carol <carol@example.org>", date: "2026-11-03" },
		{ sender: "alice@example.com", recipient: "erin@example.org, dave@example.net", date: "2026-11-02" },
		{ sender: "bob@example.net", recipient: "alice@example.com", date: "2026-11-04" },
	];

	it("extracts addresses from plain and name <addr> fields", () => {
		expect(extractAddresses("A <a@b.co>, c@d.io;e@f.org")).toEqual(["a@b.co", "c@d.io", "e@f.org"]);
		expect(extractAddresses(null)).toEqual([]);
	});

	it("ranks by frequency then recency and excludes the mailbox itself", () => {
		const out = buildContacts(rows, { self: "alice@example.com" });
		expect(out.map((c) => c.address)).toEqual(["dave@example.net", "bob@example.net", "carol@example.org", "erin@example.org"]);
		expect(out[0]).toMatchObject({ count: 3, last: "2026-11-03" });
	});

	it("filters by substring with prefix matches first", () => {
		const out = buildContacts(rows, { self: "alice@example.com", query: "ex" });
		expect(out.length).toBe(4);
		expect(buildContacts(rows, { self: "alice@example.com", query: "bo" }).map((c) => c.address)).toEqual(["bob@example.net"]);
		expect(buildContacts(rows, { query: "zzz" })).toEqual([]);
	});

	it("honours the limit", () => {
		expect(buildContacts(rows, { limit: 2 })).toHaveLength(2);
	});
});

describe("GET /contacts", () => {
	it("returns suggestions from the mailbox", async () => {
		const stub: any = makeFakeMailboxStub();
		stub.searchContacts = async (q: string) => [{ address: `${q}@example.net`, count: 1, last: "" }];
		const { env } = makeFakeEnv({ stubs: { "alice@example.com": stub } });
		const res = await app.request("/api/v1/mailboxes/alice@example.com/contacts?q=da&limit=5", {}, env, fakeExecutionCtx().ctx);
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).contacts[0].address).toBe("da@example.net");
	});
});
