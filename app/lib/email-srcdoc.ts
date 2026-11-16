// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Builds the sandboxed-iframe document for an email (#88, #89).
 *
 * Browser-only (uses DOMPurify and DOMParser). The result is passed to the
 * iframe's `srcdoc`; the iframe has no `allow-same-origin`, so nothing in it can
 * reach the app's cookies or DOM.
 */
import DOMPurify from "dompurify";

// ── CSS ─────────────────────────────────────────────────────────────

/**
 * Remove the constructs in an email's own <style> that could load resources or
 * run code. Remote loads are additionally blocked by the iframe's CSP.
 */
export function sanitizeEmailCss(css: string): string {
	return css
		.replace(/@import[^;]*;?/gi, "")
		.replace(/expression\s*\([^)]*\)/gi, "")
		.replace(/(?:-moz-binding|behavior)\s*:[^;}]*/gi, "")
		.replace(/javascript\s*:/gi, "");
}

// ── Links ───────────────────────────────────────────────────────────

const looksLikeUrl = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;

function hostOf(url: string): string | null {
	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return null;
	}
}

/**
 * Whether a link's visible text pretends to be a different address than where
 * it really goes (the classic phishing trick), or the host is a punycode
 * look-alike. Only such links get a confirmation before opening.
 */
export function linkLooksDeceptive(text: string, href: string): boolean {
	const realHost = hostOf(href);
	if (!realHost) return false;
	if (realHost.split(".").some((label) => label.startsWith("xn--"))) return true;
	const shown = text.trim();
	if (!looksLikeUrl.test(shown)) return false;
	const shownHost = hostOf(/^https?:\/\//i.test(shown) ? shown : `https://${shown}`);
	return !!shownHost && shownHost !== realHost;
}

// ── Quoted text ─────────────────────────────────────────────────────

const QUOTE_SELECTOR = "blockquote, .gmail_quote, .yahoo_quoted, #divRplyFwdMsg";

/**
 * Collapse quoted reply history into a "show quoted text" toggle. Nested quotes
 * stay inside their outermost one, and a message that is nothing but a quote is
 * left alone.
 */
export function foldQuotedText(doc: Document): number {
	const quotes = Array.from(doc.body.querySelectorAll(QUOTE_SELECTOR)).filter(
		(el) => !el.parentElement?.closest(QUOTE_SELECTOR),
	);
	if (quotes.length === 0) return 0;

	const quotedText = quotes.reduce((n, el) => n + (el.textContent ?? "").trim().length, 0);
	const totalText = (doc.body.textContent ?? "").trim().length;
	if (totalText - quotedText <= 0) return 0;

	for (const quote of quotes) {
		const details = doc.createElement("details");
		details.className = "ai-quote";
		const summary = doc.createElement("summary");
		summary.textContent = "Show quoted text";
		// (appendChild/replaceChild: the Workers typings shadow Element.replaceWith/append)
		quote.parentNode?.replaceChild(details, quote);
		details.appendChild(summary);
		details.appendChild(quote);
	}
	return quotes.length;
}

// ── Document ────────────────────────────────────────────────────────

export interface SrcdocOptions {
	body: string;
	autoSize?: boolean;
	allowRemoteImages?: boolean;
	dark?: boolean;
}

export function buildEmailSrcdoc({ body, autoSize = false, allowRemoteImages = false, dark = false }: SrcdocOptions): string {
	// Keep the sender's <style> blocks (newsletters lose their layout without
	// them); they're neutralised below and confined by the CSP and the sandbox.
	const purified = DOMPurify.sanitize(body, {
		USE_PROFILES: { html: true },
		ADD_TAGS: ["style"],
		ADD_ATTR: ["target"],
		FORCE_BODY: true,
	});

	const doc = new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${purified}</body></html>`, "text/html");
	doc.querySelectorAll("style").forEach((style) => {
		style.textContent = sanitizeEmailCss(style.textContent ?? "");
	});
	doc.querySelectorAll("a[href]").forEach((a) => {
		a.setAttribute("target", "_blank");
		a.setAttribute("rel", "noopener noreferrer");
		if (!a.getAttribute("title")) a.setAttribute("title", a.getAttribute("href") ?? "");
	});
	foldQuotedText(doc);
	const cleanBody = doc.body.innerHTML;

	const padding = autoSize ? "0" : "24px";
	const imgSrc = `data: cid:${allowRemoteImages ? " https: http:" : ""}`;

	// Posts the body height (auto-size) and link clicks to the parent. Runs in the
	// opaque-origin sandbox, so it can only postMessage.
	const script = `<script>
	function reportHeight() {
		var h = document.body.scrollHeight;
		if (h > 0) parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
	}
	${autoSize ? "reportHeight(); setTimeout(reportHeight, 50); setTimeout(reportHeight, 150); setTimeout(reportHeight, 400);" : ""}
	document.addEventListener("toggle", function () { ${autoSize ? "reportHeight();" : ""} }, true);
	document.addEventListener("click", function (e) {
		var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
		if (!a) return;
		e.preventDefault();
		parent.postMessage({ __emailLink: true, href: a.href, text: a.textContent || "" }, "*");
	}, true);
<\/script>`;

	const darkCss = dark
		? `
html { filter: invert(1) hue-rotate(180deg); }
html, body { background: #e6e6e6; } /* inverts to the shell's dark grey rather than pure black */
img, video, picture, canvas, svg image, [style*="background-image"] { filter: invert(1) hue-rotate(180deg); }`
		: "";

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; script-src 'unsafe-inline';">
<style>
* { box-sizing: border-box; }
html {
	background: #ffffff;
	color-scheme: light;
}
body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 14px;
	line-height: 1.6;
	color: #1a1a1a;
	background: #ffffff;
	padding: ${padding};
	margin: 0;
	word-wrap: break-word;
	overflow-wrap: break-word;
	${autoSize ? "overflow: hidden;" : ""}
}
[style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
	position: relative !important;
}
a { color: #2563eb; }
img { max-width: 100%; height: auto; }
blockquote {
	border-left: 3px solid #d1d5db;
	padding-left: 1em;
	margin-left: 0;
	color: #6b7280;
}
pre {
	background: #f3f4f6;
	padding: 12px;
	border-radius: 6px;
	overflow-x: auto;
	font-size: 13px;
}
table { border-collapse: collapse; max-width: 100%; }
td, th { padding: 4px 8px; }
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { padding-left: 20px; margin: 4px 0; }
details.ai-quote { margin: 8px 0; }
details.ai-quote > summary {
	display: inline-block;
	cursor: pointer;
	padding: 0 8px;
	border-radius: 999px;
	background: #e5e7eb;
	color: #374151;
	font-size: 12px;
	line-height: 20px;
	list-style: none;
	user-select: none;
}
details.ai-quote > summary::-webkit-details-marker { display: none; }
details.ai-quote[open] > summary { margin-bottom: 8px; }${darkCss}
</style>
</head>
<body>${cleanBody}${script}</body>
</html>`;
}
