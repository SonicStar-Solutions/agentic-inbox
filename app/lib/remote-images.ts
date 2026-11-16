// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Helpers for blocking remote images in rendered email (#88).
 *
 * Remote images are tracking pixels waiting to happen: loading one tells the
 * sender that (and when, and from where) the message was opened. They are
 * blocked by default; the reader can show them once, or always for a sender.
 */

const REMOTE_URL = /^\s*(?:https?:)?\/\//i;

/** Count distinct remote (http/https/protocol-relative) image URLs in HTML. */
export function countRemoteImages(html: string): number {
	if (!html) return 0;
	const urls = new Set<string>();

	// <img src>, <img srcset>, <input src>, <video poster>, background= attributes
	const attr = /\b(?:src|poster|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
	for (const m of html.matchAll(attr)) {
		const url = (m[1] ?? m[2] ?? m[3] ?? "").trim();
		if (REMOTE_URL.test(url)) urls.add(url);
	}
	const srcset = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
	for (const m of html.matchAll(srcset)) {
		for (const part of (m[1] ?? m[2] ?? "").split(",")) {
			const url = part.trim().split(/\s+/)[0];
			if (url && REMOTE_URL.test(url)) urls.add(url);
		}
	}
	// CSS url(...) in style attributes or <style> blocks
	const css = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
	for (const m of html.matchAll(css)) {
		const url = (m[1] ?? m[2] ?? m[3] ?? "").trim();
		if (REMOTE_URL.test(url)) urls.add(url);
	}
	return urls.size;
}

/** Extract the bare lowercase address from "Name <a@b.c>" or "a@b.c". */
export function senderAddress(from: string | null | undefined): string {
	if (!from) return "";
	const m = from.match(/<([^>]+)>/);
	return (m ? m[1] : from).trim().toLowerCase();
}

// ── Per-sender allow-list (stored in the browser) ───────────────────

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const keyFor = (mailboxId: string) => `agentic-inbox:image-allow:${mailboxId}`;

export function loadAllowedSenders(storage: StorageLike | undefined, mailboxId: string): string[] {
	try {
		const raw = storage?.getItem(keyFor(mailboxId));
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
	} catch {
		return [];
	}
}

export function isSenderAllowed(storage: StorageLike | undefined, mailboxId: string, sender: string): boolean {
	const addr = senderAddress(sender);
	return !!addr && loadAllowedSenders(storage, mailboxId).includes(addr);
}

export function addAllowedSender(storage: StorageLike | undefined, mailboxId: string, sender: string): void {
	const addr = senderAddress(sender);
	if (!addr) return;
	try {
		const list = loadAllowedSenders(storage, mailboxId);
		if (!list.includes(addr)) storage?.setItem(keyFor(mailboxId), JSON.stringify([...list, addr].slice(-500)));
	} catch {
		// storage unavailable (private mode): the choice just lasts for this view
	}
}
