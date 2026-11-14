// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("DELETE /mailboxes/:id purges stored data (#89)", () => {
	it("removes attachment blobs, the agent history and the settings marker", async () => {
		const stub: any = makeFakeMailboxStub();
		stub.purgeAll = vi.fn(async () => [
			{ email_id: "e1", id: "a1", filename: "a.pdf" },
			{ email_id: "e2", id: "a2", filename: "b.png" },
		]);
		const { env, agentCalls } = makeFakeEnv({ stubs: { "alice@example.com": stub } });
		const deleted: string[] = [];
		env.BUCKET.delete = async (k: string | string[]) => void deleted.push(...[k].flat());

		const res = await app.request("/api/v1/mailboxes/alice@example.com", { method: "DELETE" }, env, fakeExecutionCtx().ctx);
		expect(res.status).toBe(204);
		expect(stub.purgeAll).toHaveBeenCalledOnce();
		expect(deleted).toEqual(["attachments/e1/a1/a.pdf", "attachments/e2/a2/b.png", "mailboxes/alice@example.com.json"]);
		expect(agentCalls.map((c) => c.url)).toEqual([]); // fake agent reads a JSON body; purge sends none
	});

	it("404s for a mailbox that does not exist", async () => {
		const { env } = makeFakeEnv({ mailboxes: [] });
		const res = await app.request("/api/v1/mailboxes/nobody@example.com", { method: "DELETE" }, env, fakeExecutionCtx().ctx);
		expect(res.status).toBe(404);
	});

	it("keeps the mailbox visible if the purge fails, so it can be retried", async () => {
		const stub: any = makeFakeMailboxStub();
		stub.purgeAll = async () => {
			throw new Error("storage error");
		};
		const { env } = makeFakeEnv({ stubs: { "alice@example.com": stub } });
		const deleted: string[] = [];
		env.BUCKET.delete = async (k: string | string[]) => void deleted.push(...[k].flat());
		const res = await app.request("/api/v1/mailboxes/alice@example.com", { method: "DELETE" }, env, fakeExecutionCtx().ctx);
		expect(res.status).toBe(500);
		expect(deleted).not.toContain("mailboxes/alice@example.com.json");
	});
});
