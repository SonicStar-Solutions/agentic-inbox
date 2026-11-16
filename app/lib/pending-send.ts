// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * "Undo send" (#89): holds a send for a short window so it can be cancelled.
 *
 * Framework-free so it is testable. The scheduler outlives the composer (the
 * composer closes as soon as you hit Send), which is why it is a module-level
 * singleton rather than component state.
 */

export const UNDO_SEND_MS = 8000;

export interface PendingSend {
	id: number;
	label: string;
	/** Epoch ms when the send fires. */
	deadline: number;
}

interface Active extends PendingSend {
	run: () => Promise<void>;
	onUndo?: () => void;
	timer: ReturnType<typeof setTimeout>;
}

type Listener = (pending: PendingSend | null) => void;

export class PendingSendScheduler {
	private active: Active | null = null;
	private nextId = 1;
	private listeners = new Set<Listener>();

	constructor(private readonly delayMs: number = UNDO_SEND_MS) {}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	get current(): PendingSend | null {
		return this.active ? { id: this.active.id, label: this.active.label, deadline: this.active.deadline } : null;
	}

	private emit() {
		const c = this.current;
		for (const l of this.listeners) l(c);
	}

	/**
	 * Queue a send. Only one send is held at a time: queueing another one sends
	 * the earlier one immediately, so nothing is ever silently dropped.
	 */
	queue(label: string, run: () => Promise<void>, onUndo?: () => void): number {
		if (this.active) void this.flush();
		const id = this.nextId++;
		const timer = setTimeout(() => void this.fire(id), this.delayMs);
		this.active = { id, label, deadline: Date.now() + this.delayMs, run, onUndo, timer };
		this.emit();
		return id;
	}

	/** Cancel the held send. Returns false if it already went out. */
	undo(): boolean {
		const a = this.active;
		if (!a) return false;
		clearTimeout(a.timer);
		this.active = null;
		this.emit();
		a.onUndo?.();
		return true;
	}

	/** Send the held message now (e.g. the tab is closing or another send is queued). */
	async flush(): Promise<void> {
		if (this.active) await this.fire(this.active.id);
	}

	private async fire(id: number): Promise<void> {
		const a = this.active;
		if (!a || a.id !== id) return;
		clearTimeout(a.timer);
		this.active = null;
		this.emit();
		await a.run();
	}
}

export const pendingSends = new PendingSendScheduler();
