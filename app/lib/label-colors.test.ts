// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { LABEL_COLORS, labelChipStyle, labelHex } from "./label-colors";

describe("label colours (#89)", () => {
	it("has a hex for every colour and falls back to slate", () => {
		for (const c of LABEL_COLORS) expect(labelHex(c)).toMatch(/^#[0-9a-f]{6}$/);
		expect(labelHex("nonsense")).toBe(labelHex("slate"));
		expect(labelHex(undefined)).toBe(labelHex("slate"));
	});
	it("tints the chip background", () => {
		expect(labelChipStyle("red")).toEqual({ backgroundColor: "#ef444426", color: "#ef4444" });
	});
	it("matches the server's colour list", async () => {
		const server = await import("../../workers/lib/labels");
		expect([...LABEL_COLORS]).toEqual([...server.LABEL_COLORS]);
	});
});
