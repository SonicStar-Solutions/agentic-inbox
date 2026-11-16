// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { ScheduleRequestSchema, validateSendAt } from "./scheduled";

const email = { to: "dave@example.net", from: "alice@example.com", subject: "Hi", text: "hello" };
const now = new Date("2026-11-14T12:00:00Z");

describe("validateSendAt (#89)", () => {
	it("accepts a time between a minute and 90 days ahead", () => {
		expect(validateSendAt("2026-11-14T12:05:00Z", now)).toEqual({ ok: true, iso: "2026-11-14T12:05:00.000Z" });
		expect(validateSendAt("2027-01-01T00:00:00Z", now).ok).toBe(true);
	});
	it("rejects past, too-soon, too-far and invalid times", () => {
		expect(validateSendAt("2026-11-14T11:00:00Z", now).ok).toBe(false);
		expect(validateSendAt("2026-11-14T12:00:30Z", now).ok).toBe(false);
		expect(validateSendAt("2027-06-01T00:00:00Z", now).ok).toBe(false);
		expect(validateSendAt("soon", now).ok).toBe(false);
	});
});

describe("ScheduleRequestSchema", () => {
	it("accepts compose and reply requests", () => {
		expect(ScheduleRequestSchema.safeParse({ kind: "compose", send_at: "x", email }).success).toBe(true);
		expect(ScheduleRequestSchema.safeParse({ kind: "reply", originalEmailId: "e1", send_at: "x", email }).success).toBe(true);
	});
	it("requires the original for a reply and rejects attachments", () => {
		expect(ScheduleRequestSchema.safeParse({ kind: "reply", send_at: "x", email }).success).toBe(false);
		const withAtt = { ...email, attachments: [{ content: "QQ==", filename: "a.txt", type: "text/plain", disposition: "attachment" }] };
		expect(ScheduleRequestSchema.safeParse({ kind: "compose", send_at: "x", email: withAtt }).success).toBe(false);
	});
});
