// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv } from "../test-utils";
import { isAllowedDomain, parseDomains } from "./domains";

describe("parseDomains / isAllowedDomain (#8)", () => {
	it("splits, trims, lowercases and de-duplicates", () => {
		expect(parseDomains(" Example.com, example.org ,example.com,,")).toEqual(["example.com", "example.org"]);
		expect(parseDomains(undefined)).toEqual([]);
	});
	it("matches the address domain exactly", () => {
		const d = ["example.com", "example.org"];
		expect(isAllowedDomain("a@example.org", d)).toBe(true);
		expect(isAllowedDomain("a@EXAMPLE.com", d)).toBe(true);
		expect(isAllowedDomain("a@evil-example.com", d)).toBe(false);
		expect(isAllowedDomain("a@sub.example.com", d)).toBe(false);
		expect(isAllowedDomain("nodomain", d)).toBe(false);
	});
	it("allows anything when no domains are configured", () => {
		expect(isAllowedDomain("a@anything.dev", [])).toBe(true);
	});
});

describe("mailbox creation honours DOMAINS (#8)", () => {
	const create = async (domains: string, email: string) => {
		const { env } = makeFakeEnv({ mailboxes: [] });
		env.DOMAINS = domains;
		env.BUCKET.head = async () => null;
		return app.request("/api/v1/mailboxes", jsonPost({ email, name: "n" }), env, fakeExecutionCtx().ctx);
	};

	it("accepts any configured domain", async () => {
		expect((await create("example.com,example.org", "a@example.org")).status).toBe(201);
	});
	it("rejects a domain that is not configured", async () => {
		const res = await create("example.com,example.org", "a@other.net");
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).error).toContain("example.com, example.org");
	});
	it("config lists every domain", async () => {
		const { env } = makeFakeEnv();
		env.DOMAINS = "a.com, b.com";
		const res = await app.request("/api/v1/config", {}, env, fakeExecutionCtx().ctx);
		expect(((await res.json()) as any).domains).toEqual(["a.com", "b.com"]);
	});
});
