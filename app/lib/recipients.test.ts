// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { applySuggestion, currentToken, enteredAddresses } from "./recipients";

describe("recipient field helpers (#88)", () => {
	it("finds the token being typed", () => {
		expect(currentToken("")).toBe("");
		expect(currentToken("da")).toBe("da");
		expect(currentToken("a@b.co, da")).toBe("da");
		expect(currentToken("a@b.co, ")).toBe("");
	});
	it("applies a suggestion in place of the token", () => {
		expect(applySuggestion("da", "dave@example.net")).toBe("dave@example.net, ");
		expect(applySuggestion("a@b.co, da", "dave@example.net")).toBe("a@b.co, dave@example.net, ");
		expect(applySuggestion("a@b.co,da", "dave@example.net")).toBe("a@b.co, dave@example.net, ");
	});
	it("lists addresses already entered", () => {
		expect(enteredAddresses("A@b.co, c@d.io, da")).toEqual(["a@b.co", "c@d.io"]);
		expect(enteredAddresses("da")).toEqual([]);
	});
});
