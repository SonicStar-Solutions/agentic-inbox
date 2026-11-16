// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Parse the DOMAINS var: one domain, or several separated by commas
 * ("example.com,example.org"). Lowercased, trimmed, de-duplicated.
 */
export function parseDomains(raw: string | undefined | null): string[] {
	const out: string[] = [];
	for (const part of (raw ?? "").split(",")) {
		const d = part.trim().toLowerCase();
		if (d && !out.includes(d)) out.push(d);
	}
	return out;
}

/**
 * Whether an email address belongs to one of the configured domains.
 * When no domains are configured everything is allowed (local development).
 */
export function isAllowedDomain(email: string, domains: string[]): boolean {
	if (domains.length === 0) return true;
	const domain = email.split("@")[1]?.toLowerCase();
	return !!domain && domains.includes(domain);
}
