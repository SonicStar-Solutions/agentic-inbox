// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import type { ImapImportStatus, ProbeFolder } from "shared/import";
import { buildFolderMap, choiceToTarget, connectionErrorMessage, countToImport, estimateRemaining, formatDuration, percentDone, targetToChoice } from "./import-ui";

const status = (over: Partial<ImapImportStatus> = {}): ImapImportStatus => ({
	status: "running",
	source: null,
	startedBy: null,
	currentFolder: null,
	totals: { folders: 2, messages: 1000 },
	folderIndex: 0,
	counts: { imported: 0, skipped: 0, failed: 0 },
	failures: [],
	failureCount: 0,
	error: null,
	retry: null,
	startedAt: "2026-01-01T00:00:00.000Z",
	updatedAt: null,
	finishedAt: null,
	...over,
});

const folders: ProbeFolder[] = [
	{ path: "INBOX", name: "INBOX", messages: 10, suggested: "inbox" },
	{ path: "Clients", name: "Clients", messages: 5, suggested: "new:Clients" },
	{ path: "Junk", name: "Junk", messages: 3, suggested: "spam" },
	{ path: "Stars", name: "Stars", messages: 2, suggested: null },
];

describe("folder choices", () => {
	it("round-trips targets through the select", () => {
		expect(targetToChoice("inbox")).toBe("inbox");
		expect(targetToChoice("new:Clients")).toBe("new");
		expect(targetToChoice(null)).toBe("skip");
		expect(choiceToTarget("new", folders[1])).toBe("new:Clients");
		expect(choiceToTarget("new", folders[0])).toBe("new:INBOX");
		expect(choiceToTarget("skip", folders[0])).toBeNull();
		expect(choiceToTarget("trash", folders[0])).toBe("trash");
	});
	it("applies overrides over the suggestions", () => {
		const map = buildFolderMap(folders, { Junk: null, Stars: "archive" });
		expect(map).toEqual({ INBOX: "inbox", Clients: "new:Clients", Junk: null, Stars: "archive" });
		expect(countToImport(folders, map)).toEqual({ folders: 3, messages: 17 });
	});
});

describe("progress", () => {
	it("computes a percentage and never shows 100 before done", () => {
		expect(percentDone(status())).toBe(0);
		expect(percentDone(status({ counts: { imported: 250, skipped: 250, failed: 0 } }))).toBe(50);
		expect(percentDone(status({ counts: { imported: 1000, skipped: 0, failed: 0 } }))).toBe(99);
		expect(percentDone(status({ status: "done" }))).toBe(100);
		expect(percentDone(status({ totals: { folders: 1, messages: 0 } }))).toBeNull();
	});
	it("estimates time left only once there is enough to go on", () => {
		const start = new Date("2026-01-01T00:00:00.000Z").getTime();
		const s = status({ counts: { imported: 100, skipped: 0, failed: 0 } });
		expect(estimateRemaining(s, start + 5_000)).toBeNull();
		expect(estimateRemaining(status({ counts: { imported: 5, skipped: 0, failed: 0 } }), start + 60_000)).toBeNull();
		expect(estimateRemaining(s, start + 60_000)).toBe(540_000); // 900 left at 100 per minute
		expect(estimateRemaining(status({ status: "done" }), start + 60_000)).toBeNull();
	});
	it("formats durations", () => {
		expect(formatDuration(10_000)).toBe("under a minute");
		expect(formatDuration(5 * 60_000)).toBe("5 min");
		expect(formatDuration(125 * 60_000)).toBe("2 h 5 min");
		expect(formatDuration(120 * 60_000)).toBe("2 h");
	});
});

describe("connectionErrorMessage", () => {
	it("explains app passwords for providers that need them", () => {
		expect(connectionErrorMessage("auth", "x", "gmail")).toMatch(/app password/);
		expect(connectionErrorMessage("auth", "x", "fastmail")).not.toMatch(/app password, not/);
	});
	it("passes other messages through", () => {
		expect(connectionErrorMessage("connect", "Could not connect to a:993", "other")).toMatch(/Check the server name/);
		expect(connectionErrorMessage(undefined, "Port 25 is not allowed.", "other")).toBe("Port 25 is not allowed.");
	});
});
