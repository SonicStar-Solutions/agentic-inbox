// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv } from "../test-utils";

describe("write routes return 400 for bad input (#16)", () => {
	const routes = [
		"/api/v1/mailboxes",
		"/api/v1/mailboxes/alice@example.com/emails",
		"/api/v1/mailboxes/alice@example.com/drafts",
		"/api/v1/mailboxes/alice@example.com/emails/some-id/reply",
		"/api/v1/mailboxes/alice@example.com/emails/some-id/forward",
	];

	for (const path of routes) {
		it(`malformed JSON -> 400: ${path}`, async () => {
			const { env } = makeFakeEnv();
			const { ctx } = fakeExecutionCtx();
			const res = await app.request(path, jsonPost("{not json"), env, ctx);
			expect(res.status).toBe(400);
			expect((await res.json()) as any).toMatchObject({ error: expect.any(String) });
		});

		it(`schema violation -> 400: ${path}`, async () => {
			const { env } = makeFakeEnv();
			const { ctx } = fakeExecutionCtx();
			const res = await app.request(path, jsonPost({ nonsense: true }), env, ctx);
			expect(res.status).toBe(400);
		});
	}
});
