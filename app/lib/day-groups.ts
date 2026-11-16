// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Groups a date-sorted email list by calendar day for the Airmail day headers
 * (Mobile docs/DESIGN_SYSTEM.md, "DayHeader"). Pure and clock-injected so it can be tested.
 */

export interface DayGroup<T> {
	/** Local calendar day as YYYY-MM-DD; stable React key. */
	key: string;
	/** Local midnight of the day, for the postmark. */
	date: Date;
	/** "Today", "Yesterday", a weekday inside the last week, then "3 July" (+ year if not this year). */
	label: string;
	items: T[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MONTH_ABBREVIATIONS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function dayKey(d: Date): string {
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${m}-${day}`;
}

export function dayLabel(date: Date, now: Date): string {
	const today = startOfDay(now);
	const day = startOfDay(date);
	const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);
	if (diffDays === 0) return "Today";
	if (diffDays === 1) return "Yesterday";
	if (diffDays > 1 && diffDays < 7) return WEEKDAYS[day.getDay()];
	const base = `${day.getDate()} ${MONTHS[day.getMonth()]}`;
	return day.getFullYear() === today.getFullYear() ? base : `${base} ${day.getFullYear()}`;
}

/** Month shown on the postmark: three letters, uppercase. */
export function postmarkMonth(date: Date): string {
	return MONTH_ABBREVIATIONS[date.getMonth()];
}

/**
 * Consecutive emails on the same local day share a group. Rows with an unparseable date join the
 * previous group (or form their own first group) so nothing is dropped.
 */
export function groupByDay<T>(items: T[], getDate: (item: T) => string, now: Date = new Date()): DayGroup<T>[] {
	const groups: DayGroup<T>[] = [];
	for (const item of items) {
		const parsed = new Date(getDate(item));
		const valid = !Number.isNaN(parsed.getTime());
		const last = groups[groups.length - 1];
		if (!valid && last) {
			last.items.push(item);
			continue;
		}
		const day = valid ? startOfDay(parsed) : startOfDay(now);
		const key = valid ? dayKey(day) : "unknown";
		if (last && last.key === key) {
			last.items.push(item);
		} else {
			groups.push({ key, date: day, label: valid ? dayLabel(day, now) : "Undated", items: [item] });
		}
	}
	return groups;
}

/** Clock time only, for rows under a day header (the header carries the day). */
export function formatClock(dateStr: string): string {
	const d = new Date(dateStr);
	if (Number.isNaN(d.getTime())) return "";
	return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
