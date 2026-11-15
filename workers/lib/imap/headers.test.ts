// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { importMessageKey, parseSummaryHeaders } from "./headers";

describe("summary headers", () => {
	it("reads the fields, including folded lines", () => {
		const h = parseSummaryHeaders(
			"Message-ID: <abc@mail.example.com>\r\nDate: Mon, 2 Mar 2015 10:00:00 +0000\r\nFrom: Bob <bob@example.com>\r\nSubject: A very\r\n long subject\r\n\r\n",
		);
		expect(h.messageId).toBe("abc@mail.example.com");
		expect(h.subject).toBe("A very long subject");
		expect(h.from).toBe("Bob <bob@example.com>");
	});
	it("handles a missing block", () => {
		expect(parseSummaryHeaders(null)).toEqual({ messageId: null, date: null, from: null, subject: null });
	});
});

describe("importMessageKey", () => {
	it("uses the real Message-ID", async () => {
		expect(await importMessageKey(parseSummaryHeaders("Message-ID: <x@y>\r\n"), 100, true)).toBe("x@y");
	});
	it("makes a stable synthetic key when there is none", async () => {
		const h = parseSummaryHeaders("Date: Mon, 2 Mar 2015\r\nFrom: a@b.com\r\nSubject: Hi\r\n");
		const a = await importMessageKey(h, 500, true);
		const b = await importMessageKey(h, 500, true);
		const c = await importMessageKey(h, 501, true);
		expect(a).toMatch(/^import-[0-9a-f]{32}@import\.invalid$/);
		expect(a).toBe(b);
		expect(a).not.toBe(c);
	});
	it("has no key when no header block came back", async () => {
		expect(await importMessageKey(parseSummaryHeaders(null), 10, false)).toBeNull();
	});
});
