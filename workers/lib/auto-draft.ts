// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Helpers for interpreting what the agent did when auto-drafting a reply to a
 * newly arrived email.
 */

export const DRAFT_TOOL_NAMES = ["draft_reply", "draft_email"] as const;
export const SKIP_TOOL_NAME = "skip_email";

interface StepLike {
	toolCalls?: { toolName: string; input?: unknown; args?: unknown }[];
}

export interface AutoDraftOutcome {
	/** The agent saved a draft through draft_reply / draft_email. */
	draftToolCalled: boolean;
	/** The agent explicitly declined to reply (skip_email), with its reason. */
	skipped: boolean;
	skipReason: string | null;
}

export function analyzeAutoDraftSteps(steps: StepLike[]): AutoDraftOutcome {
	let draftToolCalled = false;
	let skipped = false;
	let skipReason: string | null = null;

	for (const step of steps) {
		for (const call of step.toolCalls ?? []) {
			if ((DRAFT_TOOL_NAMES as readonly string[]).includes(call.toolName)) {
				draftToolCalled = true;
			} else if (call.toolName === SKIP_TOOL_NAME) {
				skipped = true;
				const args = (call.input ?? call.args) as { reason?: unknown } | undefined;
				if (typeof args?.reason === "string" && args.reason.trim()) {
					skipReason = args.reason.trim();
				}
			}
		}
	}

	// An actual draft always wins over a skip: don't report "skipped" for an
	// email the agent did draft a reply to.
	if (draftToolCalled) return { draftToolCalled, skipped: false, skipReason: null };
	return { draftToolCalled, skipped, skipReason };
}

/**
 * Whether the agent's free text should be saved as an inline draft.
 *
 * Only when the model neither used a draft tool nor explicitly declined: the
 * inline fallback exists for models that write the reply as text instead of
 * calling the tool, not for explanations of why no reply is needed (#73).
 */
export function shouldSaveInlineDraft(outcome: AutoDraftOutcome, text: string): boolean {
	return !outcome.draftToolCalled && !outcome.skipped && text.trim().length > 0;
}

/** Text logged to the agent chat for an auto-triggered email. */
export function autoDraftChatSummary(outcome: AutoDraftOutcome, sender: string, text: string): string {
	if (outcome.draftToolCalled) return `Created draft reply to ${sender}.`;
	if (outcome.skipped) return `Skipped: ${outcome.skipReason ?? "no reply needed"}`;
	return text;
}
