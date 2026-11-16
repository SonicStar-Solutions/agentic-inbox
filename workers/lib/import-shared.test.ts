// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeFakeEnv, makeFakeMailboxStub } from "../test-utils";
import { importParsedEmail } from "./import-shared";

const enc = new TextEncoder();
const mail = (headers: Record<string, string>, body = "Hello there") =>
	enc.encode(`${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`);

function setup() {
	const stub: any = makeFakeMailboxStub();
	const { env, agentCalls, objects } = makeFakeEnv();
	return { stub, bucket: env.BUCKET, agentCalls, objects, env };
}

const base = {
	From: "Bob <bob@example.com>",
	To: "alice@example.com",
	Subject: "Quarterly planning notes",
	Date: "Mon, 2 Mar 2015 10:00:00 +0000",
	"Message-ID": "<m1@example.com>",
};

describe("importParsedEmail", () => {
	it("stores the message with its original date, flags and Message-ID", async () => {
		const { stub, bucket } = setup();
		const out = await importParsedEmail(bucket, stub, mail(base), { folder: "sent", read: true, starred: true });
		expect(out.duplicate).toBe(false);
		const row = stub.rows[0];
		expect(row.folder).toBe("sent");
		expect(row.email).toMatchObject({
			subject: "Quarterly planning notes",
			sender: "bob@example.com",
			message_id: "m1@example.com",
			read: true,
			starred: true,
			date: "2015-03-02T10:00:00.000Z",
		});
	});

	it("skips a message that is already stored", async () => {
		const { stub, bucket } = setup();
		await importParsedEmail(bucket, stub, mail(base), {});
		const again = await importParsedEmail(bucket, stub, mail(base), {});
		expect(again).toEqual({ id: null, duplicate: true });
		expect(stub.rows).toHaveLength(1);
	});

	it("uses the key the caller computed for messages without a Message-ID", async () => {
		const { stub, bucket } = setup();
		const { "Message-ID": _drop, ...noId } = base;
		await importParsedEmail(bucket, stub, mail(noId), { messageId: "import-abc@import.invalid" });
		expect(stub.rows[0].email.message_id).toBe("import-abc@import.invalid");
		expect((await importParsedEmail(bucket, stub, mail(noId), { messageId: "import-abc@import.invalid" })).duplicate).toBe(true);
	});

	it("puts a reply in its parent's thread", async () => {
		const { stub, bucket } = setup();
		await importParsedEmail(bucket, stub, mail(base), {});
		await importParsedEmail(bucket, stub, mail({ ...base, "Message-ID": "<m2@example.com>", "In-Reply-To": "<m1@example.com>", References: "<m1@example.com>", Subject: "Re: Quarterly planning notes" }), {});
		expect(stub.rows[1].email.thread_id).toBe(stub.rows[0].email.thread_id);
	});

	it("threads headerless replies by subject only when it is safe", async () => {
		const { stub, bucket } = setup();
		await importParsedEmail(bucket, stub, mail(base), {});
		const reply = { ...base, "Message-ID": "<m2@example.com>", Subject: "RE: Quarterly planning notes", From: "alice@example.com", To: "bob@example.com", Date: "Wed, 4 Mar 2015 10:00:00 +0000" };
		await importParsedEmail(bucket, stub, mail(reply), {});
		expect(stub.rows[1].email.thread_id).toBe(stub.rows[0].email.thread_id);

		// Same subject a year later: a new thread.
		await importParsedEmail(bucket, stub, mail({ ...reply, "Message-ID": "<m3@example.com>", Date: "Wed, 2 Mar 2016 10:00:00 +0000" }), {});
		expect(stub.rows[2].email.thread_id).not.toBe(stub.rows[0].email.thread_id);

		// Generic subject: never joined.
		await importParsedEmail(bucket, stub, mail({ ...base, "Message-ID": "<g1@x>", Subject: "Hello" }), {});
		await importParsedEmail(bucket, stub, mail({ ...base, "Message-ID": "<g2@x>", Subject: "Re: Hello" }), {});
		expect(stub.rows[4].email.thread_id).not.toBe(stub.rows[3].email.thread_id);
	});

	it("saves attachments and removes them if the message cannot be stored", async () => {
		const { stub, bucket, objects } = setup();
		const withAtt = enc.encode(
			[
				"From: bob@example.com",
				"To: alice@example.com",
				"Subject: Files",
				"Message-ID: <att@x>",
				"MIME-Version: 1.0",
				'Content-Type: multipart/mixed; boundary="b"',
				"",
				"--b",
				"Content-Type: text/plain",
				"",
				"see attached",
				"--b",
				'Content-Type: text/plain; name="a.txt"',
				'Content-Disposition: attachment; filename="a.txt"',
				"",
				"file contents",
				"--b--",
				"",
			].join("\r\n"),
		);
		await importParsedEmail(bucket, stub, withAtt, {});
		expect([...objects.keys()].filter((k) => k.startsWith("attachments/"))).toHaveLength(1);
		expect(stub.rows[0].attachments[0]).toMatchObject({ filename: "a.txt", disposition: "attachment" });

		objects.clear();
		stub.createEmail = async () => {
			throw new Error("db down");
		};
		stub.hasMessageId = async () => false;
		await expect(importParsedEmail(bucket, stub, withAtt, {})).rejects.toThrow("db down");
		expect([...objects.keys()].filter((k) => k.startsWith("attachments/"))).toHaveLength(0);
	});

	it("does not notify per message when silent", async () => {
		const { stub, bucket } = setup();
		let seen: unknown;
		stub.createEmail = async (_f: string, _e: any, _a: any[], opts: any) => {
			seen = opts;
		};
		await importParsedEmail(bucket, stub, mail(base), { silent: true });
		expect(seen).toEqual({ silent: true });
	});
});

describe("imported mail never reaches the AI agent", () => {
	// Importing is history, not new mail: none of the import code may reference
	// the agent binding. Comments are stripped so the headers can say so.
	const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
	it.each([
		"workers/lib/import-shared.ts",
		"workers/lib/import-engine.ts",
		"workers/durableObject/importJob.ts",
		"workers/routes/importImap.ts",
		"workers/lib/imap/client.ts",
	])("%s has no reference to EMAIL_AGENT", (file) => {
		expect(strip(readFileSync(file, "utf8"))).not.toMatch(/EMAIL_AGENT|EmailAgent|sendEmail|deliverRaw|env\.EMAIL\b/);
	});
});
