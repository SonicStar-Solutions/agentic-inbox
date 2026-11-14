// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { analyzeAutoDraftSteps, autoDraftChatSummary, shouldSaveInlineDraft } from "./auto-draft";

const step = (...calls: { toolName: string; input?: unknown }[]) => ({ toolCalls: calls });

describe("auto-draft outcome (#73)", () => {
	it("detects a draft tool call", () => {
		const o = analyzeAutoDraftSteps([step({ toolName: "get_thread" }), step({ toolName: "draft_reply" })]);
		expect(o).toEqual({ draftToolCalled: true, skipped: false, skipReason: null });
		expect(shouldSaveInlineDraft(o, "some text")).toBe(false);
	});

	it("detects skip_email with a reason and does not save the explanation as a draft", () => {
		const o = analyzeAutoDraftSteps([step({ toolName: "skip_email", input: { reason: "sales pitch" } })]);
		expect(o).toEqual({ draftToolCalled: false, skipped: true, skipReason: "sales pitch" });
		expect(shouldSaveInlineDraft(o, "Left alone — it's a sales pitch")).toBe(false);
		expect(autoDraftChatSummary(o, "spam@example.net", "ignored")).toBe("Skipped: sales pitch");
	});

	it("falls back to a default reason when none is given", () => {
		const o = analyzeAutoDraftSteps([step({ toolName: "skip_email", input: {} })]);
		expect(autoDraftChatSummary(o, "x@example.net", "")).toBe("Skipped: no reply needed");
	});

	it("keeps the inline-text fallback when the model wrote the draft as text", () => {
		const o = analyzeAutoDraftSteps([step()]);
		expect(shouldSaveInlineDraft(o, "Hi Dave, thanks!")).toBe(true);
		expect(shouldSaveInlineDraft(o, "   ")).toBe(false);
		expect(autoDraftChatSummary(o, "d@example.net", "Hi Dave, thanks!")).toBe("Hi Dave, thanks!");
	});

	it("a real draft wins over a skip call", () => {
		const o = analyzeAutoDraftSteps([step({ toolName: "skip_email", input: { reason: "x" } }, { toolName: "draft_reply" })]);
		expect(o.skipped).toBe(false);
		expect(o.draftToolCalled).toBe(true);
	});
});
