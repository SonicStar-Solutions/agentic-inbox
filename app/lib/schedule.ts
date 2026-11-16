// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Helpers for "send later" (#89). */

export interface SchedulePreset {
	label: string;
	date: Date;
}

/** The next occurrence of `hour:00` local time, strictly after `now`. */
function nextAt(now: Date, hour: number, daysAhead = 0): Date {
	const d = new Date(now);
	d.setDate(d.getDate() + daysAhead);
	d.setHours(hour, 0, 0, 0);
	return d;
}

export function schedulePresets(now: Date = new Date()): SchedulePreset[] {
	const presets: SchedulePreset[] = [{ label: "In 1 hour", date: new Date(now.getTime() + 60 * 60 * 1000) }];

	// Later today at 5 PM, only if there are at least 2 hours until then
	const evening = nextAt(now, 17);
	if (evening.getTime() - now.getTime() >= 2 * 60 * 60 * 1000) presets.push({ label: "This evening, 5:00 PM", date: evening });

	presets.push({ label: "Tomorrow morning, 8:00 AM", date: nextAt(now, 8, 1) });

	// Next Monday 8 AM (always the following Monday, never today)
	const daysToMonday = ((8 - now.getDay()) % 7) || 7;
	presets.push({ label: "Monday morning, 8:00 AM", date: nextAt(now, 8, daysToMonday) });
	return presets;
}

/** Value for <input type="datetime-local"> (local time, minute precision). */
export function toDateTimeLocalValue(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse a datetime-local value as local time. */
export function fromDateTimeLocalValue(value: string): Date | null {
	const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
	if (!m) return null;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
	return Number.isNaN(d.getTime()) ? null : d;
}
