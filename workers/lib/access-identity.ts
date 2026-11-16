// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The signed-in user's email from the Cloudflare Access JWT, for audit logs.
 *
 * The app's Access middleware has already verified the token's signature before
 * a request reaches a route, so this only reads the payload. It is only used to
 * record who did something, never to decide what they may do. Returns null when
 * there is no token (local development).
 */
export function accessEmail(req: Request): string | null {
	const token = req.headers.get("cf-access-jwt-assertion");
	if (!token) return null;
	try {
		const payload = token.split(".")[1];
		if (!payload) return null;
		const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="));
		const email = JSON.parse(json)?.email;
		return typeof email === "string" ? email.slice(0, 320) : null;
	} catch {
		return null;
	}
}
