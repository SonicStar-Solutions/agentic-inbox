// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { findOverlongSearchTerm, MAX_LIKE_TERM_BYTES, splitLikeTerm } from "./search";

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe("splitLikeTerm (#36)", () => {
	it("leaves short terms untouched", () => {
		expect(splitLikeTerm("invoice")).toEqual(["invoice"]);
		expect(splitLikeTerm("")).toEqual([]);
	});

	it("keeps a 48-byte term whole and splits at 49", () => {
		expect(splitLikeTerm("a".repeat(48))).toHaveLength(1);
		const chunks = splitLikeTerm("a".repeat(49));
		expect(chunks).toHaveLength(2);
		expect(chunks.join("")).toBe("a".repeat(49));
	});

	it("never produces a chunk over the byte limit, including multi-byte text", () => {
		for (const term of ["x".repeat(200), "é".repeat(100), "日本語".repeat(40), "😀".repeat(30)]) {
			const chunks = splitLikeTerm(term);
			expect(chunks.join("")).toBe(term);
			for (const c of chunks) expect(bytes(c)).toBeLessThanOrEqual(MAX_LIKE_TERM_BYTES);
		}
	});

	it("handles the exact subject from the bug report", () => {
		const subject = "cf-agentic-inbox-external-inbound-alchang-20260513T233604Z";
		const chunks = splitLikeTerm(subject);
		expect(chunks.join("")).toBe(subject);
		for (const c of chunks) expect(`%${c}%`.length).toBeLessThanOrEqual(50);
	});
});

describe("findOverlongSearchTerm", () => {
	it("flags only terms over the cap", () => {
		expect(findOverlongSearchTerm({ query: "ok", subject: undefined })).toBeNull();
		expect(findOverlongSearchTerm({ query: "ok", subject: "s".repeat(501) })).toBe("subject");
	});
});
