// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { receiveEmail } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv, rawEmailEvent, rfc822 } from "../test-utils";
import { isAutoDraftEnabled, isValidModelId, modelForMailbox, validateAgentSettings } from "./mailbox-settings";
import { MODEL_DEFAULTS } from "./models";

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("per-mailbox AI settings (#11)", () => {
	it("auto-draft defaults to on and only turns off explicitly", () => {
		expect(isAutoDraftEnabled(undefined)).toBe(true);
		expect(isAutoDraftEnabled({})).toBe(true);
		expect(isAutoDraftEnabled({ autoDraft: { enabled: true } })).toBe(true);
		expect(isAutoDraftEnabled({ autoDraft: { enabled: false } })).toBe(false);
	});

	it("validates model IDs", () => {
		expect(isValidModelId("@cf/moonshotai/kimi-k2.5")).toBe(true);
		expect(isValidModelId("@cf/zai-org/glm-4.7-flash")).toBe(true);
		for (const bad of ["", "kimi", "@cf/only-two", "https://evil.example/x", "@cf/a/b c", 5, null]) {
			expect(isValidModelId(bad)).toBe(false);
		}
	});

	it("a mailbox model overrides agent and auto-draft only", () => {
		const s = { agentModel: " @cf/zai-org/glm-4.7-flash " };
		expect(modelForMailbox({}, s, "agent")).toBe("@cf/zai-org/glm-4.7-flash");
		expect(modelForMailbox({}, s, "autoDraft")).toBe("@cf/zai-org/glm-4.7-flash");
		expect(modelForMailbox({}, s, "injectionScanner")).toBe(MODEL_DEFAULTS.injectionScanner);
		expect(modelForMailbox({}, { agentModel: "nonsense" }, "agent")).toBe(MODEL_DEFAULTS.agent);
		expect(modelForMailbox({ AI_MODEL_AGENT: "@cf/x/y" }, {}, "agent")).toBe("@cf/x/y");
	});

	it("validateAgentSettings rejects bad values", () => {
		expect(validateAgentSettings({})).toBeNull();
		expect(validateAgentSettings({ agentModel: "", autoDraft: { enabled: false } })).toBeNull();
		expect(validateAgentSettings({ agentModel: "nope" })).toContain("agentModel");
		expect(validateAgentSettings({ autoDraft: { enabled: "yes" } })).toContain("autoDraft");
	});

	it("PUT /mailboxes/:id rejects an invalid agentModel with 400", async () => {
		const { env } = makeFakeEnv();
		const res = await app.request(
			"/api/v1/mailboxes/alice@example.com",
			{ ...jsonPost({ settings: { agentModel: "nope" } }), method: "PUT" },
			env,
			fakeExecutionCtx().ctx,
		);
		expect(res.status).toBe(400);
	});

	const mail = rfc822({ From: "dave@example.net", To: "alice@example.com", Subject: "Hi" });

	it("inbound mail does not trigger the agent when auto-draft is off", async () => {
		const { env, agentCalls, objects } = makeFakeEnv();
		objects.set("mailboxes/alice@example.com.json", { autoDraft: { enabled: false } });
		const { ctx, flush } = fakeExecutionCtx();
		await receiveEmail(rawEmailEvent(mail, "alice@example.com") as any, env, ctx);
		await flush();
		expect(agentCalls).toHaveLength(0);
	});

	it("inbound mail still triggers the agent by default", async () => {
		const { env, agentCalls } = makeFakeEnv();
		const { ctx, flush } = fakeExecutionCtx();
		await receiveEmail(rawEmailEvent(mail, "alice@example.com") as any, env, ctx);
		await flush();
		expect(agentCalls).toHaveLength(1);
	});
});
