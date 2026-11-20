// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import Postmark from "~/components/airmail/Postmark";

/** Sticky group header: postmark in the 40px leading slot, day name, optional unread count. */
export default function DayHeader({
	date,
	label,
	unread = 0,
	sticky = true,
}: {
	date: Date;
	label: string;
	unread?: number;
	/** Sticky in lists so rows pass under it; static between messages in a thread. */
	sticky?: boolean;
}) {
	return (
		<div className={`flex items-center gap-4 bg-kumo-base px-4 pb-1 pt-3 ${sticky ? "sticky top-0 z-[1]" : ""}`}>
			<Postmark date={date} />
			<span className="text-sm font-semibold text-kumo-brand">{label}</span>
			{unread > 0 && <span className="ml-auto text-xs text-kumo-subtle">{unread} unread</span>}
		</div>
	);
}
