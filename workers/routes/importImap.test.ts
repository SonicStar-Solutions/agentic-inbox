// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index";
import { accessEmail } from "../lib/access-identity";
import { ImapAuthError, ImapConnectionError } from "../lib/imap/client";
import { fakeExecutionCtx, jsonPost, makeFakeEnv } from "../test-utils";

const probe = vi.hoisted(() => vi.fn());
vi.mock("../lib/imap/probe", () => ({ probeImap: probe }));

const view = (over: object = {}) => ({
	status: "running",
	source: { host: "imap.gmail.com", port: 993, security: "tls", username: "me@gmail.com" },
	startedBy: null,
	currentFolder: "INBOX",
	totals: { folders: 2, messages: 10 },
	folderIndex: 0,
	counts: { imported: 1, skipped: 0, failed: 0 },
	failures: [],
	failureCount: 0,
	error: null,
	retry: null,
	startedAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:01.000Z",
	finishedAt: null,
	...over,
});

function setup() {
	const job = {
		startImport: vi.fn(async (_input: any) => view()),
		getStatus: vi.fn(async () => view()),
		cancel: vi.fn(async () => view({ status: "canceled" })),
		retryFailed: vi.fn(async (_password: string) => view()),
		dismissFailures: vi.fn(async () => view()),
	};
	return { job, ...makeFakeEnv({ importJobs: { "alice@example.com": job } }) };
}
const call = (env: any, path: string, init?: RequestInit) =>
	app.request(`/api/v1/mailboxes/alice@example.com/import/imap${path}`, init, env, fakeExecutionCtx().ctx);
const conn = { host: "imap.gmail.com", port: 993, username: "me@gmail.com", password: "app-password-123" };

beforeEach(() => probe.mockReset());

describe("start", () => {
	it("starts a job with defaults filled in and never returns the password", async () => {
		const { env, job } = setup();
		const res = await call(env, "/start", jsonPost(conn));
		expect(res.status).toBe(202);
		expect(await res.text()).not.toContain("app-password-123");
		expect(job.startImport).toHaveBeenCalledWith(
			expect.objectContaining({ mailboxId: "alice@example.com", host: "imap.gmail.com", port: 993, security: "tls", username: "me@gmail.com", password: "app-password-123", folderMap: {} }),
		);
	});
	it("uses STARTTLS on port 143", async () => {
		const { env, job } = setup();
		await call(env, "/start", jsonPost({ ...conn, port: 143 }));
		expect(job.startImport).toHaveBeenCalledWith(expect.objectContaining({ port: 143, security: "starttls" }));
	});
	it("passes a validated folder map", async () => {
		const { env, job } = setup();
		await call(env, "/start", jsonPost({ ...conn, folderMap: { INBOX: "inbox", Junk: null, Clients: "new:Clients" } }));
		expect(job.startImport.mock.calls[0][0].folderMap).toEqual({ INBOX: "inbox", Junk: null, Clients: "new:Clients" });
	});
	it("records who started it", async () => {
		const { env, job } = setup();
		const payload = btoa(JSON.stringify({ email: "teammate@example.com" })).replace(/=/g, "");
		await call(env, "/start", { ...jsonPost(conn), headers: { "Content-Type": "application/json", "cf-access-jwt-assertion": `h.${payload}.s` } });
		expect(job.startImport.mock.calls[0][0].startedBy).toBe("teammate@example.com");
	});
	it.each([
		[{ host: "127.0.0.1" }],
		[{ host: "localhost" }],
		[{ host: "imap.gmail.com", port: 25 }],
		[{ host: "" }],
		[{ username: "" }],
		[{ password: "" }],
		[{ security: "plain" }],
		[{ folderMap: { INBOX: "draft" } }],
		[{ folderMap: { INBOX: "elsewhere" } }],
	])("rejects bad input %j", async (patch) => {
		const { env, job } = setup();
		const res = await call(env, "/start", jsonPost({ ...conn, ...patch }));
		expect(res.status).toBe(400);
		expect(job.startImport).not.toHaveBeenCalled();
	});
	it("answers 409 when one is already running", async () => {
		const { env, job } = setup();
		job.startImport.mockRejectedValueOnce(new Error("An import is already running for this mailbox"));
		const res = await call(env, "/start", jsonPost(conn));
		expect(res.status).toBe(409);
		expect(((await res.json()) as any).error).toMatch(/already running/);
	});
});

