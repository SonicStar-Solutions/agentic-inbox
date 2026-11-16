// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Checks on the host and port a user asks the Worker to connect to for an
 * import. The Worker opens an outbound socket on the user's behalf, so refuse
 * anything that is not an ordinary public mail hostname.
 *
 * Workers cannot reach private networks or Cloudflare's own addresses, and we
 * cannot resolve DNS here, so this is a first line of defence against obvious
 * misuse (IP literals, local names, odd ports), not a complete SSRF filter.
 */

export const DEFAULT_ALLOWED_PORTS = [993, 143];

const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home.arpa", ".corp", ".intranet", ".private", ".test", ".invalid", ".example"];

export type HostCheck = { ok: true; host: string; port: number } | { ok: false; error: string };

/** Parse the optional IMPORT_ALLOWED_PORTS variable ("993,143,1993"). */
export function allowedPorts(raw?: string | null): number[] {
	if (!raw) return DEFAULT_ALLOWED_PORTS;
	const ports = raw
		.split(",")
		.map((p) => Number(p.trim()))
		.filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
	return ports.length ? ports : DEFAULT_ALLOWED_PORTS;
}

export function validateImapHost(hostInput: string, port: number, allowedPortsRaw?: string | null): HostCheck {
	const host = hostInput.trim().toLowerCase().replace(/\.$/, "");
	if (!host) return { ok: false, error: "Enter the IMAP server name." };
	if (host.length > 253) return { ok: false, error: "That server name is too long." };
	if (host.startsWith("[") || host.includes(":")) return { ok: false, error: "Use a server name, not an IP address." };
	if (/^[0-9.]+$/.test(host)) return { ok: false, error: "Use a server name, not an IP address." };
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
		return { ok: false, error: "That does not look like a valid server name." };
	}
	if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
		return { ok: false, error: "That server name is not a public mail server." };
	}
	// Numeric-looking last label (e.g. 1.2.3.4a) is never a real TLD.
	const tld = host.split(".").pop()!;
	if (/^[0-9]+$/.test(tld)) return { ok: false, error: "That does not look like a valid server name." };

	const ports = allowedPorts(allowedPortsRaw);
	if (!Number.isInteger(port) || !ports.includes(port)) {
		return { ok: false, error: `Port ${port} is not allowed. Use ${ports.join(" or ")}.` };
	}
	return { ok: true, host, port };
}
