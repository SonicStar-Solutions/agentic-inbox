// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { buildBulkRequest } from "./bulk";

describe("buildBulkRequest (#88)", () => {
	const rows = [
		{ id: "a", thread_id: "ta", thread_count: 1 },
		{ id: "b", thread_id: "tb", thread_count: 3 },
		{ id: "c", thread_id: null },
		{ id: "d", thread_id: "tb", thread_count: 3 },
	];
	it("targets threads for conversations and ids for single messages", () => {
		expect(buildBulkRequest("read", rows, "inbox")).toEqual({
			action: "read", ids: ["a", "c"], thread_ids: ["tb"], folder: "inbox",
		});
	});
	it("omits folder when there are no thread targets and carries the destination for move", () => {
		expect(buildBulkRequest("move", rows.slice(0, 1), "inbox", "archive")).toEqual({
			action: "move", ids: ["a"], thread_ids: [], folderId: "archive",
		});
	});
});
