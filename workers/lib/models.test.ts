// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { extractAiText, MODEL_DEFAULTS, resolveModel } from "./models";

describe("resolveModel (#41)", () => {
	it("returns defaults when nothing is overridden", () => {
		expect(resolveModel({}, "agent")).toBe(MODEL_DEFAULTS.agent);
		expect(resolveModel(undefined, "draftVerifier")).toBe(MODEL_DEFAULTS.draftVerifier);
	});

	it("uses a non-empty per-role override and ignores blanks", () => {
		const env = { AI_MODEL_INJECTION_SCANNER: " @cf/google/gemma-4-26b-a4b-it ", AI_MODEL_AGENT: "  " };
		expect(resolveModel(env, "injectionScanner")).toBe("@cf/google/gemma-4-26b-a4b-it");
		expect(resolveModel(env, "agent")).toBe(MODEL_DEFAULTS.agent);
		expect(resolveModel(env, "autoDraft")).toBe(MODEL_DEFAULTS.autoDraft);
	});

	it("no default is a model on the deprecation list (#30)", () => {
		const deprecated = ["llama-3.1-8b-instruct", "llama-3-8b-instruct", "llama-3.1-70b-instruct", "gemma-3-12b-it"];
		for (const model of Object.values(MODEL_DEFAULTS)) {
			for (const d of deprecated) expect(model).not.toContain(d);
		}
	});
});

describe("extractAiText", () => {
	it("reads the legacy and OpenAI-style shapes", () => {
		expect(extractAiText({ response: "NO" })).toBe("NO");
		expect(extractAiText({ choices: [{ message: { content: "YES" } }] })).toBe("YES");
		expect(extractAiText({ choices: [{ text: "NO" }] })).toBe("NO");
	});
	it("returns null for anything else", () => {
		expect(extractAiText(null)).toBeNull();
		expect(extractAiText({})).toBeNull();
		expect(extractAiText({ choices: [{ message: { content: null } }] })).toBeNull();
	});
});
