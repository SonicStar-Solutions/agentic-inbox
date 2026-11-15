// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { allowedPorts, validateImapHost } from "./hosts";

describe("validateImapHost", () => {
	it("accepts ordinary public mail servers", () => {
		expect(validateImapHost("imap.gmail.com", 993)).toEqual({ ok: true, host: "imap.gmail.com", port: 993 });
		expect(validateImapHost(" IMAP.Fastmail.com. ", 143)).toEqual({ ok: true, host: "imap.fastmail.com", port: 143 });
	});
	it.each([
		"127.0.0.1",
		"10.0.0.5",
		"[::1]",
		"::1",
		"localhost",
		"mail",
		"nas.local",
		"router.lan",
		"db.internal",
		"foo.localhost",
		"host.example",
		"",
		"bad host.com",
		"a..b.com",
		"mail.example.com/evil",
		"user@mail.com",
		"999.999.999.999",
	])("rejects %j", (host) => {
		expect(validateImapHost(host, 993).ok).toBe(false);
	});
	it("only allows the configured ports", () => {
		expect(validateImapHost("imap.gmail.com", 25).ok).toBe(false);
		expect(validateImapHost("imap.gmail.com", 22).ok).toBe(false);
		expect(validateImapHost("imap.gmail.com", 1993, "993,1993").ok).toBe(true);
		expect(validateImapHost("imap.gmail.com", 993.5).ok).toBe(false);
	});
	it("falls back to the defaults for a bad port list", () => {
		expect(allowedPorts("abc,,-1")).toEqual([993, 143]);
		expect(allowedPorts(undefined)).toEqual([993, 143]);
	});
});
