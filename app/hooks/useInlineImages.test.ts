// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { replaceCidWithDataUrls } from "./useInlineImages";

describe("replaceCidWithDataUrls (#88)", () => {
	it("replaces matching cid references and leaves the rest", () => {
		const html = `<img src="cid:logo@x"><img src="CID:LOGO@X"><img src="cid:other">`;
		expect(replaceCidWithDataUrls(html, { "logo@x": "data:image/png;base64,AAA" })).toBe(
			`<img src="data:image/png;base64,AAA"><img src="data:image/png;base64,AAA"><img src="cid:other">`,
		);
	});
	it("escapes regex characters in the content id", () => {
		expect(replaceCidWithDataUrls(`<img src="cid:a.b+c">`, { "a.b+c": "data:x" })).toBe(`<img src="data:x">`);
	});
});
