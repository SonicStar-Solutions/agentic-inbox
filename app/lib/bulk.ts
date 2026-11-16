// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Email } from "~/types";

export type BulkAction = "read" | "unread" | "star" | "unstar" | "move" | "delete" | "label" | "unlabel";

export interface BulkRequestBody {
	action: BulkAction;
	ids: string[];
	thread_ids: string[];
	folder?: string;
	folderId?: string;
	labelId?: string;
}

/**
 * Build the bulk request for the selected list rows (#88). A row that stands
 * for a multi-message conversation targets its thread (limited server-side to
 * the folder being viewed); a single message targets its id.
 */
export function buildBulkRequest(
	action: BulkAction,
	rows: Pick<Email, "id" | "thread_id" | "thread_count">[],
	folder: string,
	folderId?: string,
	labelId?: string,
): BulkRequestBody {
	const ids: string[] = [];
	const threadIds: string[] = [];
	for (const row of rows) {
		if (row.thread_id && (row.thread_count ?? 1) > 1) {
			if (!threadIds.includes(row.thread_id)) threadIds.push(row.thread_id);
		} else {
			ids.push(row.id);
		}
	}
	return { action, ids, thread_ids: threadIds, ...(threadIds.length ? { folder } : {}), ...(folderId ? { folderId } : {}), ...(labelId ? { labelId } : {}) };
}
