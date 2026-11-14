// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";

function setup() {
	const stub: any = makeFakeMailboxStub();
	stub.getFolders = async () => [
		{ id: "inbox", name: "Inbox" },
		{ id: "projects", name: "Projects" },
		{ id: "other", name: "Other" },
	];
	stub.updateFolder = async (id: string, name: string) => (id === "inbox" ? undefined : { id, name });
	return makeFakeEnv({ stubs: { "alice@example.com": stub } });
}
const rename = (env: any, id: string, name: unknown) =>
	app.request(`/api/v1/mailboxes/alice@example.com/folders/${id}`, { ...jsonPost({ name }), method: "PUT" }, env, fakeExecutionCtx().ctx);

describe("folder rename (#89)", () => {
	it("renames a custom folder, trimming the name", async () => {
		const { env } = setup();
		const res = await rename(env, "projects", "  Client Work ");
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).name).toBe("Client Work");
	});
	it("rejects blank names, duplicates (any case) and system folders", async () => {
		const { env } = setup();
		expect((await rename(env, "projects", "   ")).status).toBe(400);
		expect((await rename(env, "projects", "OTHER")).status).toBe(409);
		expect((await rename(env, "inbox", "Hacked")).status).toBe(404);
	});
	it("allows keeping the same name", async () => {
		const { env } = setup();
		expect((await rename(env, "projects", "projects")).status).toBe(200);
	});
});
