// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { decodeMailboxName, encodeMailboxName } from "./utf7";

describe("modified UTF-7 mailbox names", () => {
	it("decodes the RFC 3501 examples", () => {
		expect(decodeMailboxName("Entw&APw-rfe")).toBe("Entwürfe");
		expect(decodeMailboxName("&U,BTFw-")).toBe("台北");
		expect(decodeMailboxName("A&-B")).toBe("A&B");
	});
	it("leaves plain ASCII alone", () => {
		expect(decodeMailboxName("[Gmail]/Sent Mail")).toBe("[Gmail]/Sent Mail");
		expect(encodeMailboxName("INBOX.Sent")).toBe("INBOX.Sent");
	});
	it("round-trips non-ASCII and ampersands", () => {
		for (const name of ["Entwürfe", "送信済み", "Tom & Jerry", "Boîte/Reçus", "📥 Inbox"]) {
			expect(decodeMailboxName(encodeMailboxName(name))).toBe(name);
		}
	});
	it("does not throw on malformed input", () => {
		expect(() => decodeMailboxName("&&&-&")).not.toThrow();
	});
});
