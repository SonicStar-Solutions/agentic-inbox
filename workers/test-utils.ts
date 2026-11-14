// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Test helpers: in-memory stand-ins for the R2 bucket, the MailboxDO stub and
 * the `send_email` binding, so Hono routes can be exercised with
 * `app.request(path, init, env)` under plain Node.
 */

export interface StoredRow {
	folder: string;
	email: Record<string, any>;
	attachments: any[];
}

export function makeFakeMailboxStub() {
	const rows: StoredRow[] = [];
	const calls: string[] = [];
	const stub = {
		rows,
		calls,
		rateLimit: null as string | null,
		async checkSendRateLimit() {
			calls.push("checkSendRateLimit");
			return stub.rateLimit;
		},
		async createEmail(folder: string, email: Record<string, any>, attachments: any[] = []) {
			calls.push("createEmail");
			rows.push({ folder, email, attachments });
			return email;
		},
		async markThreadRead(_threadId: string) {
			calls.push("markThreadRead");
		},
		async getEmail(id: string) {
			const row = rows.find((r) => r.email.id === id);
			return row ? { ...row.email, folder_id: row.folder } : null;
		},
		async getFolders() {
			return [];
		},
		async deleteEmail(id: string) {
			const i = rows.findIndex((r) => r.email.id === id);
			if (i < 0) return null;
			const [row] = rows.splice(i, 1);
			return row.attachments;
		},
		async findThreadBySubject(_subject: string, _sender?: string) {
			return null as string | null;
		},
		async findThreadByMessageIds(ids: string[]) {
			for (const id of ids) {
				const row = rows.find((r) => r.email.message_id === id);
				if (row) return (row.email.thread_id as string) ?? (row.email.id as string);
			}
			return null as string | null;
		},
	};
	return stub;
}

export type FakeMailboxStub = ReturnType<typeof makeFakeMailboxStub>;

export function makeFakeEnv(opts: {
	mailboxes?: string[];
	sendImpl?: (message: any) => Promise<{ messageId: string }>;
	emailAddresses?: string[];
	stubs?: Record<string, FakeMailboxStub>;
} = {}) {
	const mailboxes = new Set((opts.mailboxes ?? ["alice@example.com"]).map((m) => m.toLowerCase()));
	const stubs: Record<string, FakeMailboxStub> = opts.stubs ?? {};
	const objects = new Map<string, unknown>();
	const sent: any[] = [];
	const agentCalls: { name: string; url: string; body: any }[] = [];

	const env: any = {
		DOMAINS: "example.com",
		EMAIL_ADDRESSES: opts.emailAddresses ?? [],
		BUCKET: {
			async head(key: string) {
				const m = key.match(/^mailboxes\/(.+)\.json$/);
				if (m) return mailboxes.has(m[1]) ? { key } : null;
				return objects.has(key) ? { key } : null;
			},
			async get(key: string) {
				if (!objects.has(key)) return null;
				const value = objects.get(key);
				return {
					body: value,
					json: async () => {
						if (typeof value === "string") {
							try { return JSON.parse(value); } catch { return {}; }
						}
						return value && typeof value === "object" ? value : {};
					},
				};
			},
			async put(key: string, value: unknown) {
				objects.set(key, value);
			},
			async delete(keys: string | string[]) {
				for (const k of [keys].flat()) objects.delete(k);
			},
		},
		MAILBOX: {
			idFromName: (name: string) => name,
			get: (id: string) => (stubs[id] ??= makeFakeMailboxStub()),
		},
		EMAIL: {
			async send(message: any) {
				sent.push(message);
				if (opts.sendImpl) return opts.sendImpl(message);
				return { messageId: "<provider-id-1@example.com>" };
			},
		},
		EMAIL_AGENT: {
			idFromName: (name: string) => name,
			get: (id: string) => ({
				async fetch(req: Request) {
					agentCalls.push({ name: id, url: req.url, body: await req.json() });
					return new Response("ok");
				},
			}),
		},
	};
	return { env, stubs, sent, agentCalls, objects };
}

export function fakeExecutionCtx() {
	const pending: Promise<unknown>[] = [];
	return {
		ctx: {
			waitUntil: (p: Promise<unknown>) => {
				pending.push(p);
			},
			passThroughOnException() {},
		} as unknown as ExecutionContext,
		flush: () => Promise.allSettled(pending),
	};
}

export const jsonPost = (body: unknown): RequestInit => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: typeof body === "string" ? body : JSON.stringify(body),
});

/** Build the argument `receiveEmail` expects from a raw RFC 822 string. */
export function rawEmailEvent(raw: string, envelopeTo?: string, envelopeFrom = "sender@example.net") {
	const bytes = new TextEncoder().encode(raw);
	return {
		raw: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes);
				controller.close();
			},
		}),
		rawSize: bytes.byteLength,
		to: envelopeTo as string,
		from: envelopeFrom,
	};
}

export function rfc822(headers: Record<string, string>, body = "hello") {
	return Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n" + body;
}
