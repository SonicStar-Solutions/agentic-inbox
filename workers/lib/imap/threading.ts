// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Subject-based threading for imported mail.
 *
 * Live mail only groups by subject within the last 7 days, which is useless for
 * an archive. Imported messages that carry no In-Reply-To / References headers
 * are grouped by normalized subject only when it is safe to:
 *  - the subject is not empty or a generic one ("Hello", "Invoice", ...),
 *  - the candidate thread shares a participant with the message, and
 *  - the message is within 30 days of the thread's latest message.
 */

export const SUBJECT_THREAD_GAP_MS = 30 * 24 * 60 * 60 * 1000;

const PREFIX = /^(?:(?:re|fwd?|fw|aw|wg|r[eé]f|sv|vs|antw)\s*:\s*)+/i;

const GENERIC_SUBJECTS = new Set([
	"hello",
	"hi",
	"hey",
	"test",
	"testing",
	"question",
	"questions",
	"thanks",
	"thank you",
	"invoice",
	"receipt",
	"order",
	"update",
	"updates",
	"reminder",
	"meeting",
	"info",
	"information",
	"help",
	"fwd",
	"(no subject)",
	"no subject",
	"(kein betreff)",
	"newsletter",
	"notification",
	"alert",
	"security alert",
	"your order",
	"your receipt",
	"your invoice",
	"welcome",
]);

export function normalizeSubject(subject: string): string {
	return subject.replace(PREFIX, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isGenericSubject(normalized: string): boolean {
	return normalized.length < 4 || GENERIC_SUBJECTS.has(normalized);
}

export interface ThreadCandidate {
	thread_id: string;
	subject: string | null;
	sender: string | null;
	recipient: string | null;
	date: string;
}

function addresses(...fields: (string | null | undefined)[]): Set<string> {
	const out = new Set<string>();
	for (const f of fields) {
		for (const part of (f ?? "").split(",")) {
			const a = part.trim().toLowerCase();
			if (a) out.add(a);
		}
	}
	return out;
}

/**
 * Pick the thread to join, or null to start a new one. `candidates` are stored
 * messages whose subject might match; this applies the safety rules.
 */
export function pickImportThread(
	candidates: ThreadCandidate[],
	message: { subject: string; sender: string; recipient: string | null; date: string },
): string | null {
	const normalized = normalizeSubject(message.subject);
	if (isGenericSubject(normalized)) return null;

	const msgTime = new Date(message.date).getTime();
	if (Number.isNaN(msgTime)) return null;
	const msgPeople = addresses(message.sender, message.recipient);

	// Group candidates by thread, keeping each thread's latest date and participants.
	const threads = new Map<string, { latest: number; people: Set<string> }>();
	for (const c of candidates) {
		if (normalizeSubject(c.subject ?? "") !== normalized) continue;
		const t = new Date(c.date).getTime();
		if (Number.isNaN(t)) continue;
		const entry = threads.get(c.thread_id) ?? { latest: 0, people: new Set<string>() };
		entry.latest = Math.max(entry.latest, t);
		for (const p of addresses(c.sender, c.recipient)) entry.people.add(p);
		threads.set(c.thread_id, entry);
	}

	let best: { id: string; latest: number } | null = null;
	for (const [id, info] of threads) {
		if (Math.abs(msgTime - info.latest) > SUBJECT_THREAD_GAP_MS) continue;
		const shares = [...msgPeople].some((p) => info.people.has(p));
		if (!shares) continue;
		if (!best || info.latest > best.latest) best = { id, latest: info.latest };
	}
	return best?.id ?? null;
}
