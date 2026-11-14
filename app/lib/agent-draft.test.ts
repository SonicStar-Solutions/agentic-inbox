// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { findDraftReplyOutput } from "./agent-draft";

const output = {
	status: "draft_saved",
	draftId: "d1",
	draft: { originalEmailId: "e1", to: "dave@example.net", subject: "Re: Hi", body: "Thanks" },
};

describe("findDraftReplyOutput (#87)", () => {
	it("reads the AI SDK v6 shape (type tool-draft_reply + output)", () => {
		expect(findDraftReplyOutput([{ type: "text" }, { type: "tool-draft_reply", output }])).toEqual({
			draftId: "d1", originalEmailId: "e1", to: "dave@example.net", subject: "Re: Hi", body: "Thanks",
		});
	});

	it("reads dynamic-tool parts and legacy result", () => {
		expect(findDraftReplyOutput([{ type: "dynamic-tool", toolName: "draft_reply", output }])?.draftId).toBe("d1");
		expect(findDraftReplyOutput([{ type: "x", toolName: "draft_reply", result: output }])?.draftId).toBe("d1");
	});

	it("ignores other tools, failed drafts and pending calls", () => {
		expect(findDraftReplyOutput([{ type: "tool-get_email", output }])).toBeNull();
		expect(findDraftReplyOutput([{ type: "tool-draft_reply", output: { error: "verification failed" } }])).toBeNull();
		expect(findDraftReplyOutput([{ type: "tool-draft_reply" }])).toBeNull();
	});

	it("prefers the most recent draft", () => {
		const second = { ...output, draftId: "d2" };
		expect(findDraftReplyOutput([{ type: "tool-draft_reply", output }, { type: "tool-draft_reply", output: second }])?.draftId).toBe("d2");
	});
});
