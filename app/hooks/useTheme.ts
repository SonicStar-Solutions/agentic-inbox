// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { create } from "zustand";
import {
	isThemePreference,
	nextPreference,
	resolveTheme,
	THEME_STORAGE_KEY,
	type ResolvedTheme,
	type ThemePreference,
} from "~/lib/theme";

const systemDark = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

function readPreference(): ThemePreference {
	try {
		const v = window.localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(v) ? v : "system";
	} catch {
		return "system";
	}
}

function apply(resolved: ResolvedTheme) {
	document.documentElement.setAttribute("data-mode", resolved);
	document.documentElement.style.colorScheme = resolved;
}

interface ThemeState {
	preference: ThemePreference;
	resolved: ResolvedTheme;
	setPreference: (pref: ThemePreference) => void;
	cycle: () => void;
	init: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
	preference: "system",
	resolved: "light",
	setPreference: (preference) => {
		try {
			window.localStorage.setItem(THEME_STORAGE_KEY, preference);
		} catch {
			// storage unavailable: the choice lasts for this session only
		}
		const resolved = resolveTheme(preference, systemDark());
		apply(resolved);
		set({ preference, resolved });
	},
	cycle: () => get().setPreference(nextPreference(get().preference)),
	/** Read the stored preference and follow OS changes while on "system". */
	init: () => {
		const preference = readPreference();
		const resolved = resolveTheme(preference, systemDark());
		apply(resolved);
		set({ preference, resolved });
		window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
			if (get().preference !== "system") return;
			const next = resolveTheme("system", systemDark());
			apply(next);
			set({ resolved: next });
		});
	},
}));
