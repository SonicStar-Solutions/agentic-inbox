// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { app } from "../index";
import { fakeExecutionCtx, makeFakeEnv, makeFakeMailboxStub } from "../test-utils";

async function download(mimetype: string, query = "") {
	const stub: any = makeFakeMailboxStub();
	stub.getAttachment = async () => ({ filename: "doc.pdf", mimetype });
	const { env, objects } = makeFakeEnv({ stubs: { "alice@example.com": stub } });
	objects.set("attachments/e1/a1/doc.pdf", "%PDF-1.4");
	return app.request(`/api/v1/mailboxes/alice@example.com/emails/e1/attachments/a1${query}`, {}, env, fakeExecutionCtx().ctx);
}

describe("attachment download (#89 PDF preview)", () => {
	it("downloads by default", async () => {
		const res = await download("application/pdf");
		expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});
	it("serves a PDF inline when asked", async () => {
		const res = await download("application/pdf", "?inline=1");
		expect(res.headers.get("Content-Disposition")).toMatch(/^inline;/);
		expect(res.headers.get("Content-Type")).toBe("application/pdf");
	});
	it("never serves anything else inline", async () => {
		for (const type of ["text/html", "image/svg+xml", "application/octet-stream"]) {
			const res = await download(type, "?inline=1");
			expect(res.headers.get("Content-Disposition")).toMatch(/^attachment;/);
		}
	});
});
