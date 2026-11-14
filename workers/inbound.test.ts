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

describe("route by SMTP envelope recipient (#32)", () => {
	const twoMailboxes = () =>
		makeFakeEnv({
			mailboxes: ["alice@example.com", "bob@example.com"],
			emailAddresses: ["alice@example.com", "bob@example.com"],
		});

	it("delivers mailing-list mail whose To: names the list", async () => {
		const { env, stubs } = makeFakeEnv();
		const { ctx } = fakeExecutionCtx();
		const raw = rfc822({ From: "poster@lists.example.org", To: "oss-security@lists.example.org", Subject: "[list] post", "Message-ID": "<l1@lists.example.org>" });
		await receiveEmail(rawEmailEvent(raw, "alice@example.com") as any, env, ctx);

		const rows = stubs["alice@example.com"].rows;
		expect(rows).toHaveLength(1);
		expect(rows[0].email.recipient).toBe("oss-security@lists.example.org");
	});

	it("delivers Cc-only mail", async () => {
		const { env, stubs } = twoMailboxes();
		const { ctx } = fakeExecutionCtx();
		const raw = rfc822({ From: "dave@example.net", To: "carol@example.org", Cc: "bob@example.com", Subject: "fyi" });
		await receiveEmail(rawEmailEvent(raw, "bob@example.com") as any, env, ctx);

		expect(stubs["bob@example.com"].rows).toHaveLength(1);
	});

	it("delivers to the envelope mailbox even if To: names another configured mailbox", async () => {
		const { env, stubs } = twoMailboxes();
		const { ctx } = fakeExecutionCtx();
		const raw = rfc822({ From: "dave@example.net", To: "bob@example.com", Subject: "misaddressed" });
		await receiveEmail(rawEmailEvent(raw, "alice@example.com") as any, env, ctx);

		expect(stubs["alice@example.com"]?.rows ?? []).toHaveLength(1);
		expect(stubs["bob@example.com"]?.rows ?? []).toHaveLength(0);
	});

	it("stores one copy per delivery when To: lists several configured mailboxes", async () => {
		const { env, stubs } = twoMailboxes();
		const raw = rfc822({ From: "dave@example.net", To: "alice@example.com, bob@example.com", Subject: "both" });
		for (const to of ["alice@example.com", "bob@example.com"]) {
			const { ctx } = fakeExecutionCtx();
			await receiveEmail(rawEmailEvent(raw, to) as any, env, ctx);
		}
		expect(stubs["alice@example.com"].rows).toHaveLength(1);
		expect(stubs["bob@example.com"].rows).toHaveLength(1);
	});

	it("is case-insensitive on the envelope recipient", async () => {
		const { env, stubs } = makeFakeEnv();
		const { ctx } = fakeExecutionCtx();
		await receiveEmail(rawEmailEvent(basic, "Alice@Example.COM") as any, env, ctx);
		expect(stubs["alice@example.com"].rows).toHaveLength(1);
	});

	it("ignores envelope recipients outside EMAIL_ADDRESSES", async () => {
		const { env, stubs } = makeFakeEnv({ emailAddresses: ["alice@example.com"], mailboxes: ["alice@example.com", "eve@example.com"] });
		const { ctx } = fakeExecutionCtx();
		await receiveEmail(rawEmailEvent(basic, "eve@example.com") as any, env, ctx);
		expect(stubs["eve@example.com"]).toBeUndefined();
	});

	it("ignores mail for a mailbox that does not exist", async () => {
		const { env, stubs } = makeFakeEnv();
		const { ctx } = fakeExecutionCtx();
		await receiveEmail(rawEmailEvent(basic, "nobody@example.com") as any, env, ctx);
		expect(stubs["nobody@example.com"]).toBeUndefined();
	});

	it("falls back to the To: header when no envelope recipient is available", async () => {
		const { env, stubs } = makeFakeEnv();
		const { ctx } = fakeExecutionCtx();
		await receiveEmail(rawEmailEvent(basic, undefined) as any, env, ctx);
		expect(stubs["alice@example.com"].rows).toHaveLength(1);
	});
});
