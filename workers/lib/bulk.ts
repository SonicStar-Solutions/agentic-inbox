// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { z } from "zod";

/** Bulk actions on selected conversations (#88). */
export const BULK_ACTIONS = ["read", "unread", "star", "unstar", "move", "delete", "label", "unlabel"] as const;

export const BulkRequestSchema = z
	.object({
		action: z.enum(BULK_ACTIONS),
		/** Email ids (one per selected row). */
		ids: z.array(z.string().min(1)).max(200).default([]),
		/** thread_id of selected multi-message conversations. */
		thread_ids: z.array(z.string().min(1)).max(200).default([]),
		/** Folder the list is showing; thread targets only affect messages in it. */
		folder: z.string().min(1).optional(),
		/** Destination for action "move". */
		folderId: z.string().min(1).optional(),
		/** The label for actions "label" and "unlabel". */
		labelId: z.string().min(1).optional(),
	})
	.refine((v) => v.ids.length + v.thread_ids.length > 0, { message: "Select at least one conversation" })
	.refine((v) => v.thread_ids.length === 0 || !!v.folder, { message: "folder is required with thread_ids" })
	.refine((v) => v.action !== "move" || !!v.folderId, { message: "folderId is required for move" })
	.refine((v) => (v.action !== "label" && v.action !== "unlabel") || !!v.labelId, { message: "labelId is required to label or unlabel" });

export type BulkRequest = z.infer<typeof BulkRequestSchema>;

/**
 * WHERE clause (positional `?` params) matching the selected rows: the listed
 * email ids, plus every message in the listed threads that sits in the
 * folder being viewed.
 */
export function buildBulkWhere(req: Pick<BulkRequest, "ids" | "thread_ids" | "folder">): { where: string; params: string[] } {
	const parts: string[] = [];
	const params: string[] = [];
	if (req.ids.length > 0) {
		parts.push(`id IN (${req.ids.map(() => "?").join(", ")})`);
		params.push(...req.ids);
	}
	if (req.thread_ids.length > 0 && req.folder) {
		parts.push(
			`(thread_id IN (${req.thread_ids.map(() => "?").join(", ")}) AND folder_id = (SELECT id FROM folders WHERE name = ? OR id = ? LIMIT 1))`,
		);
		params.push(...req.thread_ids, req.folder, req.folder);
	}
	return { where: parts.length ? `(${parts.join(" OR ")})` : "0", params };
}
