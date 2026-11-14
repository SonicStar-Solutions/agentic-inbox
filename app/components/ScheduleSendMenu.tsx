// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { ClockIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fromDateTimeLocalValue, schedulePresets, toDateTimeLocalValue } from "~/lib/schedule";

interface ScheduleSendMenuProps {
	disabled?: boolean;
	onSchedule: (when: Date) => void;
}

/** "Send later" picker for the composer (#89): presets plus a custom time. */
export default function ScheduleSendMenu({ disabled, onSchedule }: ScheduleSendMenuProps) {
	const [open, setOpen] = useState(false);
	const [custom, setCustom] = useState("");
	const ref = useRef<HTMLDivElement>(null);
	const presets = useMemo(() => (open ? schedulePresets() : []), [open]);
	const customDate = fromDateTimeLocalValue(custom);
	const customValid = !!customDate && customDate.getTime() > Date.now() + 60_000;

	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const pick = (when: Date) => {
		setOpen(false);
		onSchedule(when);
	};

	return (
		<div ref={ref} className="relative">
			<Button
				type="button"
				variant="secondary"
				size="sm"
				disabled={disabled}
				icon={<ClockIcon size={14} />}
				onClick={() => {
					setCustom(toDateTimeLocalValue(new Date(Date.now() + 2 * 60 * 60 * 1000)));
					setOpen((o) => !o);
				}}
				aria-haspopup="menu"
				aria-expanded={open}
			>
				Send later
			</Button>
			{open && (
				<div
					role="menu"
					className="absolute bottom-full right-0 z-30 mb-2 w-72 rounded-lg border border-kumo-line bg-kumo-base p-2 shadow-lg"
				>
					{presets.map((p) => (
						<button
							key={p.label}
							type="button"
							role="menuitem"
							onClick={() => pick(p.date)}
							className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-kumo-default hover:bg-kumo-tint"
						>
							<span>{p.label}</span>
							<span className="text-xs text-kumo-subtle">
								{p.date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
							</span>
						</button>
					))}
					<div className="mt-1 border-t border-kumo-line px-1 pt-2">
						<label className="mb-1 block text-xs text-kumo-subtle" htmlFor="schedule-custom">
							Pick date and time
						</label>
						<div className="flex items-center gap-2">
							<input
								id="schedule-custom"
								type="datetime-local"
								value={custom}
								onChange={(e) => setCustom(e.target.value)}
								className="min-w-0 flex-1 rounded-md border border-kumo-line bg-kumo-recessed px-2 py-1 text-sm text-kumo-default"
							/>
							<Button type="button" variant="primary" size="xs" disabled={!customValid} onClick={() => customDate && pick(customDate)}>
								Schedule
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
