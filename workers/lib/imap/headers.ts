// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Reads the small header block the importer fetches before downloading a
 * message (Message-ID, Date, From, Subject) and turns it into the key used to
 * skip messages that were already imported.
 */

export interface SummaryHeaders {
	messageId: string | null;
	date: string | null;
	from: string | null;
	subject: string | null;
}

/** Parse "Name: value" lines, unfolding continuation lines. Names are lower-cased. */
function parseHeaderBlock(text: string): Map<string, string> {
	const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
	const out = new Map<string, string>();
	for (const line of unfolded.split(/\r?\n/)) {
		const i = line.indexOf(":");
		if (i <= 0) continue;
		const name = line.slice(0, i).trim().toLowerCase();
		if (!out.has(name)) out.set(name, line.slice(i + 1).trim());
	}
	return out;
}

export function parseSummaryHeaders(block: Uint8Array | string | null | undefined): SummaryHeaders {
	const text = typeof block === "string" ? block : block ? new TextDecoder().decode(block) : "";
	const h = parseHeaderBlock(text);
	const rawId = h.get("message-id") ?? "";
	const m = rawId.match(/<([^>]+)>/);
	return {
		messageId: m ? m[1] : rawId.trim() || null,
		date: h.get("date") ?? null,
		from: h.get("from") ?? null,
		subject: h.get("subject") ?? null,
	};
}

async function sha256Hex(input: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * The Message-ID that identifies this message in the mailbox. Real Message-IDs
 * are used as-is. A message without one gets a stable synthetic ID from its
 * Date, From, Subject and size, so importing it twice is still caught.
 * Returns null when there is no header block at all (nothing to identify it by).
 */
export async function importMessageKey(headers: SummaryHeaders, size: number, hadHeaders: boolean): Promise<string | null> {
	if (headers.messageId) return headers.messageId;
	if (!hadHeaders) return null;
	const digest = await sha256Hex([headers.date ?? "", headers.from ?? "", headers.subject ?? "", String(size)].join("\n"));
	return `import-${digest.slice(0, 32)}@import.invalid`;
}
