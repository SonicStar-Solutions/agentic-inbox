// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Runs one mailbox's IMAP import as a background job.
 *
 * One instance per target mailbox (keyed by mailboxId). A Workers request
 * cannot stay open for a whole mailbox, so progress is driven by alarm ticks:
 * each tick does a small, bounded batch of work (see ../lib/import-engine.ts)
 * and schedules the next one. Closing the browser does not stop the import.
 *
 * The IMAP password lives only in this object's storage while the run is
 * active. It is deleted the moment the run stops, for any reason (done, error,
 * cancel), and never returned by the API, logged or written anywhere else.
 *
 * Never references EMAIL_AGENT: imported mail cannot trigger an auto-draft or
 * an agent-initiated send.
 */
import { DurableObject } from "cloudflare:workers";
import type { FolderTarget, ImapImportStatus } from "../../shared/import";
import { ImapClient, type ImapCredentials, type ImapSecurity } from "../lib/imap/client";
import { type ImportState, ImportEngine, expireIfStale, idleState } from "../lib/import-engine";
import { importParsedEmail } from "../lib/import-shared";
import type { Env } from "../types";

export interface StartImportInput {
	mailboxId: string;
	startedBy: string | null;
	host: string;
	port: number;
	security: ImapSecurity;
	username: string;
	password: string;
	folderMap: Record<string, FolderTarget>;
}

export class ImportJobDO extends DurableObject<Env> {
	declare __DURABLE_OBJECT_BRAND: never;

	/** The single in-memory copy of the state; storage is its durable mirror. */
	private cache: ImportState | null = null;
	private engine = new ImportEngine({
		connect: (creds) => ImapClient.connect(creds),
		hasMessage: (id) => this.mailbox().hasMessageId(id),
		ensureFolder: (name) => this.mailbox().ensureFolderByName(name),
		importMessage: async (raw, options) => {
			const res = await importParsedEmail(this.env.BUCKET, this.mailbox(), raw, { ...options, silent: true });
			return { duplicate: res.duplicate };
		},
		notify: () => this.mailbox().notifyChanged("all"),
		now: () => Date.now(),
	});

	private mailbox() {
		const id = this.cache?.mailboxId;
		if (!id) throw new Error("No mailbox for this import");
		return this.env.MAILBOX.get(this.env.MAILBOX.idFromName(id));
	}

	private async load(): Promise<ImportState> {
		if (!this.cache) {
			this.cache = (await this.ctx.storage.get<ImportState>("state")) ?? idleState();
		}
		return this.cache;
	}

	private async save(state: ImportState): Promise<void> {
		await this.ctx.storage.put("state", state);
	}

	private toView(state: ImportState): ImapImportStatus {
		return {
			status: state.status,
			source: state.source,
			startedBy: state.startedBy,
			currentFolder: state.status === "running" ? (state.plan?.[state.folderIndex]?.name ?? null) : null,
			totals: state.totals,
			folderIndex: state.folderIndex,
			counts: state.counts,
			failures: state.failures,
			failureCount: state.failureCount,
			error: state.error,
			retry: state.retry,
			startedAt: state.startedAt,
			updatedAt: state.updatedAt,
			finishedAt: state.finishedAt,
		};
	}

	private begin(state: ImportState, creds: ImapCredentials): void {
		const now = new Date().toISOString();
		state.status = "running";
		state.creds = creds;
		state.source = { host: creds.host, port: creds.port, security: creds.security, username: creds.username };
		state.plan = null;
		state.folderIndex = 0;
		state.current = null;
		state.totals = { folders: 0, messages: 0 };
		state.counts = { imported: 0, skipped: 0, failed: 0 };
		state.retry = null;
		state.error = null;
		state.startedAt = now;
		state.updatedAt = now;
		state.finishedAt = null;
	}

	async startImport(input: StartImportInput): Promise<ImapImportStatus> {
		const state = await this.load();
		if (state.status === "running") throw new Error("An import is already running for this mailbox");

		await this.engine.disconnect();
		state.mailboxId = input.mailboxId;
		state.startedBy = input.startedBy;
		state.folderMap = input.folderMap;
		state.mode = "full";
		state.retryList = null;
		// A new import clears the previous run's failure log (cursors stay, so the
		// same account picks up where it left off).
		state.failures = [];
		state.failureCount = 0;
		this.begin(state, {
			host: input.host,
			port: input.port,
			security: input.security,
			username: input.username,
			password: input.password,
		});
		await this.save(state);
		await this.ctx.storage.setAlarm(Date.now());
		console.log("import_started", { mailboxId: input.mailboxId, startedBy: input.startedBy, host: input.host });
		return this.toView(state);
	}

	/** Re-run only the messages that failed last time. Needs the password again. */
	async retryFailed(password: string): Promise<ImapImportStatus> {
		const state = await this.load();
		if (state.status === "running") throw new Error("An import is already running for this mailbox");
		if (!state.source || !state.mailboxId) throw new Error("There is no previous import to retry");
		const retryList = state.failures.filter((f) => f.uid > 0);
		if (retryList.length === 0) throw new Error("There are no failed messages to retry");

		const previous = state.source;
		await this.engine.disconnect();
		state.mode = "retry";
		state.retryList = retryList;
		state.failures = [];
		state.failureCount = 0;
		this.begin(state, {
			host: previous.host,
			port: previous.port,
			security: previous.security,
			username: previous.username,
			password,
		});
		await this.save(state);
		await this.ctx.storage.setAlarm(Date.now());
		return this.toView(state);
	}

	async getStatus(): Promise<ImapImportStatus> {
		const state = await this.load();
		if (expireIfStale(state, Date.now())) {
			await this.engine.disconnect();
			await this.save(state);
		}
		return this.toView(state);
	}

	async cancel(): Promise<ImapImportStatus> {
		const state = await this.load();
		if (state.status === "running") {
			state.status = "canceled";
			state.creds = null; // drop the password immediately
			state.current = null;
			state.retry = null;
			state.finishedAt = new Date().toISOString();
			await this.save(state);
			await this.ctx.storage.deleteAlarm();
		}
		await this.engine.disconnect();
		return this.toView(state);
	}

	async dismissFailures(): Promise<ImapImportStatus> {
		const state = await this.load();
		state.failures = [];
		state.failureCount = 0;
		await this.save(state);
		return this.toView(state);
	}

	async alarm(): Promise<void> {
		const state = await this.load();
		if (expireIfStale(state, Date.now())) {
			await this.engine.disconnect();
			await this.save(state);
			return;
		}
		const delay = await this.engine.tick(state);
		await this.save(state);
		if (delay !== null && state.status === "running") {
			await this.ctx.storage.setAlarm(Date.now() + delay);
		}
	}
}
