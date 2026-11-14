// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { sendEmail, type SendEmailParams } from "../email-sender";

/**
 * Normalise a Message-ID returned by the email provider: trim whitespace and
 * strip surrounding angle brackets so it matches how inbound Message-IDs are
 * stored (see `extractMsgId` in workers/index.ts). Returns null when the
 * provider gave nothing usable.
 */
export function normalizeMessageId(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const m = raw.match(/<([^>]+)>/);
	const id = (m ? m[1] : raw).trim();
	return id.length > 0 ? id : null;
}

export type DeliveryResult =
	| { ok: true; messageId: string }
	| { ok: false; response: Response };

/**
 * Deliver a message through the Email Service binding and wait for the
 * outcome. On failure the caller gets a ready-made 502 response so routes can
 * report the failure instead of filing the message in Sent as if it went out.
 *
 * On success `messageId` is the provider-assigned Message-ID (what recipients
 * actually receive), falling back to `fallbackMessageId` if the provider did
 * not return one.
 */
export async function deliverEmail(
	c: Context,
	binding: SendEmail,
	params: SendEmailParams,
	fallbackMessageId: string,
): Promise<DeliveryResult> {
	try {
		const result = await sendEmail(binding, params);
		return {
			ok: true,
			messageId: normalizeMessageId(result?.messageId) ?? fallbackMessageId,
		};
	} catch (e) {
		const message = (e as Error)?.message || "unknown error";
		console.error("Email delivery failed:", message);
		return {
			ok: false,
			response: c.json({ error: `Failed to send email: ${message}` }, 502),
		};
	}
}
