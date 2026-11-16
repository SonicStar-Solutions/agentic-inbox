// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { avatarPair, displayName, initials } from "./avatar";

describe("displayName", () => {
	it("prefers the name in a named address", () => {
		expect(displayName('"Ada Lovelace" <ada@example.com>')).toBe("Ada Lovelace");
		expect(displayName("Ada Lovelace <ada@example.com>")).toBe("Ada Lovelace");
	});

	it("falls back to the local part of a bare address", () => {
		expect(displayName("ada@example.com")).toBe("ada");
		expect(displayName("<ada@example.com>")).toBe("ada");
	});

	it("tolerates empty input", () => {
		expect(displayName("")).toBe("");
		expect(displayName(undefined)).toBe("");
	});
});

describe("initials", () => {
	it("uses the first letters of the first two words", () => {
		expect(initials("Ada Lovelace")).toBe("AL");
		expect(initials("ada.lovelace")).toBe("AL");
		expect(initials("ada")).toBe("A");
	});

	it("falls back to a placeholder", () => {
		expect(initials("")).toBe("?");
		expect(initials("..")).toBe("?");
	});
});

describe("avatarPair", () => {
	it("is stable for a name regardless of case", () => {
		expect(avatarPair("Ada")).toBe(avatarPair("ada"));
	});
});
