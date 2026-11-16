// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import type { SourceFolder } from "../../../shared/import";
import { customFolderName, folderPriority, isValidTarget, suggestTarget } from "./folders";

const f = (name: string, flags: string[] = [], delimiter: string | null = "/"): SourceFolder => ({ path: name, name, delimiter, flags });

describe("suggestTarget", () => {
	it("maps INBOX", () => {
		expect(suggestTarget(f("INBOX"))).toBe("inbox");
		expect(suggestTarget(f("Inbox"))).toBe("inbox");
	});
	it("prefers special-use flags over names", () => {
		expect(suggestTarget(f("Gesendete Elemente", ["\\Sent"]))).toBe("sent");
		expect(suggestTarget(f("Papierkorb", ["\\Trash"]))).toBe("trash");
		expect(suggestTarget(f("Unerwünscht", ["\\Junk"]))).toBe("spam");
		expect(suggestTarget(f("Entwürfe", ["\\Drafts"]))).toBe("archive");
	});
	it("falls back to well-known names", () => {
		expect(suggestTarget(f("Sent Items"))).toBe("sent");
		expect(suggestTarget(f("Deleted Items"))).toBe("trash");
		expect(suggestTarget(f("Junk E-mail"))).toBe("spam");
		expect(suggestTarget(f("Drafts"))).toBe("archive");
	});
	it("never maps to the live Drafts folder", () => {
		expect(suggestTarget(f("Drafts"))).not.toBe("draft");
	});
	it("handles Gmail", () => {
		expect(suggestTarget(f("[Gmail]", ["\\Noselect", "\\HasChildren"]))).toBeNull();
		expect(suggestTarget(f("[Gmail]/All Mail", ["\\All"]))).toBe("archive");
		expect(suggestTarget(f("[Gmail]/Starred", ["\\Flagged"]))).toBeNull();
		expect(suggestTarget(f("[Gmail]/Important", ["\\Important"]))).toBeNull();
		expect(suggestTarget(f("[Gmail]/Sent Mail", ["\\Sent"]))).toBe("sent");
	});
	it("recreates custom folders under their own name", () => {
		expect(suggestTarget(f("Clients"))).toBe("new:Clients");
		expect(suggestTarget(f("Work/Projects/2019"))).toBe("new:Work / Projects / 2019");
		expect(suggestTarget(f("INBOX.Receipts", [], "."))).toBe("new:Receipts");
	});
});

describe("folder order and validation", () => {
	it("imports Inbox first and All Mail last", () => {
		const order = [
			["[Gmail]/All Mail", ["\\All"], "archive"],
			["Spam", [], "spam"],
			["Clients", [], "new:Clients"],
			["Sent", [], "sent"],
			["INBOX", [], "inbox"],
		] as const;
		const sorted = [...order].sort((a, b) => folderPriority(f(a[0], [...a[1]]), a[2]) - folderPriority(f(b[0], [...b[1]]), b[2]));
		expect(sorted.map((x) => x[0])).toEqual(["INBOX", "Sent", "Clients", "Spam", "[Gmail]/All Mail"]);
	});
	it("validates targets", () => {
		expect(isValidTarget(null)).toBe(true);
		expect(isValidTarget("inbox")).toBe(true);
		expect(isValidTarget("new:Clients")).toBe(true);
		expect(isValidTarget("draft")).toBe(false);
		expect(isValidTarget("new: ")).toBe(false);
		expect(isValidTarget("elsewhere")).toBe(false);
		expect(isValidTarget(5)).toBe(false);
	});
	it("names a folder from its path", () => {
		expect(customFolderName(f("A/B"))).toBe("A / B");
	});
});
