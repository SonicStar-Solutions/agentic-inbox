// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { dayLabel, groupByDay, postmarkMonth } from "./day-groups";

// Local-time constructors so the tests hold in any timezone.
const now = new Date(2026, 10, 15, 14, 0); // Sun 15 Nov 2026
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).toISOString();

describe("dayLabel", () => {
	it("names today and yesterday", () => {
		expect(dayLabel(new Date(2026, 10, 15, 1), now)).toBe("Today");
		expect(dayLabel(new Date(2026, 10, 14, 23), now)).toBe("Yesterday");
	});

	it("uses the weekday inside a week, then the date", () => {
		expect(dayLabel(new Date(2026, 10, 12), now)).toBe("Thursday");
		expect(dayLabel(new Date(2026, 10, 8), now)).toBe("8 November");
		expect(dayLabel(new Date(2026, 6, 3), now)).toBe("3 July");
	});

	it("adds the year only when it differs from the current one", () => {
		expect(dayLabel(new Date(2025, 6, 3), now)).toBe("3 July 2025");
	});
});

describe("groupByDay", () => {
	it("groups consecutive rows on the same local day", () => {
		const rows = [
			{ id: "a", date: at(2026, 11, 15, 12) },
			{ id: "b", date: at(2026, 11, 15, 8) },
			{ id: "c", date: at(2026, 11, 14, 20) },
		];
		const groups = groupByDay(rows, (r) => r.date, now);
		expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
			["Today", ["a", "b"]],
			["Yesterday", ["c"]],
		]);
		expect(groups[0].date).toEqual(new Date(2026, 10, 15));
	});

	it("keeps rows with a bad date instead of dropping them", () => {
		const rows = [
			{ id: "a", date: at(2026, 11, 15) },
			{ id: "b", date: "not a date" },
		];
		const groups = groupByDay(rows, (r) => r.date, now);
		expect(groups).toHaveLength(1);
		expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b"]);
	});

	it("returns no groups for an empty list", () => {
		expect(groupByDay([], () => "", now)).toEqual([]);
	});
});

describe("postmarkMonth", () => {
	it("is three uppercase letters", () => {
		expect(postmarkMonth(new Date(2026, 6, 3))).toBe("JUL");
	});
});
