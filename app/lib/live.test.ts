// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { backoffDelay, keysForScope, parseChange } from "./live";

describe("live updates (#89)", () => {
	it("parses change notifications and ignores everything else", () => {
		expect(parseChange('{"type":"changed","scope":"emails"}')).toBe("emails");
		expect(parseChange('{"type":"changed","scope":"scheduled"}')).toBe("scheduled");
		expect(parseChange('{"type":"changed","scope":"weird"}')).toBe("all");
		expect(parseChange('{"type":"other"}')).toBeNull();
		expect(parseChange("pong")).toBeNull();
		expect(parseChange(42)).toBeNull();
	});
	it("maps a scope to the query keys to refetch", () => {
		expect(keysForScope("folders", "m")).toEqual([["folders", "m"], ["labels", "m"]]);
		expect(keysForScope("emails", "m")).toContainEqual(["emails", "m"]);
		expect(keysForScope("emails", "m")).toContainEqual(["folders", "m"]);
		expect(keysForScope("all", "m")).toContainEqual(["scheduled", "m"]);
	});
	it("backs off exponentially, capped, with jitter", () => {
		const mid = () => 0.5;
		expect(backoffDelay(0, mid)).toBe(1000);
		expect(backoffDelay(1, mid)).toBe(2000);
		expect(backoffDelay(3, mid)).toBe(8000);
		expect(backoffDelay(20, mid)).toBe(30_000);
		expect(backoffDelay(2, () => 0)).toBe(3000);
		expect(backoffDelay(2, () => 1)).toBe(5000);
	});
});
