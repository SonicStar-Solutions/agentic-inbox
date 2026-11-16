// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, jsonPost, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";

const email = { to: "dave@example.net", from: "alice@example.com", subject: "Hi", text: "hello" };
const inAnHour = () => new Date(Date.now() + 3600_000).toISOString();

function setup() {
	const stub: any = makeFakeMailboxStub();
	stub.scheduleEmail = vi.fn(async () => "id");
	stub.listScheduled = vi.fn(async () => [{ id: "s1", subject: "Hi", status: "pending" }]);
	stub.cancelScheduled = vi.fn(async (id: string) => id === "s1");
	return { stub, ...makeFakeEnv({ stubs: { "alice@example.com": stub } }) };
}
const call = (env: any, path: string, init?: RequestInit) =>
	app.request(`/api/v1/mailboxes/alice@example.com${path}`, init, env, fakeExecutionCtx().ctx);

describe("scheduled sends API (#89)", () => {
	it("schedules a message", async () => {
		const { stub, env } = setup();
		const res = await call(env, "/emails/schedule", jsonPost({ kind: "compose", send_at: inAnHour(), email }));
		expect(res.status).toBe(201);
		expect(stub.scheduleEmail).toHaveBeenCalledOnce();
		expect(stub.scheduleEmail.mock.calls[0][0]).toMatchObject({ mailboxId: "alice@example.com" });
	});

	it("rejects a bad time, a foreign sender and attachments", async () => {
		const { stub, env } = setup();
		expect((await call(env, "/emails/schedule", jsonPost({ kind: "compose", send_at: new Date(Date.now() + 5000).toISOString(), email }))).status).toBe(400);
		expect((await call(env, "/emails/schedule", jsonPost({ kind: "compose", send_at: inAnHour(), email: { ...email, from: "bob@example.com" } }))).status).toBe(400);
		const withAtt = { ...email, attachments: [{ content: "QQ==", filename: "a.txt", type: "text/plain", disposition: "attachment" }] };
		expect((await call(env, "/emails/schedule", jsonPost({ kind: "compose", send_at: inAnHour(), email: withAtt }))).status).toBe(400);
		expect(stub.scheduleEmail).not.toHaveBeenCalled();
	});

	it("lists and cancels", async () => {
		const { env } = setup();
		expect(((await (await call(env, "/scheduled")).json()) as any).scheduled).toHaveLength(1);
		expect((await call(env, "/scheduled/s1", { method: "DELETE" })).status).toBe(204);
		expect((await call(env, "/scheduled/nope", { method: "DELETE" })).status).toBe(404);
	});
});
