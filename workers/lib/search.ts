// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Durable Object SQLite rejects LIKE patterns longer than 50 bytes. Because
 * search wraps each term as `%term%`, a term must be at most 48 bytes to stay
 * within the limit.
 */
export const MAX_LIKE_TERM_BYTES = 48;

/** Longest search term accepted from a client (characters). */
export const MAX_SEARCH_TERM_LENGTH = 500;

const encoder = new TextEncoder();

/**
 * Split a search term into pieces of at most `maxBytes` UTF-8 bytes without
 * breaking a character. Callers AND the pieces together, so every piece must
 * match (not necessarily adjacent) instead of the whole term being truncated.
 */
export function splitLikeTerm(term: string, maxBytes = MAX_LIKE_TERM_BYTES): string[] {
	const chunks: string[] = [];
	let current = "";
	let currentBytes = 0;

	for (const ch of term) {
		const bytes = encoder.encode(ch).length;
		if (currentBytes + bytes > maxBytes && current) {
			chunks.push(current);
			current = "";
			currentBytes = 0;
		}
		current += ch;
		currentBytes += bytes;
	}
	if (current) chunks.push(current);
	return chunks;
}

/**
 * Return the name of the first over-long search parameter, or null if all are
 * acceptable. Used to answer 400 instead of building an enormous query.
 */
export function findOverlongSearchTerm(terms: Record<string, string | undefined>): string | null {
	for (const [name, value] of Object.entries(terms)) {
		if (value && value.length > MAX_SEARCH_TERM_LENGTH) return name;
	}
	return null;
}
