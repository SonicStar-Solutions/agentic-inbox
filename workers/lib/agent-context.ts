// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Context about what the operator is looking at, sent by the agent panel (#89).
 *
 * Only opaque ids go into the system prompt. Subjects and senders are written by
 * whoever sent the mail, so they stay out of the system prompt; the agent reads
 * the message itself with its tools (the same path as any other email).
 */

const ID_PATTERN = /^[\w@.\-:]{1,200}$/;

export interface AgentViewContext {
	selectedEmailId: string;
}

/** Pull a valid view context out of the chat request body, or null. */
export function parseViewContext(body: unknown): AgentViewContext | null {
	const context = (body as { context?: { selectedEmailId?: unknown } } | undefined)?.context;
	const id = context?.selectedEmailId;
	return typeof id === "string" && ID_PATTERN.test(id) ? { selectedEmailId: id } : null;
}

/** Text appended to the system prompt, or "" when nothing is open. */
export function viewContextPrompt(context: AgentViewContext | null, threadId?: string | null): string {
	if (!context) return "";
	const thread = threadId && ID_PATTERN.test(threadId) ? ` (thread_id "${threadId}")` : "";
	return `

## Current view
The operator currently has the email with id "${context.selectedEmailId}"${thread} open. When they say "this email", "this thread" or "the open message", they mean that one: read it with get_email${thread ? " and get_thread" : ""} before answering.`;
}
