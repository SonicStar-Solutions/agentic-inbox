// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The import state machine, kept free of Durable Object and network code so it
 * can be tested with a fake IMAP source. ImportJobDO (../durableObject/importJob.ts)
 * owns storage and alarms and calls `tick()` once per alarm.
 *
 * How a run goes:
 *  1. List the old account's folders, decide each one's destination, and count
 *     messages for the progress bar.
 *  2. Per folder, walk UID windows. Each window's headers are fetched in one
 *     round trip; messages already in the mailbox (by Message-ID) are skipped
 *     without downloading them.
 *  3. Save a cursor per folder after every batch so a later run, or a run
 *     resumed after a crash, continues where this one stopped.
 *
 * Connection problems back off and retry. A rejected password, or anything
 * unexpected, ends the run. A message that cannot be imported is recorded and
 * the run carries on.
 */
import {
	type FolderTarget,
	type ImportFailure,
	type ImportSecurity,
	type ImportJobStatus,
	MAX_IMPORT_SIZE,
	MAX_STORED_FAILURES,
	type SourceFolder,
} from "../../shared/import";
import {
	type FolderStatus,
	ImapAuthError,
	type ImapCredentials,
	ImapCommandError,
	ImapConnectionError,
	type MessageSummary,
} from "./imap/client";
import { folderPriority, isNoSelect, suggestTarget } from "./imap/folders";
import { importMessageKey, parseSummaryHeaders } from "./imap/headers";

export const MESSAGES_PER_TICK = 5; // downloads per alarm tick
export const MAX_OPS_PER_TICK = 300; // messages looked at per tick, downloaded or skipped
export const TICK_BUDGET_MS = 15_000;
export const TICK_DELAY_MS = 250;
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const START_WINDOW = 50;
const MAX_WINDOW = 5_000;

/** The part of ImapClient the engine uses. */
export interface ImportSource {
	list(): Promise<SourceFolder[]>;
	status(path: string): Promise<FolderStatus>;
	examine(path: string): Promise<FolderStatus>;
	countUids(range: string): Promise<number>;
	fetchSummaries(uidSet: string): Promise<MessageSummary[]>;
	fetchBody(uid: number): Promise<Uint8Array>;
	logout(): Promise<void>;
}

export interface EngineDeps {
	connect(creds: ImapCredentials): Promise<ImportSource>;
	hasMessage(messageId: string): Promise<boolean>;
	ensureFolder(name: string): Promise<string>;
	importMessage(
		raw: Uint8Array,
		options: { folder: string; read: boolean; starred: boolean; messageId: string | null },
	): Promise<{ duplicate: boolean }>;
	/** Tell the browser that mail arrived. Called at most once per tick. */
	notify(): Promise<void>;
	now(): number;
}

interface PlanFolder {
	path: string;
	name: string;
	target: string; // a system folder id, or "new:<name>"
	flags: string[];
}

interface CurrentFolder {
	uidValidity: number;
	uidNext: number;
	nextUid: number;
	window: number;
	targetId: string;
	/** Retry runs fetch exactly these UIDs instead of walking a range. */
	retryUids: number[] | null;
}

export interface ImportState {
	status: ImportJobStatus;
	mailboxId: string | null;
	startedBy: string | null;
	/** Holds the password only while the run is active. */
	creds: ImapCredentials | null;
	source: { host: string; port: number; security: ImportSecurity; username: string } | null;
	folderMap: Record<string, FolderTarget>;
	mode: "full" | "retry";
	plan: PlanFolder[] | null;
	folderIndex: number;
	current: CurrentFolder | null;
	totals: { folders: number; messages: number };
	counts: { imported: number; skipped: number; failed: number };
	failures: ImportFailure[];
	failureCount: number;
	/** Failures being retried by this run (retry mode only). */
	retryList: ImportFailure[] | null;
	/** Where the last run stopped, per source account and folder. */
	cursors: Record<string, { uidValidity: number; nextUid: number }>;
	retry: { attempt: number; nextAttemptAt: string } | null;
	error: string | null;
	startedAt: string | null;
	updatedAt: string | null;
	finishedAt: string | null;
}

