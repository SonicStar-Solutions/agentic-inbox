// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { backoffDelay, keysForScope, parseChange, type ChangeScope } from "~/lib/live";

/**
 * Keep the open mailbox current without waiting for the polling interval (#89).
 * Connects to the mailbox's event socket; each change notification refetches the
 * affected queries. Reconnects with backoff, and the existing polling stays as the
 * fallback if the socket can't connect.
 */
export function useLiveUpdates(mailboxId: string | undefined) {
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!mailboxId || typeof WebSocket === "undefined") return;

		let socket: WebSocket | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let keepAlive: ReturnType<typeof setInterval> | undefined;
		let attempt = 0;
		let stopped = false;
		const pending = new Set<ChangeScope>();
		let flushTimer: ReturnType<typeof setTimeout> | undefined;

		// Several notifications in quick succession (a bulk action) become one refetch.
		const flush = () => {
			flushTimer = undefined;
			const scopes = [...pending];
			pending.clear();
			const scope: ChangeScope = scopes.length === 1 ? scopes[0] : "all";
			for (const queryKey of keysForScope(scope, mailboxId)) queryClient.invalidateQueries({ queryKey });
		};

		const connect = () => {
			if (stopped) return;
			const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
			const ws = new WebSocket(`${proto}//${window.location.host}/api/v1/mailboxes/${encodeURIComponent(mailboxId)}/events`);
			socket = ws;

			ws.onopen = () => {
				attempt = 0;
				keepAlive = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 45_000);
				// Anything that happened while we were disconnected
				queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
			};
			ws.onmessage = (event) => {
				const scope = parseChange(event.data);
				if (!scope) return;
				pending.add(scope);
				flushTimer ??= setTimeout(flush, 250);
			};
			ws.onclose = () => {
				clearInterval(keepAlive);
				if (stopped) return;
				timer = setTimeout(connect, backoffDelay(attempt++));
			};
			ws.onerror = () => ws.close();
		};

		connect();
		return () => {
			stopped = true;
			clearTimeout(timer);
			clearTimeout(flushTimer);
			clearInterval(keepAlive);
			socket?.close();
		};
	}, [mailboxId, queryClient]);
}
