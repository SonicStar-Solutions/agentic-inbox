// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import api from "~/services/api";

export interface ContactSuggestion {
	address: string;
	count: number;
	last: string;
}

function useDebounced<T>(value: T, ms: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return debounced;
}

/** Past correspondents matching what is being typed (debounced). */
export function useContactSuggestions(mailboxId: string | undefined, token: string, enabled: boolean) {
	const q = useDebounced(token, 150);
	return useQuery<ContactSuggestion[]>({
		queryKey: ["contacts", mailboxId, q],
		queryFn: () => api.getContacts(mailboxId!, q),
		enabled: enabled && !!mailboxId && q.length > 0,
		staleTime: 60_000,
		placeholderData: (prev) => prev,
	});
}
