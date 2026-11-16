// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LabelColor } from "~/lib/label-colors";
import api from "~/services/api";
import type { Label } from "~/types";

export function useLabels(mailboxId: string | undefined) {
	return useQuery<Label[]>({
		queryKey: ["labels", mailboxId],
		queryFn: () => api.listLabels(mailboxId!),
		enabled: !!mailboxId,
	});
}

function useInvalidateLabels() {
	const qc = useQueryClient();
	return (mailboxId: string) => {
		qc.invalidateQueries({ queryKey: ["labels", mailboxId] });
		qc.invalidateQueries({ queryKey: ["emails", mailboxId] });
	};
}

export function useCreateLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		meta: { handlesOwnError: true }, // the dialog shows the message
		mutationFn: ({ mailboxId, name, color }: { mailboxId: string; name: string; color: LabelColor }) =>
			api.createLabel(mailboxId, name, color),
		onSuccess: (_d, { mailboxId }) => invalidate(mailboxId),
	});
}

export function useDeleteLabel() {
	const invalidate = useInvalidateLabels();
	return useMutation({
		mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) => api.deleteLabel(mailboxId, id),
		onSuccess: (_d, { mailboxId }) => invalidate(mailboxId),
	});
}
