// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import { addAllowedSender, countRemoteImages, isSenderAllowed, loadAllowedSenders, senderAddress } from "./remote-images";

const memoryStorage = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("countRemoteImages (#88)", () => {
	it("counts distinct remote images and ignores data:, cid: and relative URLs", () => {
		const html = `
			<img src="https://track.example/p.gif"><img src='http://a.example/b.png'>
			<img src="https://track.example/p.gif">
			<img src="data:image/png;base64,AAA"><img src="cid:logo"><img src="/api/v1/x">
			<img src="//cdn.example/c.png">`;
		expect(countRemoteImages(html)).toBe(3);
	});
	it("finds srcset, background and CSS url()", () => {
		expect(countRemoteImages(`<img srcset="https://a.example/1.png 1x, https://a.example/2.png 2x">`)).toBe(2);
		expect(countRemoteImages(`<td background="https://a.example/bg.png"></td>`)).toBe(1);
		expect(countRemoteImages(`<div style="background:url('https://a.example/x.png')"></div><style>p{background:url(https://b.example/y.png)}</style>`)).toBe(2);
	});
	it("is zero for empty or image-free html", () => {
		expect(countRemoteImages("")).toBe(0);
		expect(countRemoteImages("<p>hello <a href='https://x.example'>link</a></p>")).toBe(0);
	});
});

describe("sender allow-list", () => {
	it("extracts bare addresses", () => {
		expect(senderAddress("Dave <Dave@Example.NET>")).toBe("dave@example.net");
		expect(senderAddress("dave@example.net")).toBe("dave@example.net");
		expect(senderAddress(undefined)).toBe("");
	});
	it("stores per mailbox and per sender, case-insensitively", () => {
		const s = memoryStorage();
		expect(isSenderAllowed(s, "m1", "dave@example.net")).toBe(false);
		addAllowedSender(s, "m1", "Dave <DAVE@example.net>");
		addAllowedSender(s, "m1", "dave@example.net");
		expect(loadAllowedSenders(s, "m1")).toEqual(["dave@example.net"]);
		expect(isSenderAllowed(s, "m1", "dave@example.net")).toBe(true);
		expect(isSenderAllowed(s, "m2", "dave@example.net")).toBe(false);
	});
	it("survives missing or throwing storage", () => {
		expect(isSenderAllowed(undefined, "m", "a@b.c")).toBe(false);
		expect(() => addAllowedSender({ getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } }, "m", "a@b.c")).not.toThrow();
	});
});
