// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { domainOf, groupByDomain, mailboxDisplayName } from "./mailbox-groups";

describe("groupByDomain", () => {
	const boxes = [
		{ email: "hello@b.example" },
		{ email: "billing@A.example" },
		{ email: "ops@a.example" },
		{ email: "hi@c.example" },
	];

	it("groups by lower-cased domain, keeping item order", () => {
		const groups = groupByDomain(boxes);
		expect(groups.map((g) => g.domain)).toEqual(["a.example", "b.example", "c.example"]);
		expect(groups[0].items.map((i) => i.email)).toEqual(["billing@A.example", "ops@a.example"]);
	});

	it("puts configured domains first, in the configured order", () => {
		const groups = groupByDomain(boxes, ["c.example", "B.example"]);
		expect(groups.map((g) => g.domain)).toEqual(["c.example", "b.example", "a.example"]);
	});

	it("returns nothing for no mailboxes", () => {
		expect(groupByDomain([])).toEqual([]);
	});
});

describe("domainOf", () => {
	it("reads the part after the last @", () => {
		expect(domainOf("A@Example.com")).toBe("example.com");
		expect(domainOf("nope")).toBe("");
	});
});

describe("mailboxDisplayName", () => {
	it("prefers the From name, then a distinct name, then the local part", () => {
		expect(mailboxDisplayName({ email: "a@x.com", name: "a@x.com", fromName: "Ada" })).toBe("Ada");
		expect(mailboxDisplayName({ email: "a@x.com", name: "Studio", settings: {} })).toBe("Studio");
		expect(mailboxDisplayName({ email: "a@x.com", name: "A@X.com" })).toBe("a");
	});
});
