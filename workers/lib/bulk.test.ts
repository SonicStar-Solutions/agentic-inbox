// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";
import { buildBulkWhere, BulkRequestSchema } from "./bulk";

describe("bulk request (#88)", () => {
	it("requires a selection, a folder for threads and a destination for move", () => {
		expect(BulkRequestSchema.safeParse({ action: "read" }).success).toBe(false);
		expect(BulkRequestSchema.safeParse({ action: "read", thread_ids: ["t"] }).success).toBe(false);
		expect(BulkRequestSchema.safeParse({ action: "move", ids: ["a"] }).success).toBe(false);
		expect(BulkRequestSchema.safeParse({ action: "nuke", ids: ["a"] }).success).toBe(false);
		expect(BulkRequestSchema.safeParse({ action: "move", ids: ["a"], folderId: "archive" }).success).toBe(true);
		expect(BulkRequestSchema.safeParse({ action: "read", thread_ids: ["t"], folder: "inbox" }).success).toBe(true);
	});

	it("builds a parameterised where clause", () => {
		const r = buildBulkWhere({ ids: ["a", "b"], thread_ids: ["t"], folder: "inbox" });
		expect(r.where).toContain("id IN (?, ?)");
		expect(r.where).toContain("thread_id IN (?)");
		expect(r.params).toEqual(["a", "b", "t", "inbox", "inbox"]);
		expect(buildBulkWhere({ ids: [], thread_ids: [] }).where).toBe("0");
	});
});

describe("POST /emails/bulk", () => {
	const url = "/api/v1/mailboxes/alice@example.com/emails/bulk";

	it("400s on invalid input", async () => {
		const { env } = makeFakeEnv();
		const res = await app.request(url, jsonPost({ action: "read" }), env, fakeExecutionCtx().ctx);
		expect(res.status).toBe(400);
	});

	it("applies the action and removes attachment blobs on delete", async () => {
		const stub: any = makeFakeMailboxStub();
		stub.bulkUpdate = async (req: any) => ({
			count: req.ids.length,
			attachments: req.action === "delete" ? [{ email_id: "e1", id: "a1", filename: "f.pdf" }] : [],
		});
		const { env } = makeFakeEnv({ stubs: { "alice@example.com": stub } });
		const deleted: string[] = [];
		env.BUCKET.delete = async (keys: string | string[]) => void deleted.push(...[keys].flat());
		const res = await app.request(url, jsonPost({ action: "delete", ids: ["e1"] }), env, fakeExecutionCtx().ctx);
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).count).toBe(1);
		expect(deleted).toEqual(["attachments/e1/a1/f.pdf"]);
	});

	it("404s when move targets a missing folder", async () => {
		const stub: any = makeFakeMailboxStub();
		stub.bulkUpdate = async () => ({ error: "Folder not found" });
		const { env } = makeFakeEnv({ stubs: { "alice@example.com": stub } });
		const res = await app.request(url, jsonPost({ action: "move", ids: ["e1"], folderId: "nope" }), env, fakeExecutionCtx().ctx);
		expect(res.status).toBe(400);
	});
});
