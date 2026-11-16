// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { buildFtsQuery, FTS_SETUP_STATEMENTS } from "./fts";

describe("buildFtsQuery (#89)", () => {
	it("makes quoted prefix terms that must all match", () => {
		expect(buildFtsQuery("invoice mar")).toBe('"invoice"* "mar"*');
	});
	it("splits addresses and punctuation into words", () => {
		expect(buildFtsQuery("dave@example.net")).toBe('"dave"* "example"* "net"*');
		expect(buildFtsQuery("re: Q3 (draft)")).toBe('"re"* "Q3"* "draft"*');
	});
	it("neutralises FTS syntax characters", () => {
		expect(buildFtsQuery('"; DROP TABLE emails; --')).toBe('"DROP"* "TABLE"* "emails"*');
		expect(buildFtsQuery("a* OR b NEAR(c)")).toBe('"a"* "OR"* "b"* "NEAR"* "c"*');
	});
	it("handles non-latin text and returns null when nothing is searchable", () => {
		expect(buildFtsQuery("日本語 café")).toBe('"日本語"* "café"*');
		expect(buildFtsQuery("  ... ")).toBeNull();
		expect(buildFtsQuery("")).toBeNull();
	});
	it("caps the number and length of terms", () => {
		expect(buildFtsQuery("a b c d e f g h i j k l m n o")!.split(" ")).toHaveLength(12);
		expect(buildFtsQuery("x".repeat(200))).toBe(`"${"x".repeat(64)}"*`);
	});
});

describe("setup statements", () => {
	it("create the table, three triggers and a rebuild", () => {
		expect(FTS_SETUP_STATEMENTS).toHaveLength(5);
		expect(FTS_SETUP_STATEMENTS[0]).toContain("fts5(");
		expect(FTS_SETUP_STATEMENTS.filter((s) => s.startsWith("CREATE TRIGGER"))).toHaveLength(3);
		expect(FTS_SETUP_STATEMENTS.at(-1)).toContain("'rebuild'");
	});
});
