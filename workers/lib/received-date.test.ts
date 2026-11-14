// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { receiveEmail } from "../index";
import { fakeExecutionCtx, makeFakeEnv, rawEmailEvent, rfc822 } from "../test-utils";
import { resolveReceivedDate } from "./received-date";

const now = new Date("2026-11-14T18:00:00.000Z");

describe("resolveReceivedDate (#89)", () => {
	it("uses a plausible Date header", () => {
		expect(resolveReceivedDate("Sun, 08 Nov 2026 12:10:00 -0800", now)).toBe("2026-11-08T20:10:00.000Z");
		expect(resolveReceivedDate("2026-11-13T09:00:00Z", now)).toBe("2026-11-13T09:00:00.000Z");
	});
	it("falls back to receipt time for missing, unparseable or absurd dates", () => {
		const fallback = now.toISOString();
		expect(resolveReceivedDate(undefined, now)).toBe(fallback);
		expect(resolveReceivedDate("", now)).toBe(fallback);
		expect(resolveReceivedDate("not a date", now)).toBe(fallback);
		expect(resolveReceivedDate("2099-01-01T00:00:00Z", now)).toBe(fallback);
		expect(resolveReceivedDate("1970-01-01T00:00:00Z", now)).toBe(fallback);
	});
	it("allows small clock skew into the future", () => {
		expect(resolveReceivedDate("2026-11-14T19:00:00Z", now)).toBe("2026-11-14T19:00:00.000Z");
	});
});

describe("inbound messages keep their own Date", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	it("stores the Date header instead of the receipt time", async () => {
		const { env, stubs } = makeFakeEnv();
		const raw = rfc822({ From: "dave@example.net", To: "alice@example.com", Subject: "old", Date: "Mon, 03 Nov 2025 10:00:00 +0000" });
		await receiveEmail(rawEmailEvent(raw, "alice@example.com") as any, env, fakeExecutionCtx().ctx);
		expect(stubs["alice@example.com"].rows[0].email.date).toBe("2025-11-03T10:00:00.000Z");
	});
});
