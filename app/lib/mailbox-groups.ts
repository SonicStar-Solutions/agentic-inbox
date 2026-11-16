// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Groups the mailbox picker by domain, as in the Airmail mailbox screen. */

export interface MailboxGroup<T> {
	/** Lower-cased domain, e.g. "example.com". */
	domain: string;
	items: T[];
}

export function domainOf(email: string): string {
	const at = email.lastIndexOf("@");
	return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

/**
 * One group per domain, items in their original order. Domains named in `preferredOrder` (the
 * configured ones) come first in that order; any others follow alphabetically.
 */
export function groupByDomain<T extends { email: string }>(items: T[], preferredOrder: string[] = []): MailboxGroup<T>[] {
	const byDomain = new Map<string, T[]>();
	for (const item of items) {
		const domain = domainOf(item.email);
		const list = byDomain.get(domain);
		if (list) list.push(item);
		else byDomain.set(domain, [item]);
	}
	const preferred = preferredOrder.map((d) => d.toLowerCase());
	const rank = (d: string) => {
		const i = preferred.indexOf(d);
		return i === -1 ? Number.MAX_SAFE_INTEGER : i;
	};
	return [...byDomain.entries()]
		.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
		.map(([domain, list]) => ({ domain, items: list }));
}

/** Name a mailbox is shown by: the From name, else a distinct stored name, else the address's local part. */
export function mailboxDisplayName(m: { email: string; name?: string; fromName?: string; settings?: { fromName?: string } }): string {
	const from = (m.settings?.fromName ?? m.fromName)?.trim();
	if (from) return from;
	const name = m.name?.trim();
	if (name && name.toLowerCase() !== m.email.toLowerCase()) return name;
	return m.email.split("@")[0] || m.email;
}
