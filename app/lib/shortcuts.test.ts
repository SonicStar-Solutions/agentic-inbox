// @vitest-environment jsdom
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import { ChordTracker, GO_TO_CHORDS, isTypingTarget, moveSelection, shouldHandleKey, SHORTCUT_DOCS } from "./shortcuts";

afterEach(() => {
	document.body.innerHTML = "";
});

describe("isTypingTarget (#89)", () => {
	it("is true for inputs, textareas, selects and editors", () => {
		document.body.innerHTML = `<input id="i"><textarea id="t"></textarea><select id="s"></select><div class="ProseMirror"><p id="p">x</p></div><div contenteditable="true" id="c"></div><button id="b"></button>`;
		for (const id of ["i", "t", "s", "p", "c"]) expect(isTypingTarget(document.getElementById(id))).toBe(true);
		expect(isTypingTarget(document.getElementById("b"))).toBe(false);
		expect(isTypingTarget(null)).toBe(false);
	});
});

describe("shouldHandleKey", () => {
	const base = { defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false, target: null };
	it("ignores modified keys and prevented events", () => {
		expect(shouldHandleKey(base)).toBe(true);
		expect(shouldHandleKey({ ...base, ctrlKey: true })).toBe(false);
		expect(shouldHandleKey({ ...base, metaKey: true })).toBe(false);
		expect(shouldHandleKey({ ...base, defaultPrevented: true })).toBe(false);
	});
	it("ignores keys while a dialog is open", () => {
		document.body.innerHTML = `<div role="dialog"></div>`;
		expect(shouldHandleKey(base)).toBe(false);
	});
});

describe("ChordTracker", () => {
	it("completes 'g i' within the timeout", () => {
		const t = new ChordTracker(1000);
		expect(t.feed("g", 0)).toBeNull();
		expect(t.pending).toBe(true);
		expect(t.feed("i", 500)).toBe("g i");
		expect(t.pending).toBe(false);
	});
	it("drops the chord after the timeout and ignores non-leader first keys", () => {
		const t = new ChordTracker(1000);
		t.feed("g", 0);
		expect(t.feed("i", 2000)).toBeNull();
		expect(t.feed("x", 3000)).toBeNull();
		expect(t.feed("i", 3100)).toBeNull();
	});
	it("every documented chord has a destination", () => {
		for (const d of SHORTCUT_DOCS.filter((x) => x.keys.length === 2)) {
			expect(GO_TO_CHORDS[d.keys.join(" ")]).toBeTruthy();
		}
	});
});

describe("moveSelection", () => {
	const ids = ["a", "b", "c"];
	it("moves and clamps", () => {
		expect(moveSelection(ids, "a", 1)).toBe("b");
		expect(moveSelection(ids, "c", 1)).toBe("c");
		expect(moveSelection(ids, "a", -1)).toBe("a");
	});
	it("starts at the first or last item when nothing is selected", () => {
		expect(moveSelection(ids, null, 1)).toBe("a");
		expect(moveSelection(ids, null, -1)).toBe("c");
		expect(moveSelection(ids, "gone", 1)).toBe("a");
		expect(moveSelection([], null, 1)).toBeNull();
	});
});
