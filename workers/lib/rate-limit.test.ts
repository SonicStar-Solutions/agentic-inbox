// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";
import { logRateLimitHit } from "./rate-limit";

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("rate-limit logging (#18)", () => {
	it("logs a structured line with limit, mailbox and source", () => {
		logRateLimitHit("compose", "alice@example.com", "Rate limit exceeded: max 20 emails per hour per mailbox");
		expect(console.warn).toHaveBeenCalledWith("rate_limit_hit", expect.objectContaining({
			source: "compose", mailboxId: "alice@example.com", limit: "20/hour",
		}));
	});

	it("compose logs and still returns 429 unchanged", async () => {
		const stub = makeFakeMailboxStub();
		stub.rateLimit = "Rate limit exceeded: max 100 emails per day per mailbox";
		const { env } = makeFakeEnv({ stubs: { "alice@example.com": stub } });
		const res = await app.request(
			"/api/v1/mailboxes/alice@example.com/emails",
			jsonPost({ to: "d@example.net", from: "alice@example.com", subject: "s", text: "t" }),
			env,
			fakeExecutionCtx().ctx,
		);
		expect(res.status).toBe(429);
		expect(((await res.json()) as any).error).toContain("100 emails per day");
		expect(console.warn).toHaveBeenCalledWith("rate_limit_hit", expect.objectContaining({ limit: "100/day", source: "compose" }));
	});
});
