// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Keyboard shortcuts (#89): the key map for the help dialog, and the helpers behind it. */

export interface ShortcutDoc {
	group: "Navigation" | "Conversations" | "General";
	keys: string[];
	description: string;
}

export const SHORTCUT_DOCS: ShortcutDoc[] = [
	{ group: "Navigation", keys: ["j"], description: "Next conversation" },
	{ group: "Navigation", keys: ["k"], description: "Previous conversation" },
	{ group: "Navigation", keys: ["g", "i"], description: "Go to Inbox" },
	{ group: "Navigation", keys: ["g", "s"], description: "Go to Sent" },
	{ group: "Navigation", keys: ["g", "d"], description: "Go to Drafts" },
	{ group: "Navigation", keys: ["g", "a"], description: "Go to Archive" },
	{ group: "Navigation", keys: ["g", "t"], description: "Go to Trash" },
	{ group: "Navigation", keys: ["g", "l"], description: "Go to Scheduled" },
	{ group: "Conversations", keys: ["x"], description: "Select / deselect the open conversation" },
	{ group: "Conversations", keys: ["e"], description: "Archive (selected, or the open conversation)" },
	{ group: "Conversations", keys: ["#"], description: "Delete (move to Trash)" },
	{ group: "Conversations", keys: ["s"], description: "Star / unstar" },
	{ group: "Conversations", keys: ["u"], description: "Mark as unread" },
	{ group: "General", keys: ["c"], description: "Compose a new message" },
	{ group: "General", keys: ["/"], description: "Search" },
	{ group: "General", keys: ["Esc"], description: "Close the open message" },
	{ group: "General", keys: ["?"], description: "Show this help" },
];

/** True when the event target is somewhere you type, so shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el || typeof el.tagName !== "string") return false;
	const tag = el.tagName.toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	return el.isContentEditable === true || !!el.closest?.("[contenteditable='true'], .ProseMirror");
}

/** Whether a key event may trigger a shortcut at all. */
export function shouldHandleKey(e: Pick<KeyboardEvent, "defaultPrevented" | "ctrlKey" | "metaKey" | "altKey" | "target">): boolean {
	if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return false;
	if (isTypingTarget(e.target)) return false;
	// A dialog or menu is capturing the keyboard.
	if (typeof document !== "undefined" && document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
	return true;
}

/** Recognises two-key chords such as "g i": the second key must follow within `timeoutMs`. */
export class ChordTracker {
	private first: string | null = null;
	private at = 0;

	constructor(private readonly timeoutMs = 1000, private readonly leaders: string[] = ["g"]) {}

	/** Feed a key. Returns the completed chord ("g i"), or null. */
	feed(key: string, now: number): string | null {
		if (this.first && now - this.at <= this.timeoutMs) {
			const chord = `${this.first} ${key}`;
			this.first = null;
			return chord;
		}
		this.first = this.leaders.includes(key) ? key : null;
		this.at = now;
		return null;
	}

	/** True while a leader key is waiting for its second key. */
	get pending(): boolean {
		return this.first !== null;
	}
}

/** The id to select after moving by `delta` from `current` (clamped; first/last when nothing is selected). */
export function moveSelection(ids: string[], current: string | null, delta: 1 | -1): string | null {
	if (ids.length === 0) return null;
	const i = current ? ids.indexOf(current) : -1;
	if (i < 0) return delta === 1 ? ids[0] : ids[ids.length - 1];
	return ids[Math.min(Math.max(i + delta, 0), ids.length - 1)];
}

/** Where each "g <key>" chord goes, relative to the mailbox. */
export const GO_TO_CHORDS: Record<string, string> = {
	"g i": "emails/inbox",
	"g s": "emails/sent",
	"g d": "emails/draft",
	"g a": "emails/archive",
	"g t": "emails/trash",
	"g l": "scheduled",
};
