// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useKumoToastManager } from "@cloudflare/kumo";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

declare module "@tanstack/react-query" {
	interface Register {
		mutationMeta: {
			/** The caller shows its own error UI (mutateAsync + try/catch). */
			handlesOwnError?: boolean;
		};
	}
}

/**
 * Shows an error toast whenever a mutation fails, so a failed move, delete,
 * star or mark-read no longer looks like a silent no-op (#19). Mutations that
 * report their own errors opt out with `meta: { handlesOwnError: true }`.
 */
export default function MutationErrorToasts() {
	const queryClient = useQueryClient();
	const toastManager = useKumoToastManager();

	useEffect(() => {
		return queryClient.getMutationCache().subscribe((event) => {
			if (event.type !== "updated" || event.action.type !== "error") return;
			if (event.mutation.options.meta?.handlesOwnError) return;
			const error = event.action.error;
			const message = error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
			toastManager.add({ title: message, variant: "error" });
		});
	}, [queryClient, toastManager]);

	return null;
}