export function idleState(): ImportState {
	return {
		status: "idle",
		mailboxId: null,
		startedBy: null,
		creds: null,
		source: null,
		folderMap: {},
		mode: "full",
		plan: null,
		folderIndex: 0,
		current: null,
		totals: { folders: 0, messages: 0 },
		counts: { imported: 0, skipped: 0, failed: 0 },
		failures: [],
		failureCount: 0,
		retryList: null,
		cursors: {},
		retry: null,
		error: null,
		startedAt: null,
		updatedAt: null,
		finishedAt: null,
	};
}

function cursorKey(state: ImportState, path: string): string {
	return `${state.source?.host ?? ""}|${(state.source?.username ?? "").toLowerCase()}|${path}`;
}

function reasonOf(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	return msg.replace(/\s+/g, " ").slice(0, 200) || "Unknown error";
}

function addFailure(state: ImportState, f: ImportFailure): void {
	state.counts.failed++;
	state.failureCount++;
	if (state.failures.length < MAX_STORED_FAILURES) state.failures.push(f);
}

/** End the run and drop the password. */
function stop(state: ImportState, status: "done" | "error" | "canceled", now: number, error?: string): void {
	state.status = status;
	state.error = error ?? null;
	state.creds = null;
	state.current = null;
	state.retry = null;
	state.finishedAt = new Date(now).toISOString();
}

/** A run that has not made progress for 24 hours is abandoned. */
export function expireIfStale(state: ImportState, now: number): boolean {
	if (state.status !== "running" || !state.updatedAt) return false;
	if (now - new Date(state.updatedAt).getTime() < STALE_AFTER_MS) return false;
	stop(state, "error", now, "The import stopped making progress and was cancelled.");
	return true;
}

export class ImportEngine {
	private source: ImportSource | null = null;
	/** The folder open on the current connection; reset whenever we reconnect. */
	private selected: string | null = null;

	constructor(private deps: EngineDeps) {}

	/** Close the connection (after cancel, finish or error). */
	async disconnect(): Promise<void> {
		const s = this.source;
		this.source = null;
		this.selected = null;
		if (s) await s.logout().catch(() => {});
	}

	/**
	 * Do one alarm's worth of work. Returns the delay before the next tick, or
	 * null when the run has stopped.
	 */
	async tick(state: ImportState): Promise<number | null> {
		if (state.status !== "running" || !state.creds || !state.mailboxId) return null;
		const startedAt = this.deps.now();
		try {
			await this.step(state, startedAt);
			state.retry = null;
		} catch (e) {
			if (e instanceof ImapAuthError) {
				stop(state, "error", this.deps.now(), e.message);
			} else if (e instanceof ImapConnectionError) {
				this.source = null; // reconnect next time
				this.selected = null;
				const attempt = (state.retry?.attempt ?? 0) + 1;
				if (attempt > BACKOFF_MS.length) {
					stop(state, "error", this.deps.now(), `Lost the connection to the old server. ${reasonOf(e)}`);
				} else {
					const delay = BACKOFF_MS[attempt - 1];
					state.retry = { attempt, nextAttemptAt: new Date(this.deps.now() + delay).toISOString() };
					return delay;
				}
			} else {
				stop(state, "error", this.deps.now(), reasonOf(e));
			}
		}
		if (state.status !== "running") {
			await this.disconnect();
			return null;
		}
		return TICK_DELAY_MS;
	}

	private async connection(state: ImportState): Promise<ImportSource> {
		if (!this.source) {
			this.source = await this.deps.connect(state.creds!);
			this.selected = null;
		}
		return this.source;
	}

