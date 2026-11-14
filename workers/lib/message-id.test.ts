// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";
import { normalizeMessageId } from "./send";

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("normalizeMessageId", () => {
	it("strips angle brackets and whitespace", () => {
		expect(normalizeMessageId(" <abc@example.com> ")).toBe("abc@example.com");
		expect(normalizeMessageId("abc@example.com")).toBe("abc@example.com");
	});
	it("returns null for empty or non-string values", () => {
		expect(normalizeMessageId("")).toBeNull();
		expect(normalizeMessageId("  ")).toBeNull();
		expect(normalizeMessageId(undefined)).toBeNull();
		expect(normalizeMessageId(42)).toBeNull();
	});
});

describe("sent messages store the provider's Message-ID (#83)", () => {
	const compose = { to: "dave@example.net", from: "alice@example.com", subject: "Hi", text: "hello" };

	it("compose stores the Message-ID returned by the binding", async () => {
		const { env, stubs } = makeFakeEnv({
			sendImpl: async () => ({ messageId: "<assigned-by-provider@example.com>" }),
		});
		const { ctx } = fakeExecutionCtx();
		const res = await app.request("/api/v1/mailboxes/alice@example.com/emails", jsonPost(compose), env, ctx);
		expect(res.status).toBe(202);

		const row = stubs["alice@example.com"].rows[0].email;
		expect(row.message_id).toBe("assigned-by-provider@example.com");
		const headers = JSON.parse(row.raw_headers) as { key: string; value: string }[];
		expect(headers.find((h) => h.key === "message-id")?.value).toBe("<assigned-by-provider@example.com>");
	});

	it("falls back to the generated id when the provider returns none", async () => {
		const { env, stubs } = makeFakeEnv({ sendImpl: async () => ({ messageId: "" }) });
		const { ctx } = fakeExecutionCtx();
		await app.request("/api/v1/mailboxes/alice@example.com/emails", jsonPost(compose), env, ctx);
		expect(stubs["alice@example.com"].rows[0].email.message_id).toMatch(/@example\.com$/);
	});

	it("reply and forward store the provider's Message-ID", async () => {
		for (const action of ["reply", "forward"] as const) {
			const { env, stubs } = makeFakeEnv({
				sendImpl: async () => ({ messageId: `<${action}-id@example.com>` }),
			});
			const stub = (stubs["alice@example.com"] = makeFakeMailboxStub());
			await stub.createEmail("inbox", { id: "orig", message_id: "m1@example.net", thread_id: "orig", sender: "dave@example.net" });
			const { ctx } = fakeExecutionCtx();
			const res = await app.request(
				`/api/v1/mailboxes/alice@example.com/emails/orig/${action}`,
				jsonPost(compose),
				env,
				ctx,
			);
			expect(res.status).toBe(202);
			const sentRow = stub.rows.find((r) => r.folder === "sent")!;
			expect(sentRow.email.message_id).toBe(`${action}-id@example.com`);
		}
	});
});
