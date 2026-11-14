// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import type { z } from "zod";

export type ParsedBody<T> =
	| { ok: true; data: T }
	| { ok: false; response: Response };

/**
 * Parse and validate a JSON request body.
 *
 * Malformed JSON or a body that fails the schema yields a 400 response
 * instead of an uncaught exception (which Hono would surface as a 500).
 *
 * Usage:
 *   const parsed = await parseJsonBody(c, Schema);
 *   if (!parsed.ok) return parsed.response;
 *   const body = parsed.data;
 */
export async function parseJsonBody<S extends z.ZodTypeAny>(
	c: Context,
	schema: S,
): Promise<ParsedBody<z.infer<S>>> {
	const raw = await c.req.json().catch(() => undefined);
	if (raw === undefined) {
		return { ok: false, response: c.json({ error: "Invalid JSON body" }, 400) };
	}
	const result = schema.safeParse(raw);
	if (!result.success) {
		return {
			ok: false,
			response: c.json(
				{ error: "Invalid request body", details: result.error.flatten() },
				400,
			),
		};
	}
	return { ok: true, data: result.data };
}
