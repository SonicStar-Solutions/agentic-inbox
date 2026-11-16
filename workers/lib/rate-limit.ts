// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Emit one structured log line when a send is rejected by the per-mailbox rate
 * limit, so operators can tell whether limits are firing, for which mailbox,
 * and whether something is looping (#18). The response shape is unchanged.
 *
 * `message` is what MailboxDO.checkSendRateLimit returned, e.g.
 * "Rate limit exceeded: max 20 emails per hour per mailbox".
 */
export function logRateLimitHit(source: string, mailboxId: string, message: string): void {
	const match = message.match(/max (\d+) emails per (\w+)/i);
	console.warn("rate_limit_hit", {
		source,
		mailboxId,
		limit: match ? `${match[1]}/${match[2]}` : "send",
		message,
		at: new Date().toISOString(),
	});
}
