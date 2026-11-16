// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { labelChipStyle } from "~/lib/label-colors";
import type { Label } from "~/types";

/** A small coloured pill for a label (#89). */
export default function LabelChip({ label }: { label: Pick<Label, "name" | "color"> }) {
	return (
		<span
			className="inline-flex max-w-[110px] shrink-0 items-center truncate rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none"
			style={labelChipStyle(label.color)}
			title={label.name}
		>
			<span className="truncate">{label.name}</span>
		</span>
	);
}
