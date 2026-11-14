// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { z } from "zod";
import { SendEmailRequestSchema } from "./schemas";

/** Scheduled ("send later") messages (#89). */

export const MIN_SCHEDULE_LEAD_MS = 60 * 1000;
export const MAX_SCHEDULE_LEAD_MS = 90 * 24 * 60 * 60 * 1000;

export const ScheduleRequestSchema = z
	.object({
		kind: z.enum(["compose", "reply"]),
		/** The message being replied to (kind "reply"). */
		originalEmailId: z.string().min(1).optional(),
		/** ISO timestamp to send at. */
		send_at: z.string().min(1),
		email: SendEmailRequestSchema,
	})
	.refine((v) => v.kind !== "reply" || !!v.originalEmailId, { message: "originalEmailId is required for a reply" })
	.refine((v) => !v.email.attachments || v.email.attachments.length === 0, {
		message: "Scheduled messages cannot have attachments yet",
	});

export type ScheduleRequest = z.infer<typeof ScheduleRequestSchema>;

/** Returns the normalised ISO time, or an error message. */
export function validateSendAt(sendAt: string, now: Date = new Date()): { ok: true; iso: string } | { ok: false; error: string } {
	const t = new Date(sendAt).getTime();
	if (Number.isNaN(t)) return { ok: false, error: "send_at is not a valid date" };
	if (t < now.getTime() + MIN_SCHEDULE_LEAD_MS) return { ok: false, error: "send_at must be at least a minute in the future" };
	if (t > now.getTime() + MAX_SCHEDULE_LEAD_MS) return { ok: false, error: "send_at must be within 90 days" };
	return { ok: true, iso: new Date(t).toISOString() };
}

export interface ScheduledEmailSummary {
	id: string;
	kind: "compose" | "reply";
	send_at: string;
	status: "pending" | "sending" | "failed";
	error: string | null;
	to: string;
	subject: string;
}
