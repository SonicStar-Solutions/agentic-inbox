// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { isGenericSubject, normalizeSubject, pickImportThread, type ThreadCandidate } from "./threading";

const day = 24 * 60 * 60 * 1000;
const at = (base: string, plusDays = 0) => new Date(new Date(base).getTime() + plusDays * day).toISOString();
const cand = (over: Partial<ThreadCandidate>): ThreadCandidate => ({
	thread_id: "t1",
	subject: "Quarterly planning notes",
	sender: "bob@example.com",
	recipient: "alice@example.com",
	date: "2015-03-01T10:00:00.000Z",
	...over,
});
const msg = (over: Partial<Parameters<typeof pickImportThread>[1]> = {}) => ({
	subject: "Re: Quarterly planning notes",
	sender: "alice@example.com",
	recipient: "bob@example.com",
	date: at("2015-03-01T10:00:00.000Z", 2),
	...over,
});

describe("subject normalization", () => {
	it("strips reply and forward prefixes", () => {
		expect(normalizeSubject("Re: RE: Fwd:  Hello   there")).toBe("hello there");
		expect(normalizeSubject("AW: Angebot")).toBe("angebot");
	});
	it("flags generic subjects", () => {
		for (const s of ["", "hi", "Invoice", "(no subject)", "Re: Hello"]) {
			expect(isGenericSubject(normalizeSubject(s))).toBe(true);
		}
		expect(isGenericSubject(normalizeSubject("Quarterly planning notes"))).toBe(false);
	});
});

describe("pickImportThread", () => {
	it("joins a recent thread with a shared participant", () => {
		expect(pickImportThread([cand({})], msg())).toBe("t1");
	});
	it("does not join across a long gap", () => {
		expect(pickImportThread([cand({})], msg({ date: at("2015-03-01T10:00:00.000Z", 45) }))).toBeNull();
	});
	it("does not join when nobody is shared", () => {
		expect(pickImportThread([cand({ sender: "x@x.com", recipient: "y@y.com" })], msg())).toBeNull();
	});
	it("never joins on a generic subject", () => {
		const c = cand({ subject: "Invoice" });
		expect(pickImportThread([c], msg({ subject: "Invoice" }))).toBeNull();
	});
	it("ignores other subjects", () => {
		expect(pickImportThread([cand({ subject: "Something else entirely" })], msg())).toBeNull();
	});
	it("picks the thread with the latest message when several match", () => {
		const older = cand({ thread_id: "old", date: at("2015-03-01T10:00:00.000Z", -10) });
		const newer = cand({ thread_id: "new", date: at("2015-03-01T10:00:00.000Z", 1) });
		expect(pickImportThread([older, newer], msg())).toBe("new");
	});
	it("copes with unparseable dates", () => {
		expect(pickImportThread([cand({})], msg({ date: "nonsense" }))).toBeNull();
	});
});
