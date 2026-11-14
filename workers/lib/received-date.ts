// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** How far in the future a Date header may be before it's treated as bogus. */
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/**
 * The date to store for an inbound message (#89): the message's own Date
 * header when it is a plausible time, otherwise the time of receipt.
 *
 * Headers that can't be parsed, or that claim a time more than a day ahead,
 * fall back to receipt time so a spoofed far-future Date can't pin a message
 * to the top of the inbox.
 */
export function resolveReceivedDate(headerDate: unknown, now: Date = new Date()): string {
	if (typeof headerDate === "string" && headerDate.trim()) {
		const parsed = new Date(headerDate);
		const t = parsed.getTime();
		if (!Number.isNaN(t) && t <= now.getTime() + MAX_FUTURE_MS && parsed.getUTCFullYear() >= 1990) {
			return parsed.toISOString();
		}
	}
	return now.toISOString();
}
