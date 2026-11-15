// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Modified UTF-7 (RFC 3501 section 5.1.3), the encoding IMAP uses for mailbox
 * names with non-ASCII characters. "Entwürfe" travels as "Entw&APw-rfe".
 */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+,";

function base64ToBytes(b64: string): Uint8Array {
	const out: number[] = [];
	let bits = 0;
	let acc = 0;
	for (const ch of b64) {
		const v = B64.indexOf(ch);
		if (v < 0) continue;
		acc = (acc << 6) | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out.push((acc >> bits) & 0xff);
		}
	}
	return Uint8Array.from(out);
}

function bytesToBase64(bytes: Uint8Array): string {
	let out = "";
	let acc = 0;
	let bits = 0;
	for (const b of bytes) {
		acc = (acc << 8) | b;
		bits += 8;
		while (bits >= 6) {
			bits -= 6;
			out += B64[(acc >> bits) & 0x3f];
		}
	}
	if (bits > 0) out += B64[(acc << (6 - bits)) & 0x3f];
	return out;
}

/** Decode a mailbox name from modified UTF-7. Malformed input is returned as-is. */
export function decodeMailboxName(name: string): string {
	if (!name.includes("&")) return name;
	return name.replace(/&([^-]*)-/g, (_m, inner: string) => {
		if (inner === "") return "&";
		const bytes = base64ToBytes(inner);
		let s = "";
		for (let i = 0; i + 1 < bytes.length; i += 2) {
			s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
		}
		return s;
	});
}

/** Encode a mailbox name into modified UTF-7. */
export function encodeMailboxName(name: string): string {
	let out = "";
	let pending = "";
	const flush = () => {
		if (!pending) return;
		const bytes = new Uint8Array(pending.length * 2);
		for (let i = 0; i < pending.length; i++) {
			const c = pending.charCodeAt(i);
			bytes[i * 2] = c >> 8;
			bytes[i * 2 + 1] = c & 0xff;
		}
		out += `&${bytesToBase64(bytes)}-`;
		pending = "";
	};
	for (const ch of name) {
		const code = ch.codePointAt(0)!;
		if (code >= 0x20 && code <= 0x7e) {
			flush();
			out += ch === "&" ? "&-" : ch;
		} else {
			pending += ch;
		}
	}
	flush();
	return out;
}
