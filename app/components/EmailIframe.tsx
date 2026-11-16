// Copyright (c) 2026 Cloudflare, Inc.
// Modifications Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog } from "@cloudflare/kumo";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "~/hooks/useTheme";
import { buildEmailSrcdoc, linkLooksDeceptive } from "~/lib/email-srcdoc";

interface EmailIframeProps {
	body: string;
	/** When true, iframe auto-sizes to content height instead of filling parent */
	autoSize?: boolean;
	/** Load remote (http/https) images. Blocked by default to stop tracking pixels. */
	allowRemoteImages?: boolean;
}

/**
 * Renders email HTML inside a sandboxed iframe.
 *
 * Security model:
 * - DOMPurify sanitises the HTML before injection.
 * - The iframe sandbox does NOT include `allow-same-origin`, so even if
 *   DOMPurify has a bypass the attacker's code runs in an opaque origin
 *   with no access to the parent page's cookies, DOM, or API.
 * - Because the iframe is cross-origin we cannot read `contentDocument`.
 *   Instead a tiny inline script in the document posts its body height and
 *   link clicks to the parent via `postMessage`. `allow-scripts` is required
 *   for this, but scripts in the opaque-origin sandbox can't reach anything.
 * - A strict CSP meta tag blocks external resource loads inside the iframe
 *   (remote images only when the reader allows them) as defence in depth.
 * - Link clicks are intercepted: links whose text claims a different address
 *   than their real destination ask for confirmation first (#89).
 *
 * The sender's own <style> blocks are kept so newsletters keep their layout.
 */
export default function EmailIframe({ body, autoSize, allowRemoteImages = false }: EmailIframeProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(autoSize ? 100 : 0);
	const [pendingLink, setPendingLink] = useState<{ href: string; text: string } | null>(null);
	const dark = useTheme((s) => s.resolved) === "dark";

	const openLink = useCallback((href: string) => {
		if (/^mailto:/i.test(href)) {
			window.location.href = href;
		} else if (/^https?:/i.test(href)) {
			window.open(href, "_blank", "noopener,noreferrer");
		}
	}, []);

	// Listen for height reports and link clicks from the sandboxed iframe
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			// Only accept messages from our own iframe
			if (event.source !== iframeRef.current?.contentWindow) return;
			const data = event.data;
			if (!data || typeof data !== "object") return;

			if (autoSize && data.__emailIframeHeight && typeof data.height === "number" && data.height > 0) {
				setHeight(data.height);
			} else if (data.__emailLink && typeof data.href === "string") {
				const text = typeof data.text === "string" ? data.text : "";
				if (linkLooksDeceptive(text, data.href)) setPendingLink({ href: data.href, text });
				else openLink(data.href);
			}
		},
		[autoSize, openLink],
	);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [handleMessage]);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe || !body) return;
		// srcdoc keeps the iframe truly sandboxed (no same-origin access).
		iframe.srcdoc = buildEmailSrcdoc({ body, autoSize, allowRemoteImages, dark });
	}, [body, autoSize, allowRemoteImages, dark]);

	let pendingHost = "";
	try {
		pendingHost = pendingLink ? new URL(pendingLink.href).hostname : "";
	} catch {
		// leave blank
	}

	return (
		<>
			<iframe
				ref={iframeRef}
				className="block w-full border-0"
				style={autoSize ? { height: `${height}px` } : { height: "100%" }}
				sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation"
				title="Email content"
			/>
			<Dialog.Root open={pendingLink !== null} onOpenChange={(open) => !open && setPendingLink(null)}>
				<Dialog size="lg">
					<Dialog.Title>This link may not go where it says</Dialog.Title>
					{pendingLink && (
						<div className="mt-3 space-y-3 text-sm">
							<div>
								<div className="text-kumo-subtle text-xs mb-0.5">The link says</div>
								<div className="text-kumo-default break-all">{pendingLink.text.trim()}</div>
							</div>
							<div>
								<div className="text-kumo-subtle text-xs mb-0.5">It actually opens</div>
								<div className="text-kumo-default break-all font-mono">
									<strong>{pendingHost}</strong>
									<span className="text-kumo-subtle"> {pendingLink.href.replace(/^https?:\/\/[^/]+/i, "")}</span>
								</div>
							</div>
						</div>
					)}
					<div className="flex justify-end gap-2 mt-5">
						<Dialog.Close>
							<Button variant="secondary" size="sm">
								Cancel
							</Button>
						</Dialog.Close>
						<Button
							variant="primary"
							size="sm"
							onClick={() => {
								if (pendingLink) openLink(pendingLink.href);
								setPendingLink(null);
							}}
						>
							Open anyway
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</>
	);
}
