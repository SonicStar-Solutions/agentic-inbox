// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { avatarPair, initials } from "~/lib/avatar";

/** Tonal initials circle; the colour is hashed from the name so it is stable everywhere. */
export default function InitialsAvatar({ name, size = 40 }: { name: string; size?: 32 | 40 }) {
	const pair = avatarPair(name);
	return (
		<span
			aria-hidden="true"
			className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${size === 40 ? "h-10 w-10 text-[15px]" : "h-8 w-8 text-xs"}`}
			style={{ backgroundColor: pair.bg, color: pair.fg }}
		>
			{initials(name)}
		</span>
	);
}
