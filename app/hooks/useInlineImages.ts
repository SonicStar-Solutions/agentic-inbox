// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useMemo, useState } from "react";
import { getAttachmentUrl } from "~/lib/utils";

interface InlineAttachment {
	id: string;
	content_id?: string | null;
	disposition?: string | null;
	mimetype?: string;
	size?: number;
}

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_IMAGES = 25;

const bareCid = (cid: string) => (cid.startsWith("<") ? cid.slice(1, -1) : cid);

/** Replace `cid:` references with data: URLs for the ones in `resolved`. */
export function replaceCidWithDataUrls(body: string, resolved: Record<string, string>): string {
	let result = body;
	for (const [cid, dataUrl] of Object.entries(resolved)) {
		result = result.replace(
			new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi"),
			dataUrl,
		);
	}
	return result;
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

/**
 * Inline (`cid:`) images are attachments served by the API, which needs the
 * session cookie. The email renders in a sandboxed iframe that cannot send
 * cookies, so request them here and embed them as data: URLs instead (#88).
 */
export function useInlineImages(
	body: string,
	mailboxId: string,
	emailId: string,
	attachments?: InlineAttachment[],
): string {
	const [resolved, setResolved] = useState<Record<string, string>>({});

	const wanted = useMemo(
		() =>
			(attachments ?? [])
				.filter((a) => a.disposition === "inline" && a.content_id && (!a.mimetype || a.mimetype.startsWith("image/")))
				.map((a) => ({ id: a.id, cid: bareCid(a.content_id as string) }))
				.filter((a) => body.toLowerCase().includes(`cid:${a.cid.toLowerCase()}`))
				.slice(0, MAX_INLINE_IMAGES),
		[attachments, body],
	);

	useEffect(() => {
		if (wanted.length === 0) return;
		let cancelled = false;
		(async () => {
			const next: Record<string, string> = {};
			await Promise.all(
				wanted.map(async ({ id, cid }) => {
					try {
						const res = await fetch(getAttachmentUrl(mailboxId, emailId, id), { credentials: "same-origin" });
						if (!res.ok) return;
						const blob = await res.blob();
						if (blob.size > MAX_INLINE_IMAGE_BYTES) return;
						next[cid] = await blobToDataUrl(blob);
					} catch {
						// leave this image unresolved
					}
				}),
			);
			if (!cancelled) setResolved(next);
		})();
		return () => {
			cancelled = true;
		};
	}, [wanted, mailboxId, emailId]);

	return useMemo(() => replaceCidWithDataUrls(body, resolved), [body, resolved]);
}
