// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Label colours (#89). Mid-tone hues that read on both the light and dark theme. */
export const LABEL_COLORS = ["slate", "red", "orange", "amber", "green", "teal", "blue", "purple"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

const HEX: Record<LabelColor, string> = {
	slate: "#64748b",
	red: "#ef4444",
	orange: "#f97316",
	amber: "#d97706",
	green: "#16a34a",
	teal: "#0d9488",
	blue: "#3b82f6",
	purple: "#a855f7",
};

export function labelHex(color: string | undefined): string {
	return HEX[(color as LabelColor) in HEX ? (color as LabelColor) : "slate"];
}

/** Inline style for a chip: tinted background, coloured text. */
export function labelChipStyle(color: string | undefined): { backgroundColor: string; color: string } {
	const hex = labelHex(color);
	return { backgroundColor: `${hex}26`, color: hex };
}
