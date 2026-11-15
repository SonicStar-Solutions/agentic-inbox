// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ImapImportStatus } from "shared/import";
import api, { type ImapConnection } from "~/services/api";
import type { FolderTarget } from "shared/import";
import { queryKeys } from "./keys";

export function useImapImportStatus(mailboxId: string | undefined) {
	return useQuery<ImapImportStatus>({
		queryKey: mailboxId ? queryKeys.imapImport.status(mailboxId) : ["imapImport", "_disabled"],
		queryFn: () => api.getImapImportStatus(mailboxId!),
		enabled: !!mailboxId,
		// Poll while an import is running; the browser pauses it in a hidden tab.
		refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
	});
}

/** Sign in and list the folders; imports nothing. The caller shows the error. */
export function useProbeImap() {
	return useMutation({
		meta: { handlesOwnError: true },
		mutationFn: ({ mailboxId, conn }: { mailboxId: string; conn: ImapConnection }) => api.probeImap(mailboxId, conn),
	});
}

function useStatusMutation<V>(fn: (vars: V) => Promise<ImapImportStatus>, mailboxOf: (vars: V) => string, handlesOwnError = false) {
	const qc = useQueryClient();
	return useMutation({
		meta: { handlesOwnError },
		mutationFn: fn,
		onSuccess: (data, vars) => {
			qc.setQueryData(queryKeys.imapImport.status(mailboxOf(vars)), data);
		},
	});
}

export function useStartImapImport() {
	return useStatusMutation(
		({ mailboxId, conn, folderMap }: { mailboxId: string; conn: ImapConnection; folderMap: Record<string, FolderTarget> }) =>
			api.startImapImport(mailboxId, { ...conn, folderMap }),
		(v) => v.mailboxId,
		true,
	);
}

export function useCancelImapImport() {
	return useStatusMutation((mailboxId: string) => api.cancelImapImport(mailboxId), (id) => id);
}

export function useRetryFailedImport() {
	return useStatusMutation(
		({ mailboxId, password }: { mailboxId: string; password: string }) => api.retryFailedImport(mailboxId, password),
		(v) => v.mailboxId,
		true,
	);
}

export function useDismissImportFailures() {
	return useStatusMutation((mailboxId: string) => api.dismissImportFailures(mailboxId), (id) => id);
}
