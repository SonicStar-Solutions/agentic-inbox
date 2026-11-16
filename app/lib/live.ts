// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Live updates over a WebSocket (#89): message parsing and reconnect timing. */

export type ChangeScope = "emails" | "folders" | "scheduled" | "all";

/** Parse a server message; null if it isn't a change notification. */
export function parseChange(data: unknown): ChangeScope | null {
	if (typeof data !== "string") return null;
	try {
		const msg = JSON.parse(data) as { type?: unknown; scope?: unknown };
		if (msg.type !== "changed") return null;
		return msg.scope === "emails" || msg.scope === "folders" || msg.scope === "scheduled" || msg.scope === "all" ? msg.scope : "all";
	} catch {
		return null;
	}
}

/** Query keys to refetch for a change (all keys are prefixes). */
export function keysForScope(scope: ChangeScope, mailboxId: string): (string | undefined)[][] {
	const emails = [["emails", mailboxId], ["folders", mailboxId], ["labels", mailboxId], ["search"]];
	switch (scope) {
		case "emails":
			return emails; // unread counts live with the folders
		case "folders":
			return [["folders", mailboxId], ["labels", mailboxId]];
		case "scheduled":
			return [["scheduled", mailboxId]];
		default:
			return [...emails, ["scheduled", mailboxId], ["contacts", mailboxId]];
	}
}

/** Reconnect delay: exponential from 1s, capped at 30s, with jitter. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
	const base = Math.min(1000 * 2 ** Math.max(attempt, 0), 30_000);
	return Math.round(base * (0.75 + random() * 0.5));
}
