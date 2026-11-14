// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Helpers for a comma-separated recipient field with autocomplete (#88). */

/** The address being typed: the text after the last comma, trimmed. */
export function currentToken(value: string): string {
	const i = value.lastIndexOf(",");
	return (i >= 0 ? value.slice(i + 1) : value).trim();
}

/** Replace the token being typed with `address` and leave the cursor ready for the next one. */
export function applySuggestion(value: string, address: string): string {
	const i = value.lastIndexOf(",");
	const head = i >= 0 ? value.slice(0, i + 1).trimEnd() : "";
	return `${head}${head ? " " : ""}${address}, `;
}

/** Addresses already entered (everything before the token being typed). */
export function enteredAddresses(value: string): string[] {
	const i = value.lastIndexOf(",");
	if (i < 0) return [];
	return value
		.slice(0, i)
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}
