// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Per-mailbox settings stored in R2 at `mailboxes/<id>.json` (#11).
 *
 * Settings relevant to the agent:
 *   autoDraft: { enabled: boolean }   default true
 *   agentModel: string                optional Workers AI model override
 */
import { MODEL_DEFAULTS, resolveModel, type ModelRole } from "./models";

export type MailboxSettingsBlob = Record<string, unknown>;

/** `@cf/vendor/model-name` (or `@hf/...`). */
const MODEL_ID_PATTERN = /^@(cf|hf)\/[\w.-]+\/[\w.-]+$/;

export function isValidModelId(id: unknown): id is string {
	return typeof id === "string" && MODEL_ID_PATTERN.test(id.trim());
}

export async function readMailboxSettings(
	bucket: { get(key: string): Promise<{ json<T>(): Promise<T> } | null> },
	mailboxId: string,
): Promise<MailboxSettingsBlob> {
	try {
		const obj = await bucket.get(`mailboxes/${mailboxId}.json`);
		if (!obj) return {};
		const parsed = await obj.json<unknown>();
		return parsed && typeof parsed === "object" ? (parsed as MailboxSettingsBlob) : {};
	} catch {
		return {};
	}
}

/** Auto-draft is on unless the mailbox explicitly turns it off. */
export function isAutoDraftEnabled(settings: MailboxSettingsBlob | undefined): boolean {
	const autoDraft = settings?.autoDraft as { enabled?: unknown } | undefined;
	return autoDraft?.enabled !== false;
}

/**
 * Model for an agent role. A valid per-mailbox `agentModel` overrides the agent
 * chat and auto-draft models; everything else (scanner, verifier) stays
 * deployment-wide.
 */
export function modelForMailbox(
	env: object | undefined,
	settings: MailboxSettingsBlob | undefined,
	role: ModelRole,
): string {
	if ((role === "agent" || role === "autoDraft") && isValidModelId(settings?.agentModel)) {
		return (settings!.agentModel as string).trim();
	}
	return resolveModel(env, role) || MODEL_DEFAULTS[role];
}

/** Returns an error message if the settings blob contains invalid agent fields. */
export function validateAgentSettings(settings: MailboxSettingsBlob): string | null {
	if (settings.agentModel !== undefined && settings.agentModel !== "" && !isValidModelId(settings.agentModel)) {
		return "agentModel must be a Workers AI model ID such as @cf/moonshotai/kimi-k2.5";
	}
	const autoDraft = settings.autoDraft as { enabled?: unknown } | undefined;
	if (autoDraft !== undefined && (typeof autoDraft !== "object" || autoDraft === null || (autoDraft.enabled !== undefined && typeof autoDraft.enabled !== "boolean"))) {
		return "autoDraft must be { enabled: boolean }";
	}
	return null;
}
