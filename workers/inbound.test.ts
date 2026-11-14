// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { getAgentByName } from "agents";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { receiveEmail } from "./index";
import { fakeExecutionCtx, makeFakeEnv, rawEmailEvent, rfc822 } from "./test-utils";

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.mocked(getAgentByName).mockClear();
});
afterEach(() => vi.restoreAllMocks());

const basic = rfc822({
	From: "Dave <dave@example.net>",
	To: "alice@example.com",
	Subject: "Hello",
	"Message-ID": "<m1@example.net>",
});

describe("auto-draft trigger (#57)", () => {
	it("resolves the agent via getAgentByName so unopened mailboxes get named", async () => {
		const { env, agentCalls } = makeFakeEnv();
		const { ctx, flush } = fakeExecutionCtx();
		await receiveEmail(rawEmailEvent(basic, "alice@example.com") as any, env, ctx);
		await flush();

		expect(getAgentByName).toHaveBeenCalledWith(env.EMAIL_AGENT, "alice@example.com");
		expect(agentCalls).toHaveLength(1);
		expect(agentCalls[0].url).toBe("https://agents/onNewEmail");
		expect(agentCalls[0].body).toMatchObject({ mailboxId: "alice@example.com", subject: "Hello" });
	});

	it("logs a failed trigger without failing the inbound delivery", async () => {
		const { env, stubs } = makeFakeEnv();
		vi.mocked(getAgentByName).mockRejectedValueOnce(new Error("boom"));
		const { ctx, flush } = fakeExecutionCtx();
		await receiveEmail(rawEmailEvent(basic, "alice@example.com") as any, env, ctx);
		await flush();

		expect(stubs["alice@example.com"].rows).toHaveLength(1);
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Auto-draft trigger failed"), "boom");
	});
});
