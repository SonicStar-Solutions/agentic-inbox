// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { BulkRequestSchema } from "../lib/bulk";
import { fakeExecutionCtx, jsonPost, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";

function setup() {
	const stub: any = makeFakeMailboxStub();
	stub.listLabels = vi.fn(async () => [{ id: "urgent", name: "Urgent", color: "red", count: 2 }]);
	stub.createLabel = vi.fn(async (name: string, color: string) => (name === "dup" ? { error: "A label with this name already exists" } : { id: name.toLowerCase(), name, color }));
	stub.updateLabel = vi.fn(async (id: string, patch: any) => (id === "missing" ? null : patch.name === "dup" ? { error: "exists" } : { id, name: patch.name ?? "Urgent", color: patch.color ?? "red" }));
	stub.deleteLabel = vi.fn(async (id: string) => id !== "missing");
	stub.withLabels = vi.fn(async (rows: any[]) => rows.map((r) => ({ ...r, labels: [] })));
	stub.getEmailsByLabel = vi.fn(async () => ({ emails: [{ id: "e1" }], totalCount: 1 }));
	return { stub, ...makeFakeEnv({ stubs: { "alice@example.com": stub } }) };
}
const call = (env: any, path: string, init?: RequestInit) =>
	app.request(`/api/v1/mailboxes/alice@example.com${path}`, init, env, fakeExecutionCtx().ctx);

describe("labels API (#89)", () => {
	it("lists and creates", async () => {
		const { env } = setup();
		expect(((await (await call(env, "/labels")).json()) as any).labels).toHaveLength(1);
		const created = await call(env, "/labels", jsonPost({ name: " Work ", color: "blue" }));
		expect(created.status).toBe(201);
		expect(((await created.json()) as any).name).toBe("Work");
	});
	it("rejects bad input and duplicates", async () => {
		const { env } = setup();
		expect((await call(env, "/labels", jsonPost({ name: "" }))).status).toBe(400);
		expect((await call(env, "/labels", jsonPost({ name: "x", color: "pink" }))).status).toBe(400);
		expect((await call(env, "/labels", jsonPost({ name: "dup" }))).status).toBe(409);
	});
	it("updates and deletes", async () => {
		const { env } = setup();
		expect((await call(env, "/labels/urgent", { ...jsonPost({ color: "green" }), method: "PUT" })).status).toBe(200);
		expect((await call(env, "/labels/missing", { ...jsonPost({ color: "green" }), method: "PUT" })).status).toBe(404);
		expect((await call(env, "/labels/urgent", { ...jsonPost({}), method: "PUT" })).status).toBe(400);
		expect((await call(env, "/labels/urgent", { method: "DELETE" })).status).toBe(204);
		expect((await call(env, "/labels/missing", { method: "DELETE" })).status).toBe(404);
	});
	it("filters the list by label and attaches labels to rows", async () => {
		const { env, stub } = setup();
		const res = await call(env, "/emails?label=urgent&page=1");
		expect(((await res.json()) as any).totalCount).toBe(1);
		expect(stub.getEmailsByLabel).toHaveBeenCalledWith("urgent", 1, undefined);
		expect(stub.withLabels).toHaveBeenCalled();
	});
	it("bulk label needs a labelId", () => {
		expect(BulkRequestSchema.safeParse({ action: "label", ids: ["a"] }).success).toBe(false);
		expect(BulkRequestSchema.safeParse({ action: "label", ids: ["a"], labelId: "urgent" }).success).toBe(true);
		expect(BulkRequestSchema.safeParse({ action: "unlabel", ids: ["a"], labelId: "urgent" }).success).toBe(true);
	});
});
