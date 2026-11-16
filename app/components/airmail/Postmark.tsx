// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { postmarkMonth } from "~/lib/day-groups";

/**
 * A 40px ring holding the day of the month over a three-letter month, in navy. It marks a date
 * that leads a group (day headers, day separators in a thread) and never decorates.
 */
export default function Postmark({ date }: { date: Date }) {
	return (
		<span
			aria-hidden="true"
			className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-full border-[1.5px] border-kumo-brand text-kumo-brand"
		>
			<span className="text-[14px] font-semibold leading-[14px]">{date.getDate()}</span>
			<span className="text-[10px] font-bold leading-[11px] tracking-[0.04em]">{postmarkMonth(date)}</span>
		</span>
	);
}
