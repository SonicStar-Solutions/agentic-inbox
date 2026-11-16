// @vitest-environment jsdom
// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { getSignatureBlock } from "./utils";

describe("getSignatureBlock (#89)", () => {
	it("is empty when disabled or blank", () => {
		expect(getSignatureBlock(undefined)).toBe("");
		expect(getSignatureBlock({ signature: { enabled: false, text: "Bye" } })).toBe("");
		expect(getSignatureBlock({ signature: { enabled: true, text: "" } })).toBe("");
	});
	it("escapes plain text and keeps its line breaks", () => {
		const html = getSignatureBlock({ signature: { enabled: true, text: "Alex <alex@x.co>\nAcme" } });
		expect(html).toContain("Alex &lt;alex@x.co&gt;\nAcme");
		expect(html).toContain("white-space: pre-wrap");
	});
	it("sanitises an HTML signature", () => {
		const html = getSignatureBlock({ signature: { enabled: true, text: "", html: `<b>Alex</b><script>alert(1)</script>` } });
		expect(html).toContain("<b>Alex</b>");
		expect(html).not.toContain("script");
	});
});