	private async step(state: ImportState, startedAt: number): Promise<void> {
		const source = await this.connection(state);

		if (!state.plan) await this.buildPlan(state, source);

		let downloads = 0;
		let ops = 0;
		let importedThisTick = 0;
		const outOfBudget = () =>
			downloads >= MESSAGES_PER_TICK || ops >= MAX_OPS_PER_TICK || this.deps.now() - startedAt > TICK_BUDGET_MS;

		try {
			while (state.status === "running" && !outOfBudget()) {
				if (!state.current) {
					if (state.folderIndex >= state.plan!.length) {
						stop(state, "done", this.deps.now());
						break;
					}
					const opened = await this.openFolder(state, source);
					if (!opened) continue; // folder skipped, move on
				}

				const cur = state.current!;
				const folder = state.plan![state.folderIndex];
				await this.ensureSelected(source, folder, cur);

				let uidSet: string;
				let rangeEnd = 0;
				if (cur.retryUids) {
					if (cur.retryUids.length === 0) {
						this.finishFolder(state, folder, cur);
						continue;
					}
					uidSet = cur.retryUids.slice(0, START_WINDOW).join(",");
				} else {
					if (cur.nextUid >= cur.uidNext) {
						this.finishFolder(state, folder, cur);
						continue;
					}
					rangeEnd = Math.min(cur.nextUid + cur.window - 1, cur.uidNext - 1);
					uidSet = `${cur.nextUid}:${rangeEnd}`;
				}

				const summaries = await source.fetchSummaries(uidSet);
				const requested = cur.retryUids ? cur.retryUids.slice(0, START_WINDOW) : null;

				if (!cur.retryUids) {
					cur.window = summaries.length === 0 ? Math.min(cur.window * 4, MAX_WINDOW) : START_WINDOW;
				}

				let interrupted = false;
				for (const summary of summaries) {
					if (outOfBudget()) {
						interrupted = true;
						break;
					}
					ops++;
					const result = await this.processMessage(state, source, folder, cur, summary);
					if (result === "downloaded") {
						downloads++;
						importedThisTick++;
					}
					this.advance(cur, summary.uid);
				}

				if (!interrupted) {
					if (cur.retryUids) {
						// Requested UIDs the server did not return are gone from the server.
						const seen = new Set(summaries.map((s) => s.uid));
						for (const uid of requested ?? []) {
							if (seen.has(uid)) continue;
							addFailure(state, {
								folder: folder.name,
								path: folder.path,
								uid,
								uidValidity: cur.uidValidity,
								reason: "The message is no longer on the server",
							});
							this.advance(cur, uid);
						}
					} else {
						cur.nextUid = Math.max(cur.nextUid, rangeEnd + 1);
					}
				}
				if (state.mode === "full") {
					state.cursors[cursorKey(state, folder.path)] = { uidValidity: cur.uidValidity, nextUid: cur.nextUid };
				}
			}
		} finally {
			state.updatedAt = new Date(this.deps.now()).toISOString();
			if (importedThisTick > 0) await this.deps.notify().catch(() => {});
		}
	}

	/** After a reconnect the server has no folder open; open it again before fetching. */
	private async ensureSelected(source: ImportSource, folder: PlanFolder, cur: CurrentFolder): Promise<void> {
		if (this.selected === folder.path) return;
		const status = await source.examine(folder.path);
		this.selected = folder.path;
		if (status.uidValidity !== cur.uidValidity) {
			// The server renumbered the folder while we were away. Start it over;
			// Message-ID de-duplication keeps already imported mail from repeating.
			cur.uidValidity = status.uidValidity;
			cur.uidNext = status.uidNext || cur.uidNext;
			cur.nextUid = 1;
			cur.window = START_WINDOW;
		}
	}

	/** Move past a handled message so a retry after a dropped connection does not repeat it. */
	private advance(cur: CurrentFolder, uid: number): void {
		if (cur.retryUids) {
			const i = cur.retryUids.indexOf(uid);
			if (i >= 0) cur.retryUids.splice(i, 1);
		} else {
			cur.nextUid = Math.max(cur.nextUid, uid + 1);
		}
	}

	private finishFolder(state: ImportState, folder: PlanFolder, cur: CurrentFolder): void {
		if (state.mode === "full") {
			state.cursors[cursorKey(state, folder.path)] = { uidValidity: cur.uidValidity, nextUid: cur.uidNext };
		}
		state.current = null;
		state.folderIndex++;
	}

	private async buildPlan(state: ImportState, source: ImportSource): Promise<void> {
		const folders = await source.list();
		const wanted = state.mode === "retry" ? new Set((state.retryList ?? []).map((f) => f.path)) : null;

		const entries: { folder: SourceFolder; target: string }[] = [];
		for (const folder of folders) {
			if (isNoSelect(folder)) continue;
			if (wanted && !wanted.has(folder.path)) continue;
			const target = folder.path in state.folderMap ? state.folderMap[folder.path] : suggestTarget(folder);
			if (target === null || target === undefined) continue;
			entries.push({ folder, target });
		}
		entries.sort((a, b) => folderPriority(a.folder, a.target) - folderPriority(b.folder, b.target));

		state.plan = entries.map(({ folder, target }) => ({
			path: folder.path,
			name: folder.name,
			target,
			flags: folder.flags,
		}));
		state.folderIndex = 0;

		let messages = 0;
		if (state.mode === "retry") {
			messages = (state.retryList ?? []).filter((f) => f.uid > 0).length;
		} else {
			for (const entry of state.plan) {
				try {
					messages += (await source.status(entry.path)).messages;
				} catch (e) {
					if (e instanceof ImapConnectionError) throw e;
					// counted as zero; opening the folder will report the real problem
				}
			}
		}
		state.totals = { folders: state.plan.length, messages };
	}

