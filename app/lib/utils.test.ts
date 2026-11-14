// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, escapeHtml, getSnippetText, stripHtml } from "./utils";

describe("stripHtml decodes entities (#86)", () => {
	it("shows < and > instead of &lt; and &gt; in an attribution line", () => {
		expect(stripHtml("<div>Dave &lt;dave@example.net&gt; wrote:</div>")).toBe("Dave <dave@example.net> wrote:");
	});

	it("does not double-decode an escaped entity", () => {
		expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
		expect(stripHtml("<p>a &amp;lt; b</p>")).toBe("a &lt; b");
	});

	it("drops <style> and <script> content", () => {
		expect(stripHtml("<style>p{color:red}</style><p>Hello</p><script>alert(1)</script>")).toBe("Hello");
	});

	it("handles numeric entities, nbsp and invalid code points", () => {
		expect(stripHtml("caf&#233; &#x1F600; a&nbsp;b &#99999999;")).toBe("café 😀 a b");
	});

	it("is safe to re-escape for quoting in a reply", () => {
		expect(escapeHtml(stripHtml("&lt;script&gt;x&lt;/script&gt;"))).toBe("&lt;script&gt;x&lt;/script&gt;");
	});
});

describe("getSnippetText", () => {
	it("decodes entities and truncates", () => {
		expect(getSnippetText("<p>Name &lt;a@b.c&gt; wrote: hello</p>", 100)).toBe("Name <a@b.c> wrote: hello");
		expect(getSnippetText("x".repeat(20), 10)).toBe("xxxxxxxxxx...");
	});
});
