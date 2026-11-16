// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Initials avatars: fixed tonal pairs (pastel fill, deep same-hue text, each >= 4.5:1) hashed from
 * the name so a person keeps the same colour on every screen and in both themes. Same eight pairs
 * as the mobile app's Airmail design system.
 */

export const AVATAR_PAIRS = [
	{ name: "blue", bg: "#d3e4ff", fg: "#004a77" },
	{ name: "green", bg: "#c4eed0", fg: "#0f5223" },
	{ name: "amber", bg: "#ffdf9e", fg: "#5c4200" },
	{ name: "purple", bg: "#eaddff", fg: "#4f378b" },
	{ name: "teal", bg: "#ccf7ef", fg: "#00504a" },
	{ name: "orange", bg: "#ffdbc8", fg: "#723b16" },
	{ name: "red", bg: "#ffdad6", fg: "#8c1d18" },
	{ name: "slate", bg: "#dde1e6", fg: "#2f3640" },
] as const;

/** "Ada Lovelace <ada@x.com>" -> "Ada Lovelace"; "ada@x.com" -> "ada". */
export function displayName(sender: string | undefined | null): string {
	const raw = (sender ?? "").trim();
	if (!raw) return "";
	const angle = raw.match(/^"?([^"<]*?)"?\s*<[^>]+>$/);
	if (angle?.[1]?.trim()) return angle[1].trim();
	const addr = raw.replace(/^<|>$/g, "");
	return addr.split("@")[0] || addr;
}

/** Up to two letters: first letters of the first two words ("ada.lovelace" counts as two). */
export function initials(name: string): string {
	const words = name.split(/[\s._-]+/).filter(Boolean);
	if (words.length === 0) return "?";
	const letters = words.length === 1 ? words[0].slice(0, 1) : words[0].slice(0, 1) + words[1].slice(0, 1);
	return letters.toUpperCase();
}

export function avatarPair(name: string) {
	let hash = 0;
	for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return AVATAR_PAIRS[hash % AVATAR_PAIRS.length];
}