	/** Open the current plan folder. Returns false if it was skipped. */
	private async openFolder(state: ImportState, source: ImportSource): Promise<boolean> {
		const folder = state.plan![state.folderIndex];
		let status: FolderStatus;
		try {
			status = await source.examine(folder.path);
			this.selected = folder.path;
			if (!status.uidNext) status.uidNext = (await source.status(folder.path)).uidNext;
		} catch (e) {
			if (e instanceof ImapConnectionError) throw e;
			addFailure(state, {
				folder: folder.name,
				path: folder.path,
				uid: 0,
				uidValidity: 0,
				reason: `Could not open this folder: ${reasonOf(e)}`,
			});
			state.folderIndex++;
			return false;
		}

		const targetId = folder.target.startsWith("new:")
			? await this.deps.ensureFolder(folder.target.slice(4))
			: folder.target;

		let nextUid = 1;
		let retryUids: number[] | null = null;

		if (state.mode === "retry") {
			const mine = (state.retryList ?? []).filter((f) => f.path === folder.path && f.uid > 0);
			retryUids = [];
			for (const f of mine) {
				if (f.uidValidity && f.uidValidity !== status.uidValidity) {
					addFailure(state, { ...f, reason: "The folder was rebuilt on the server, so this message cannot be found by number" });
				} else {
					retryUids.push(f.uid);
				}
			}
			retryUids.sort((a, b) => a - b);
		} else {
			const cursor = state.cursors[cursorKey(state, folder.path)];
			if (cursor && cursor.uidValidity === status.uidValidity && cursor.nextUid > 1) {
				nextUid = Math.min(cursor.nextUid, status.uidNext);
				// Messages before the cursor were handled by an earlier run.
				const done = await source.countUids(`1:${nextUid - 1}`);
				state.counts.skipped += done;
			}
		}

		state.current = {
			uidValidity: status.uidValidity,
			uidNext: status.uidNext,
			nextUid,
			window: START_WINDOW,
			targetId,
			retryUids,
		};
		return true;
	}

	private async processMessage(
		state: ImportState,
		source: ImportSource,
		folder: PlanFolder,
		cur: CurrentFolder,
		summary: MessageSummary,
	): Promise<"downloaded" | "skipped" | "failed"> {
		const fail = (reason: string) => {
			addFailure(state, { folder: folder.name, path: folder.path, uid: summary.uid, uidValidity: cur.uidValidity, reason });
			return "failed" as const;
		};

		if (summary.size > MAX_IMPORT_SIZE) {
			return fail(`Larger than ${MAX_IMPORT_SIZE / (1024 * 1024)} MB`);
		}

		const headers = parseSummaryHeaders(summary.header);
		const key = await importMessageKey(headers, summary.size, summary.header !== null);
		if (key && (await this.deps.hasMessage(key))) {
			state.counts.skipped++;
			return "skipped";
		}

		let raw: Uint8Array;
		try {
			raw = await source.fetchBody(summary.uid);
		} catch (e) {
			if (e instanceof ImapConnectionError) throw e;
			return fail(reasonOf(e));
		}

		try {
			const res = await this.deps.importMessage(raw, {
				folder: cur.targetId,
				read: summary.flags.some((f) => f.toLowerCase() === "\\seen"),
				starred: summary.flags.some((f) => f.toLowerCase() === "\\flagged"),
				messageId: key,
			});
			if (res.duplicate) {
				state.counts.skipped++;
				return "skipped";
			}
			state.counts.imported++;
			return "downloaded";
		} catch (e) {
			if (e instanceof ImapCommandError || e instanceof ImapConnectionError) throw e;
			return fail(`Could not store the message: ${reasonOf(e)}`);
		}
	}
}