describe("test connection", () => {
	it("returns the folder list", async () => {
		const { env } = setup();
		probe.mockResolvedValueOnce({ folders: [{ path: "INBOX", name: "INBOX", messages: 3, suggested: "inbox" }], totalMessages: 3 });
		const res = await call(env, "/test", jsonPost(conn));
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).totalMessages).toBe(3);
		expect(probe).toHaveBeenCalledWith(expect.objectContaining({ host: "imap.gmail.com", security: "tls" }));
	});
	it("maps a rejected password to 422 and an unreachable server to 502", async () => {
		const { env } = setup();
		probe.mockRejectedValueOnce(new ImapAuthError("The server rejected the username or password."));
		const auth = await call(env, "/test", jsonPost(conn));
		expect(auth.status).toBe(422);
		expect(((await auth.json()) as any).code).toBe("auth");

		probe.mockRejectedValueOnce(new ImapConnectionError("Could not connect to imap.gmail.com:993"));
		const down = await call(env, "/test", jsonPost(conn));
		expect(down.status).toBe(502);
		expect(((await down.json()) as any).code).toBe("connect");
	});
	it("refuses a private host before connecting", async () => {
		const { env } = setup();
		const res = await call(env, "/test", jsonPost({ ...conn, host: "10.0.0.1" }));
		expect(res.status).toBe(400);
		expect(probe).not.toHaveBeenCalled();
	});
});

describe("status, cancel, retry and dismiss", () => {
	it("reads status", async () => {
		const { env } = setup();
		const res = await call(env, "/status");
		expect(res.status).toBe(200);
		const body = (await res.json()) as any;
		expect(body.counts.imported).toBe(1);
		expect(JSON.stringify(body)).not.toMatch(/password/i);
	});
	it("cancels", async () => {
		const { env, job } = setup();
		expect(((await (await call(env, "/cancel", { method: "POST" })).json()) as any).status).toBe("canceled");
		expect(job.cancel).toHaveBeenCalled();
	});
	it("retry-failed needs the password again", async () => {
		const { env, job } = setup();
		expect((await call(env, "/retry-failed", jsonPost({}))).status).toBe(400);
		expect((await call(env, "/retry-failed", jsonPost({ password: "again" }))).status).toBe(202);
		expect(job.retryFailed).toHaveBeenCalledWith("again");
		job.retryFailed.mockRejectedValueOnce(new Error("There are no failed messages to retry"));
		expect((await call(env, "/retry-failed", jsonPost({ password: "again" }))).status).toBe(409);
	});
	it("dismisses the failure log", async () => {
		const { env, job } = setup();
		expect((await call(env, "/dismiss-failures", { method: "POST" })).status).toBe(200);
		expect(job.dismissFailures).toHaveBeenCalled();
	});
	it("404s for a mailbox that does not exist", async () => {
		const { env } = setup();
		const res = await app.request("/api/v1/mailboxes/nobody@example.com/import/imap/status", undefined, env, fakeExecutionCtx().ctx);
		expect(res.status).toBe(404);
	});
});

describe("accessEmail", () => {
	it("reads the email claim and tolerates junk", () => {
		const payload = btoa(JSON.stringify({ email: "a@b.com" })).replace(/=/g, "");
		expect(accessEmail(new Request("http://x", { headers: { "cf-access-jwt-assertion": `h.${payload}.s` } }))).toBe("a@b.com");
		expect(accessEmail(new Request("http://x", { headers: { "cf-access-jwt-assertion": "garbage" } }))).toBeNull();
		expect(accessEmail(new Request("http://x"))).toBeNull();
	});
});
