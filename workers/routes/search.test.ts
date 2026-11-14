// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";

function searchEnv() {
	const stub: any = makeFakeMailboxStub();
	stub.searchEmails = async () => [];
	stub.countSearchResults = async () => 0;
	return makeFakeEnv({ stubs: { "alice@example.com": stub } });
}

describe("GET /search input limits (#36)", () => {
	it("accepts a 60-character subject (chunked in the DO, not rejected)", async () => {
		const { env } = searchEnv();
		const { ctx } = fakeExecutionCtx();
		const subject = encodeURIComponent("cf-agentic-inbox-external-inbound-alchang-20260513T233604Z");
		const res = await app.request(`/api/v1/mailboxes/alice@example.com/search?subject=${subject}`, {}, env, ctx);
		expect(res.status).toBe(200);
	});

	it("answers 400, not 500, for an absurdly long term", async () => {
		const { env } = searchEnv();
		const { ctx } = fakeExecutionCtx();
		const res = await app.request(`/api/v1/mailboxes/alice@example.com/search?query=${"a".repeat(600)}`, {}, env, ctx);
		expect(res.status).toBe(400);
		expect(((await res.json()) as any).error).toContain("query");
	});
});
