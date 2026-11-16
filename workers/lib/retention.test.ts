// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeEnv } from "../test-utils";
import {
	DEFAULT_RETENTION_DAYS,
	readDomainSettings,
	resolveRetentionDays,
	retentionCutoff,
	runRetention,
	validateRetentionDays,
} from "./retention";

describe("resolveRetentionDays", () => {
	it("falls back to 30 days when neither the mailbox nor the domain says anything", () => {
		expect(DEFAULT_RETENTION_DAYS).toBe(30);
		expect(resolveRetentionDays({}, {})).toBe(30);
		expect(resolveRetentionDays(undefined, undefined)).toBe(30);
	});

	it("uses the domain default when the mailbox has no setting", () => {
		expect(resolveRetentionDays({}, { retentionDays: 90 })).toBe(90);
		expect(resolveRetentionDays({ retentionDays: null }, { retentionDays: 90 })).toBe(90);
	});

	it("lets the mailbox override the domain", () => {
		expect(resolveRetentionDays({ retentionDays: 7 }, { retentionDays: 90 })).toBe(7);
	});

	it("treats 0 as keep forever, at either level", () => {
		expect(resolveRetentionDays({ retentionDays: 0 }, { retentionDays: 90 })).toBe(0);
		expect(resolveRetentionDays({}, { retentionDays: 0 })).toBe(0);
	});

	it("ignores values that are not whole non-negative numbers", () => {
		expect(resolveRetentionDays({ retentionDays: -3 }, { retentionDays: 90 })).toBe(90);
		expect(resolveRetentionDays({ retentionDays: "7" }, { retentionDays: 90 })).toBe(90);
		expect(resolveRetentionDays({ retentionDays: 2.5 }, { retentionDays: 90 })).toBe(90);
		expect(resolveRetentionDays({}, { retentionDays: "x" })).toBe(30);
	});
});

describe("validateRetentionDays", () => {
	it("accepts whole days from 0 to 3650", () => {
		expect(validateRetentionDays(0)).toBeNull();
		expect(validateRetentionDays(30)).toBeNull();
		expect(validateRetentionDays(3650)).toBeNull();
	});

	it("accepts null only where inheriting is allowed", () => {
		expect(validateRetentionDays(null, { allowNull: true })).toBeNull();
		expect(validateRetentionDays(undefined, { allowNull: true })).toBeNull();
		expect(validateRetentionDays(null)).not.toBeNull();
	});

	it("rejects everything else", () => {
		for (const bad of [-1, 3651, 1.5, "30", NaN, true]) {
			expect(validateRetentionDays(bad as unknown)).toMatch(/retentionDays/);
		}
	});
});

describe("retentionCutoff", () => {
	it("is the instant N days before now, as ISO", () => {
		const now = new Date("2026-11-15T12:00:00.000Z");
		expect(retentionCutoff(30, now)).toBe("2026-10-16T12:00:00.000Z");
	});
});

describe("readDomainSettings", () => {
	it("reads domains/<domain>.json and tolerates a missing or unreadable object", async () => {
		const { env, objects } = makeFakeEnv();
		expect(await readDomainSettings(env.BUCKET, "example.com")).toEqual({});
		objects.set("domains/example.com.json", { retentionDays: 14 });
		expect(await readDomainSettings(env.BUCKET, "example.com")).toEqual({ retentionDays: 14 });
		objects.set("domains/example.com.json", "{not json");
		expect(await readDomainSettings(env.BUCKET, "example.com")).toEqual({});
	});
});

describe("runRetention", () => {
	const now = new Date("2026-11-15T12:00:00.000Z");

	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	it("purges each mailbox with its own resolved retention", async () => {
		const { env, objects } = makeFakeEnv({ mailboxes: ["a@example.com", "b@example.com", "c@other.org"] });
		objects.set("domains/example.com.json", { retentionDays: 90 });
		objects.set("mailboxes/a@example.com.json", { retentionDays: 7 });
		// b inherits the domain's 90; c's domain has no setting so it gets the 30-day default.

		const summary = await runRetention(env, now);

		expect(env.MAILBOX.get("a@example.com").purges).toEqual(["2026-11-08T12:00:00.000Z"]);
		expect(env.MAILBOX.get("b@example.com").purges).toEqual(["2026-08-17T12:00:00.000Z"]);
		expect(env.MAILBOX.get("c@other.org").purges).toEqual(["2026-10-16T12:00:00.000Z"]);
		expect(summary.mailboxes).toBe(3);
	});

	it("skips a mailbox that keeps mail forever", async () => {
		const { env, objects } = makeFakeEnv({ mailboxes: ["a@example.com"] });
		objects.set("mailboxes/a@example.com.json", { retentionDays: 0 });

		await runRetention(env, now);

		expect(env.MAILBOX.get("a@example.com").purges).toEqual([]);
	});

	it("removes the purged messages' attachment blobs from R2 and reports the count", async () => {
		const { env, objects } = makeFakeEnv({ mailboxes: ["a@example.com"] });
		env.MAILBOX.get("a@example.com").purgeResult = {
			deleted: 2,
			attachments: [{ email_id: "e1", id: "att1", filename: "x.pdf" }],
		};
		objects.set("attachments/e1/att1/x.pdf", "bytes");
		objects.set("attachments/other/keep/y.pdf", "bytes");

		const summary = await runRetention(env, now);

		expect(objects.has("attachments/e1/att1/x.pdf")).toBe(false);
		expect(objects.has("attachments/other/keep/y.pdf")).toBe(true);
		expect(summary.deleted).toBe(2);
	});

	it("keeps going when one mailbox fails", async () => {
		const { env } = makeFakeEnv({ mailboxes: ["a@example.com", "b@example.com"] });
		env.MAILBOX.get("a@example.com").purgeError = new Error("boom");
		env.MAILBOX.get("b@example.com").purgeResult = { deleted: 4, attachments: [] };

		const summary = await runRetention(env, now);

		expect(env.MAILBOX.get("b@example.com").purges).toHaveLength(1);
		expect(summary.deleted).toBe(4);
		expect(summary.failed).toBe(1);
		expect(console.error).toHaveBeenCalled();
	});
});
