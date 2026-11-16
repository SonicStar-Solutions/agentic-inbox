// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { attachLabels, labelIdFromName, LabelInputSchema, LabelUpdateSchema, type Label } from "./labels";

describe("labels (#89)", () => {
	it("derives URL-safe ids", () => {
		expect(labelIdFromName("Client Work!")).toBe("client-work");
		expect(labelIdFromName("  Résumé / CV ")).toBe("résumé-cv");
		expect(labelIdFromName("***")).toBe("label");
		expect(labelIdFromName("x".repeat(100))).toHaveLength(40);
	});

	it("validates label input", () => {
		expect(LabelInputSchema.safeParse({ name: "  Urgent " })).toMatchObject({ success: true, data: { name: "Urgent", color: "slate" } });
		expect(LabelInputSchema.safeParse({ name: "   " }).success).toBe(false);
		expect(LabelInputSchema.safeParse({ name: "x".repeat(31) }).success).toBe(false);
		expect(LabelInputSchema.safeParse({ name: "a", color: "hotpink" }).success).toBe(false);
	});

	it("requires something to update", () => {
		expect(LabelUpdateSchema.safeParse({}).success).toBe(false);
		expect(LabelUpdateSchema.safeParse({ color: "red" }).success).toBe(true);
	});

	it("attaches labels by message and by thread without duplicates", () => {
		const urgent: Label = { id: "urgent", name: "Urgent", color: "red" };
		const work: Label = { id: "work", name: "Work", color: "blue" };
		const rows = [{ id: "e1", thread_id: "t1" }, { id: "e2", thread_id: "t2" }, { id: "e3", thread_id: null }];
		const out = attachLabels(rows, new Map([["e1", [urgent]]]), new Map([["t1", [urgent, work]]]));
		expect(out[0].labels.map((l) => l.id)).toEqual(["urgent", "work"]);
		expect(out[1].labels).toEqual([]);
		expect(out[2].labels).toEqual([]);
	});
});
