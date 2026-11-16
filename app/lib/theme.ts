// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Light/dark theme preference (#89). Kumo themes via `data-mode` on <html>. */

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "agentic-inbox:theme";

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === "system" || value === "light" || value === "dark";
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
	if (pref === "system") return systemPrefersDark ? "dark" : "light";
	return pref;
}

export function nextPreference(pref: ThemePreference): ThemePreference {
	return pref === "system" ? "light" : pref === "light" ? "dark" : "system";
}

/**
 * Inline script run before first paint so a dark theme doesn't flash light.
 * Keep in sync with resolveTheme.
 */
export const THEME_INIT_SCRIPT = `try{var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-mode",d?"dark":"light");document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}`;
