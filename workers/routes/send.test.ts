// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv } from "../test-utils";

const compose = {
	to: "dave@example.net",
	from: "alice@example.com",
	subject: "Hello",
	text: "hi dave",
};

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("compose: rejected sends are not reported as sent (#84)", () => {
	it("returns an error and files nothing in Sent when the binding rejects", async () => {
		const { env, stubs } = makeFakeEnv({
			sendImpl: async () => {
				throw new Error("email to dave@example.net not allowed");
			},
		});
		const { ctx } = fakeExecutionCtx();
		const res = await app.request("/api/v1/mailboxes/alice@example.com/emails", jsonPost(compose), env, ctx);

		expect(res.status).toBe(502);
		expect(((await res.json()) as any).error).toContain("not allowed");
		expect(stubs["alice@example.com"].rows).toHaveLength(0);
	});

	it("still sends and files in Sent when the binding accepts", async () => {
		const { env, stubs, sent } = makeFakeEnv();
		const { ctx } = fakeExecutionCtx();
		const res = await app.request("/api/v1/mailboxes/alice@example.com/emails", jsonPost(compose), env, ctx);

		expect(res.status).toBe(202);
		expect(((await res.json()) as any).status).toBe("sent");
		expect(sent).toHaveLength(1);
		const rows = stubs["alice@example.com"].rows;
		expect(rows).toHaveLength(1);
		expect(rows[0].folder).toBe("sent");
	});

	it("does not call the binding when rate limited", async () => {
		const { env, stubs, sent } = makeFakeEnv();
		stubs["alice@example.com"] = (await import("../test-utils")).makeFakeMailboxStub();
		stubs["alice@example.com"].rateLimit = "Rate limit exceeded";
		const { ctx } = fakeExecutionCtx();
		const res = await app.request("/api/v1/mailboxes/alice@example.com/emails", jsonPost(compose), env, ctx);

		expect(res.status).toBe(429);
		expect(sent).toHaveLength(0);
	});

	it("reply: rejected send is reported and not stored", async () => {
		const { env, stubs } = makeFakeEnv({
			sendImpl: async () => {
				throw new Error("rejected");
			},
		});
		const stub = (stubs["alice@example.com"] = (await import("../test-utils")).makeFakeMailboxStub());
		await stub.createEmail("inbox", { id: "orig-1", message_id: "m1@example.net", thread_id: "orig-1", sender: "dave@example.net" });
		const { ctx } = fakeExecutionCtx();
		const res = await app.request(
			"/api/v1/mailboxes/alice@example.com/emails/orig-1/reply",
			jsonPost({ ...compose, subject: "Re: Hello" }),
			env,
			ctx,
		);

		expect(res.status).toBe(502);
		expect(stub.rows.filter((r) => r.folder === "sent")).toHaveLength(0);
	});

	it("forward: rejected send is reported and not stored", async () => {
		const { env, stubs } = makeFakeEnv({
			sendImpl: async () => {
				throw new Error("rejected");
			},
		});
		const stub = (stubs["alice@example.com"] = (await import("../test-utils")).makeFakeMailboxStub());
		await stub.createEmail("inbox", { id: "orig-1", message_id: "m1@example.net", thread_id: "orig-1", sender: "dave@example.net" });
		const { ctx } = fakeExecutionCtx();
		const res = await app.request(
			"/api/v1/mailboxes/alice@example.com/emails/orig-1/forward",
			jsonPost({ ...compose, subject: "Fwd: Hello" }),
			env,
			ctx,
		);

		expect(res.status).toBe(502);
		expect(stub.rows.filter((r) => r.folder === "sent")).toHaveLength(0);
	});
});

describe("compose: sender display name", () => {
	it("files the sent message with the From name the user sent as", async () => {
		const { env, stubs } = makeFakeEnv();
		const { ctx } = fakeExecutionCtx();
		const res = await app.request(
			"/api/v1/mailboxes/alice@example.com/emails",
			jsonPost({ ...compose, from: { email: "alice@example.com", name: "Alice Chen" } }),
			env,
			ctx,
		);

		expect(res.status).toBe(202);
		expect(stubs["alice@example.com"].rows[0].email.sender_name).toBe("Alice Chen");
	});

	it("stores no name when sending from a bare address", async () => {
		const { env, stubs } = makeFakeEnv();
		const { ctx } = fakeExecutionCtx();
		await app.request("/api/v1/mailboxes/alice@example.com/emails", jsonPost(compose), env, ctx);

		expect(stubs["alice@example.com"].rows[0].email.sender_name ?? null).toBeNull();
	});
});
