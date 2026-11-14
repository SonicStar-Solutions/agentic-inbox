// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Recipient suggestions for the composer (#88): distinct correspondents of a
 * mailbox, ranked by how often they appear (most frequent, then most recent).
 */

export interface ContactSource {
	sender?: string | null;
	recipient?: string | null;
	cc?: string | null;
	bcc?: string | null;
	date?: string | null;
}

export interface Contact {
	address: string;
	count: number;
	last: string;
}

const ADDRESS = /[^\s<>,;"'()]+@[^\s<>,;"'()]+\.[^\s<>,;"'()]+/g;

export function extractAddresses(field: string | null | undefined): string[] {
	if (!field) return [];
	return (field.match(ADDRESS) ?? []).map((a) => a.toLowerCase().replace(/[.]+$/, ""));
}

export function buildContacts(
	rows: ContactSource[],
	options: { self?: string; query?: string; limit?: number } = {},
): Contact[] {
	const self = options.self?.toLowerCase();
	const query = options.query?.trim().toLowerCase() ?? "";
	const limit = Math.min(Math.max(options.limit ?? 8, 1), 50);
	const byAddress = new Map<string, Contact>();

	for (const row of rows) {
		const date = row.date ?? "";
		const seen = new Set<string>();
		for (const field of [row.sender, row.recipient, row.cc, row.bcc]) {
			for (const address of extractAddresses(field)) seen.add(address);
		}
		for (const address of seen) {
			if (address === self) continue;
			const existing = byAddress.get(address);
			if (existing) {
				existing.count += 1;
				if (date > existing.last) existing.last = date;
			} else {
				byAddress.set(address, { address, count: 1, last: date });
			}
		}
	}

	return [...byAddress.values()]
		.filter((c) => !query || c.address.includes(query))
		.sort((a, b) => {
			// Prefix matches first, then frequency, then recency.
			const ap = query && a.address.startsWith(query) ? 0 : 1;
			const bp = query && b.address.startsWith(query) ? 0 : 1;
			return ap - bp || b.count - a.count || (b.last > a.last ? 1 : b.last < a.last ? -1 : 0) || a.address.localeCompare(b.address);
		})
		.slice(0, limit);
}
