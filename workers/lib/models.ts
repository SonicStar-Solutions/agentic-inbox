// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Central Workers AI model selection (#41, #30).
 *
 * Every model the Worker uses is defined here, with an optional per-model
 * override through a Worker var / secret, so a deprecated model can be swapped
 * with a config change instead of a code change.
 *
 * Catalog: https://developers.cloudflare.com/workers-ai/models/
 */

export const MODEL_DEFAULTS = {
	/** Interactive agent chat (agent panel). */
	agent: "@cf/moonshotai/kimi-k2.5",
	/** Automatic draft generation for newly received email. */
	autoDraft: "@cf/moonshotai/kimi-k2.5",
	/** Prompt-injection scanner for inbound mail (fails closed on error). */
	injectionScanner: "@cf/zai-org/glm-4.7-flash",
	/** Draft verifier that strips agent artifacts from drafts. */
	draftVerifier: "@cf/meta/llama-4-scout-17b-16e-instruct",
} as const;

export type ModelRole = keyof typeof MODEL_DEFAULTS;

/** Worker var that overrides each role. */
export const MODEL_ENV_VARS: Record<ModelRole, string> = {
	agent: "AI_MODEL_AGENT",
	autoDraft: "AI_MODEL_AUTO_DRAFT",
	injectionScanner: "AI_MODEL_INJECTION_SCANNER",
	draftVerifier: "AI_MODEL_DRAFT_VERIFIER",
};

/** Resolve the model for a role: a non-empty env override, else the default. */
export function resolveModel(env: object | undefined, role: ModelRole): string {
	const override = (env as Record<string, unknown> | undefined)?.[MODEL_ENV_VARS[role]];
	if (typeof override === "string" && override.trim()) return override.trim();
	return MODEL_DEFAULTS[role];
}

/**
 * Pull the generated text out of a Workers AI response. Older models answer
 * `{ response }`; newer chat models answer OpenAI-style
 * `{ choices: [{ message: { content } }] }`. Returns null if neither is present.
 */
export function extractAiText(result: unknown): string | null {
	if (!result || typeof result !== "object") return null;
	const r = result as {
		response?: unknown;
		choices?: { message?: { content?: unknown }; text?: unknown }[];
	};
	if (typeof r.response === "string") return r.response;
	const choice = r.choices?.[0];
	if (typeof choice?.message?.content === "string") return choice.message.content;
	if (typeof choice?.text === "string") return choice.text;
	return null;
}
