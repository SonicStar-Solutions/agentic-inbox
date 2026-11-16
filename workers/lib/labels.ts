// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { z } from "zod";

/** Labels (#89): coloured tags a message can carry any number of. */

export const LABEL_COLORS = ["slate", "red", "orange", "amber", "green", "teal", "blue", "purple"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export const MAX_LABELS = 100;

export const LabelInputSchema = z.object({
	name: z
		.string()
		.transform((s) => s.trim())
		.pipe(z.string().min(1, "Label name is required").max(30, "Label names can be at most 30 characters")),
	color: z.enum(LABEL_COLORS).default("slate"),
});

export const LabelUpdateSchema = z
	.object({
		name: LabelInputSchema.shape.name.optional(),
		color: z.enum(LABEL_COLORS).optional(),
	})
	.refine((v) => v.name !== undefined || v.color !== undefined, { message: "Nothing to update" });

export interface Label {
	id: string;
	name: string;
	color: LabelColor;
}

export interface LabelWithCount extends Label {
	count: number;
}

/** A URL-safe id from a label name, e.g. "Client Work!" -> "client-work". */
export function labelIdFromName(name: string): string {
	return (
		name
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "label"
	);
}

/** Attach each row's labels. `byThread` is keyed by thread_id, `byEmail` by email id. */
export function attachLabels<T extends { id: string; thread_id?: string | null }>(
	rows: T[],
	byEmail: Map<string, Label[]>,
	byThread: Map<string, Label[]>,
): (T & { labels: Label[] })[] {
	return rows.map((row) => {
		const merged = new Map<string, Label>();
		for (const l of byEmail.get(row.id) ?? []) merged.set(l.id, l);
		if (row.thread_id) for (const l of byThread.get(row.thread_id) ?? []) merged.set(l.id, l);
		return { ...row, labels: [...merged.values()] };
	});
}
