// @vitest-environment jsdom
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { buildEmailSrcdoc, foldQuotedText, linkLooksDeceptive, sanitizeEmailCss } from "./email-srcdoc";

const parse = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

describe("sanitizeEmailCss (#89)", () => {
	it("drops @import, expression(), behavior and javascript: but keeps normal rules", () => {
		const css = `@import url(https://evil.example/x.css); p{color:red; width:expression(alert(1)); behavior:url(x.htc); background:url(javascript:alert(1))} h1{margin:0}`;
		const out = sanitizeEmailCss(css);
		expect(out).not.toMatch(/@import|expression|behavior|javascript:/i);
		expect(out).toContain("p{color:red");
		expect(out).toContain("h1{margin:0}");
	});
});

describe("linkLooksDeceptive (#89)", () => {
	it("flags text that names a different host than the real destination", () => {
		expect(linkLooksDeceptive("https://paypal.com/login", "https://paypa1-secure.example/login")).toBe(true);
		expect(linkLooksDeceptive("www.mybank.com", "https://evil.example/")).toBe(true);
	});
	it("does not flag matching hosts, ordinary text or www differences", () => {
		expect(linkLooksDeceptive("https://example.com/a", "https://www.example.com/b")).toBe(false);
		expect(linkLooksDeceptive("Click here", "https://example.com")).toBe(false);
		expect(linkLooksDeceptive("Read the docs", "https://docs.example.com")).toBe(false);
	});
	it("flags punycode look-alike hosts", () => {
		expect(linkLooksDeceptive("Sign in", "https://xn--pple-43d.com/")).toBe(true);
	});
	it("ignores non-http hrefs", () => {
		expect(linkLooksDeceptive("a@b.co", "mailto:a@b.co")).toBe(false);
	});
});

describe("foldQuotedText (#89)", () => {
	it("wraps the outermost quote in a details toggle", () => {
		const doc = parse(`<p>Thanks!</p><blockquote>old<blockquote>older</blockquote></blockquote>`);
		expect(foldQuotedText(doc)).toBe(1);
		expect(doc.querySelectorAll("details.ai-quote")).toHaveLength(1);
		expect(doc.querySelector("details > summary")?.textContent).toBe("Show quoted text");
		expect(doc.querySelector("details blockquote blockquote")).not.toBeNull();
	});
	it("leaves a message that is only a quote alone", () => {
		const doc = parse(`<blockquote>forwarded text only</blockquote>`);
		expect(foldQuotedText(doc)).toBe(0);
		expect(doc.querySelector("details")).toBeNull();
	});
	it("handles Gmail-style quote containers", () => {
		const doc = parse(`<div>hello</div><div class="gmail_quote">On Mon, A wrote:<blockquote>x</blockquote></div>`);
		expect(foldQuotedText(doc)).toBe(1);
	});
});

describe("buildEmailSrcdoc", () => {
	it("keeps <style> blocks (sanitised) and strips scripts", () => {
		const html = buildEmailSrcdoc({ body: `<style>.x{color:red}@import url(//e.example/a.css);</style><p class="x">hi</p><script>alert(1)</script>` });
		expect(html).toContain(".x{color:red}");
		expect(html).not.toContain("@import url(//e.example");
		expect(html).not.toContain("alert(1)");
	});
	it("blocks remote images in the CSP unless allowed", () => {
		expect(buildEmailSrcdoc({ body: "<p>x</p>" })).toContain("img-src data: cid:;");
		expect(buildEmailSrcdoc({ body: "<p>x</p>", allowRemoteImages: true })).toContain("img-src data: cid: https: http:;");
	});
	it("opens links in a new tab with their destination as the tooltip", () => {
		const html = buildEmailSrcdoc({ body: `<a href="https://example.com/x">go</a>` });
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('title="https://example.com/x"');
	});
	it("inverts colours only in dark mode", () => {
		expect(buildEmailSrcdoc({ body: "<p>x</p>" })).not.toContain("invert(1)");
		expect(buildEmailSrcdoc({ body: "<p>x</p>", dark: true })).toContain("invert(1) hue-rotate(180deg)");
	});
});
