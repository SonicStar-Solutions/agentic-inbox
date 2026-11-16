// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The app's progress line: a 6px strip of navy and red diagonal stripes. Static at rest; slides
 * one stripe period every 500ms while `active` (refresh, sync, sending). With reduced motion it
 * holds still and dims instead. One per screen, directly under the header; never on dialogs or
 * cards. See "AirmailBand" in Mobile/docs/DESIGN_SYSTEM.md.
 */
export default function AirmailBand({ active = false }: { active?: boolean }) {
	return (
		<div
			className="airmail-band"
			data-active={active}
			role={active ? "progressbar" : undefined}
			aria-label={active ? "Loading" : undefined}
			aria-hidden={active ? undefined : true}
		/>
	);
}
