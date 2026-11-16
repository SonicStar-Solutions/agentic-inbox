// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, makeFakeEnv } from "../test-utils";

const req = (env: any, path: string, init?: RequestInit) => app.request(path, init, env, fakeExecutionCtx().ctx);
const put = (body: unknown): RequestInit => ({
	method: "PUT",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body),
});

describe("domain settings", () => {
	it("reports the 30-day default when nothing is stored", async () => {
		const { env } = makeFakeEnv();
		const res = await req(env, "/api/v1/domains/example.com/settings");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ domain: "example.com", retentionDays: 30 });
	});

	it("saves and returns a domain default", async () => {
		const { env, objects } = makeFakeEnv();
		const res = await req(env, "/api/v1/domains/example.com/settings", put({ retentionDays: 90 }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ domain: "example.com", retentionDays: 90 });
		expect(JSON.parse(objects.get("domains/example.com.json") as string)).toEqual({ retentionDays: 90 });

		const again = await req(env, "/api/v1/domains/example.com/settings");
		expect(await again.json()).toEqual({ domain: "example.com", retentionDays: 90 });
	});

	it("rejects a domain that is not configured", async () => {
		const { env } = makeFakeEnv();
		expect((await req(env, "/api/v1/domains/nope.org/settings")).status).toBe(404);
		expect((await req(env, "/api/v1/domains/nope.org/settings", put({ retentionDays: 5 }))).status).toBe(404);
	});

	it("rejects an invalid retention", async () => {
		const { env } = makeFakeEnv();
		for (const bad of [-1, 1.5, "30", null, 99999]) {
			const res = await req(env, "/api/v1/domains/example.com/settings", put({ retentionDays: bad }));
			expect(res.status).toBe(400);
		}
	});
});

describe("mailbox retention setting", () => {
	it("accepts a number, 0 or null", async () => {
		for (const value of [7, 0, null]) {
			const { env } = makeFakeEnv();
			const res = await req(env, "/api/v1/mailboxes/alice@example.com", put({ settings: { fromName: "A", retentionDays: value } }));
			expect(res.status).toBe(200);
		}
	});

	it("rejects a negative or fractional value", async () => {
		for (const bad of [-5, 2.5, "7"]) {
			const { env } = makeFakeEnv();
			const res = await req(env, "/api/v1/mailboxes/alice@example.com", put({ settings: { retentionDays: bad } }));
			expect(res.status).toBe(400);
			expect(((await res.json()) as any).error).toMatch(/retentionDays/);
		}
	});
});
