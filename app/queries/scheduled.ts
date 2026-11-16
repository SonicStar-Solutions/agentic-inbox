// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";

export interface ScheduledItem {
	id: string;
	kind: "compose" | "reply";
	send_at: string;
	status: "pending" | "sending" | "failed";
	error: string | null;
	to: string;
	subject: string;
}

export function useScheduled(mailboxId: string | undefined) {
	return useQuery<ScheduledItem[]>({
		queryKey: ["scheduled", mailboxId],
		queryFn: () => api.listScheduled(mailboxId!),
		enabled: !!mailboxId,
		refetchInterval: 30_000,
	});
}

export function useScheduleEmail() {
	const qc = useQueryClient();
	return useMutation({
		meta: { handlesOwnError: true }, // the composer shows its own error
		mutationFn: ({ mailboxId, request }: { mailboxId: string; request: unknown }) => api.scheduleEmail(mailboxId, request),
		onSuccess: (_d, { mailboxId }) => qc.invalidateQueries({ queryKey: ["scheduled", mailboxId] }),
	});
}

export function useCancelScheduled() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) => api.cancelScheduled(mailboxId, id),
		onSuccess: (_d, { mailboxId }) => qc.invalidateQueries({ queryKey: ["scheduled", mailboxId] }),
	});
}
