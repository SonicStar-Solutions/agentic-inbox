// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { isThemePreference, nextPreference, resolveTheme, THEME_INIT_SCRIPT } from "./theme";

describe("theme (#89)", () => {
	it("resolves system against the OS preference", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
	});
	it("cycles system -> light -> dark -> system", () => {
		expect(nextPreference("system")).toBe("light");
		expect(nextPreference("light")).toBe("dark");
		expect(nextPreference("dark")).toBe("system");
	});
	it("validates stored values", () => {
		expect(isThemePreference("dark")).toBe(true);
		expect(isThemePreference("sepia")).toBe(false);
		expect(isThemePreference(null)).toBe(false);
	});
	it("init script is valid JavaScript that sets data-mode", () => {
		expect(() => new Function(THEME_INIT_SCRIPT)).not.toThrow();
		expect(THEME_INIT_SCRIPT).toContain("data-mode");
	});
});
