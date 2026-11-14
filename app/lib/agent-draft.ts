// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Extract the draft saved by the agent's `draft_reply` tool from a chat
 * message's parts.
 *
 * AI SDK v6 represents a tool call as `{ type: "tool-draft_reply", output }`
 * (or `{ type: "dynamic-tool", toolName: "draft_reply", output }`); older shapes
 * used `{ toolName, result }`. The tool returns `{ status: "draft_saved",
 * draftId, draft: { originalEmailId, to, subject, body } }`.
 */

export interface AgentDraftRef {
	draftId: string;
	originalEmailId?: string;
	to?: string;
	subject?: string;
	body?: string;
}

interface PartLike {
	type: string;
	toolName?: string;
	output?: unknown;
	result?: unknown;
}

function toolNameOf(part: PartLike): string | null {
	if (part.type === "dynamic-tool") return part.toolName ?? null;
	if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
	return part.toolName ?? null;
}

export function findDraftReplyOutput(parts: PartLike[]): AgentDraftRef | null {
	// Walk backwards: if the agent drafted more than once, the last one wins.
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i];
		if (toolNameOf(part) !== "draft_reply") continue;
		const out = (part.output ?? part.result) as
			| { status?: string; draftId?: unknown; draft?: Record<string, unknown> }
			| undefined;
		if (!out || typeof out !== "object" || typeof out.draftId !== "string") continue;
		const d = out.draft ?? {};
		return {
			draftId: out.draftId,
			originalEmailId: typeof d.originalEmailId === "string" ? d.originalEmailId : undefined,
			to: typeof d.to === "string" ? d.to : undefined,
			subject: typeof d.subject === "string" ? d.subject : undefined,
			body: typeof d.body === "string" ? d.body : undefined,
		};
	}
	return null;
}
