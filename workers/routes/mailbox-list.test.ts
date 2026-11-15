// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, makeFakeEnv } from "../test-utils";

const get = (env: any) => app.request("/api/v1/mailboxes", {}, env, fakeExecutionCtx().ctx);

describe("GET /mailboxes", () => {
	it("includes each mailbox's configured display name", async () => {
		const { env, objects } = makeFakeEnv({ mailboxes: ["alice@example.com", "bob@example.com"] });
		objects.set("mailboxes/alice@example.com.json", { fromName: "Alice Chen" });
		objects.set("mailboxes/bob@example.com.json", JSON.stringify({ fromName: "Bob" }));

		const body = (await (await get(env)).json()) as any[];

		expect(body.map((m) => [m.id, m.fromName])).toEqual([
			["alice@example.com", "Alice Chen"],
			["bob@example.com", "Bob"],
		]);
	});

	it("sends null when no display name is set or the settings are unreadable", async () => {
		const { env, objects } = makeFakeEnv({ mailboxes: ["alice@example.com", "bob@example.com", "cy@example.com"] });
		objects.set("mailboxes/alice@example.com.json", { signature: { enabled: false } });
		objects.set("mailboxes/bob@example.com.json", "{not json");
		objects.set("mailboxes/cy@example.com.json", { fromName: "   " });

		const body = (await (await get(env)).json()) as any[];

		expect(body.map((m) => m.fromName)).toEqual([null, null, null]);
	});

	it("keeps id, email and name as before", async () => {
		const { env } = makeFakeEnv({ mailboxes: ["alice@example.com"] });
		const body = (await (await get(env)).json()) as any[];
		expect(body[0]).toMatchObject({ id: "alice@example.com", email: "alice@example.com", name: "alice@example.com" });
	});
});
