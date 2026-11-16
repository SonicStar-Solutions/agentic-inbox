// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPromptInjection } from "./ai";
import { MODEL_DEFAULTS } from "./models";

const fakeAi = (impl: (model: string, input: any) => unknown) =>
	({ run: vi.fn(async (model: string, input: any) => impl(model, input)) }) as unknown as Ai & { run: ReturnType<typeof vi.fn> };

const body = "Hello, could you send me the latest invoice please? Thanks a lot.";

beforeEach(() => {
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("isPromptInjection (#30, #41)", () => {
	it("uses the default scanner model, not a deprecated one", async () => {
		const ai = fakeAi(() => ({ response: "NO" }));
		await isPromptInjection(ai, body);
		expect(ai.run.mock.calls[0][0]).toBe(MODEL_DEFAULTS.injectionScanner);
		expect(String(ai.run.mock.calls[0][0])).not.toContain("llama-3.1-8b-instruct");
	});

	it("uses an explicit model override", async () => {
		const ai = fakeAi(() => ({ response: "NO" }));
		await isPromptInjection(ai, body, "@cf/example/custom");
		expect(ai.run.mock.calls[0][0]).toBe("@cf/example/custom");
	});

	it("understands both response shapes", async () => {
		expect(await isPromptInjection(fakeAi(() => ({ response: "YES" })), body)).toBe(true);
		expect(await isPromptInjection(fakeAi(() => ({ choices: [{ message: { content: "YES" } }] })), body)).toBe(true);
		expect(await isPromptInjection(fakeAi(() => ({ choices: [{ message: { content: "NO" } }] })), body)).toBe(false);
	});

	it("fails closed when the verdict is missing or the call throws", async () => {
		expect(await isPromptInjection(fakeAi(() => ({})), body)).toBe(true);
		expect(await isPromptInjection(fakeAi(() => ({ response: "  " })), body)).toBe(true);
		expect(await isPromptInjection(fakeAi(() => { throw new Error("model not found"); }), body)).toBe(true);
	});

	it("skips tiny bodies without calling the model", async () => {
		const ai = fakeAi(() => ({ response: "YES" }));
		expect(await isPromptInjection(ai, "hi")).toBe(false);
		expect(ai.run).not.toHaveBeenCalled();
	});
});
