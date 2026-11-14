// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, receiveEmail } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv, rawEmailEvent, rfc822 } from "../test-utils";
import { aliasesOf } from "./aliases";

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const put = (env: any, settings: unknown, mailbox = "alice@example.com") =>
	app.request(`/api/v1/mailboxes/${mailbox}`, { ...jsonPost({ settings }), method: "PUT" }, env, fakeExecutionCtx().ctx);

describe("aliases (#89)", () => {
	it("aliasesOf keeps only valid, lowercase, unique addresses", () => {
		expect(aliasesOf({ aliases: ["Sales@Example.com", "sales@example.com", "nope", 5, " info@example.com "] })).toEqual(["sales@example.com", "info@example.com"]);
		expect(aliasesOf(undefined)).toEqual([]);
	});

	it("saves aliases and indexes them", async () => {
		const { env, objects } = makeFakeEnv();
		const res = await put(env, { aliases: ["Sales@example.com"] });
		expect(res.status).toBe(200);
		expect(objects.get("aliases/sales@example.com.json")).toContain("alice@example.com");
	});

	it("removing an alias drops it from the index", async () => {
		const { env, objects } = makeFakeEnv();
		await put(env, { aliases: ["sales@example.com", "info@example.com"] });
		await put(env, { aliases: ["info@example.com"] });
		expect(objects.has("aliases/sales@example.com.json")).toBe(false);
		expect(objects.has("aliases/info@example.com.json")).toBe(true);
	});

	it("rejects bad aliases", async () => {
		const { env } = makeFakeEnv({ mailboxes: ["alice@example.com", "bob@example.com"] });
		expect((await put(env, { aliases: ["not-an-email"] })).status).toBe(400);
		expect((await put(env, { aliases: ["x@other.net"] })).status).toBe(400); // off-domain
		expect((await put(env, { aliases: ["alice@example.com"] })).status).toBe(400); // own address
		expect((await put(env, { aliases: ["bob@example.com"] })).status).toBe(400); // another mailbox
		expect((await put(env, { aliases: ["a@example.com", "a@example.com"] })).status).toBe(400); // duplicate
		expect((await put(env, { aliases: "sales@example.com" })).status).toBe(400); // not a list
	});

	it("an alias can't be claimed by two mailboxes, nor created as a mailbox", async () => {
		const { env } = makeFakeEnv({ mailboxes: ["alice@example.com", "bob@example.com"] });
		expect((await put(env, { aliases: ["sales@example.com"] })).status).toBe(200);
		expect((await put(env, { aliases: ["sales@example.com"] }, "bob@example.com")).status).toBe(400);
		env.BUCKET.head = async (k: string) => (k === "mailboxes/sales@example.com.json" ? null : { key: k });
		const create = await app.request("/api/v1/mailboxes", jsonPost({ email: "sales@example.com", name: "s" }), env, fakeExecutionCtx().ctx);
		expect(create.status).toBe(409);
	});

	it("mail sent to an alias lands in the owning mailbox", async () => {
		const { env, stubs } = makeFakeEnv();
		await put(env, { aliases: ["sales@example.com"] });
		const raw = rfc822({ From: "dave@example.net", To: "sales@example.com", Subject: "Quote please" });
		await receiveEmail(rawEmailEvent(raw, "sales@example.com") as any, env, fakeExecutionCtx().ctx);
		expect(stubs["alice@example.com"].rows).toHaveLength(1);
		expect(stubs["alice@example.com"].rows[0].email.subject).toBe("Quote please");
	});

	it("can send from an alias but not from a stranger", async () => {
		const { env, stubs, sent } = makeFakeEnv();
		await put(env, { aliases: ["sales@example.com"] });
		const send = (from: string) =>
			app.request("/api/v1/mailboxes/alice@example.com/emails", jsonPost({ to: "dave@example.net", from, subject: "Hi", text: "x" }), env, fakeExecutionCtx().ctx);
		expect((await send("sales@example.com")).status).toBe(202);
		expect(sent[0].from).toBe("sales@example.com");
		expect(stubs["alice@example.com"].rows[0].email.sender).toBe("sales@example.com");
		expect((await send("mallory@example.com")).status).toBe(400);
		expect(sent).toHaveLength(1);
	});

	it("deleting a mailbox frees its aliases", async () => {
		const stub: any = (await import("../test-utils")).makeFakeMailboxStub();
		stub.purgeAll = async () => [];
		const { env, objects } = makeFakeEnv({ stubs: { "alice@example.com": stub } });
		await put(env, { aliases: ["sales@example.com"] });
		await app.request("/api/v1/mailboxes/alice@example.com", { method: "DELETE" }, env, fakeExecutionCtx().ctx);
		expect(objects.has("aliases/sales@example.com.json")).toBe(false);
	});
});
