// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PendingSendScheduler } from "./pending-send";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PendingSendScheduler (#89 undo send)", () => {
	it("sends after the delay", async () => {
		const s = new PendingSendScheduler(8000);
		const run = vi.fn(async () => {});
		s.queue("to dave", run);
		expect(s.current?.label).toBe("to dave");
		await vi.advanceTimersByTimeAsync(7999);
		expect(run).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(run).toHaveBeenCalledOnce();
		expect(s.current).toBeNull();
	});

	it("undo cancels the send", async () => {
		const s = new PendingSendScheduler(8000);
		const run = vi.fn(async () => {});
		s.queue("x", run);
		expect(s.undo()).toBe(true);
		await vi.advanceTimersByTimeAsync(20000);
		expect(run).not.toHaveBeenCalled();
		expect(s.undo()).toBe(false);
	});

	it("undo runs the restore callback", async () => {
		const s = new PendingSendScheduler(8000);
		const onUndo = vi.fn();
		s.queue("x", async () => {}, onUndo);
		s.undo();
		expect(onUndo).toHaveBeenCalledOnce();
	});

	it("queueing a second send flushes the first immediately", async () => {
		const s = new PendingSendScheduler(8000);
		const first = vi.fn(async () => {});
		const second = vi.fn(async () => {});
		s.queue("one", first);
		s.queue("two", second);
		await vi.advanceTimersByTimeAsync(0);
		expect(first).toHaveBeenCalledOnce();
		expect(second).not.toHaveBeenCalled();
		expect(s.current?.label).toBe("two");
	});

	it("flush sends right away and only once", async () => {
		const s = new PendingSendScheduler(8000);
		const run = vi.fn(async () => {});
		s.queue("x", run);
		await s.flush();
		await vi.advanceTimersByTimeAsync(20000);
		expect(run).toHaveBeenCalledOnce();
	});

	it("notifies subscribers", async () => {
		const s = new PendingSendScheduler(1000);
		const seen: (string | null)[] = [];
		s.subscribe((p) => seen.push(p?.label ?? null));
		s.queue("m", async () => {});
		await vi.advanceTimersByTimeAsync(1000);
		expect(seen).toEqual(["m", null]);
	});
});
