// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { fromDateTimeLocalValue, schedulePresets, toDateTimeLocalValue } from "./schedule";

describe("schedulePresets (#89)", () => {
	it("offers an hour from now, tomorrow 8am and next Monday 8am", () => {
		const now = new Date(2026, 10, 14, 19, 30); // Sat 14 Nov 2026, 19:30 local
		const p = schedulePresets(now);
		expect(p.map((x) => x.label)).toEqual(["In 1 hour", "Tomorrow morning, 8:00 AM", "Monday morning, 8:00 AM"]);
		expect(p[0].date.getTime()).toBe(now.getTime() + 3600_000);
		expect(toDateTimeLocalValue(p[1].date)).toBe("2026-11-15T08:00");
		expect(toDateTimeLocalValue(p[2].date)).toBe("2026-11-16T08:00");
	});
	it("adds an evening option only when it is at least two hours away", () => {
		expect(schedulePresets(new Date(2026, 10, 14, 9, 0)).map((x) => x.label)).toContain("This evening, 5:00 PM");
		expect(schedulePresets(new Date(2026, 10, 14, 16, 0)).map((x) => x.label)).not.toContain("This evening, 5:00 PM");
	});
	it("on a Monday, 'Monday' means next week", () => {
		const monday = new Date(2026, 10, 16, 10, 0);
		const p = schedulePresets(monday).find((x) => x.label.startsWith("Monday"))!;
		expect(toDateTimeLocalValue(p.date)).toBe("2026-11-23T08:00");
	});
	it("round-trips datetime-local values", () => {
		const d = new Date(2026, 10, 14, 9, 5);
		expect(toDateTimeLocalValue(d)).toBe("2026-11-14T09:05");
		expect(fromDateTimeLocalValue("2026-11-14T09:05")?.getTime()).toBe(d.getTime());
		expect(fromDateTimeLocalValue("nope")).toBeNull();
	});
});
