// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { type PendingSend, pendingSends } from "~/lib/pending-send";

/**
 * Bar shown while a send is being held, with an Undo button (#89). Undo
 * reopens the composer through the callback given when the send was queued.
 */
export default function UndoSendBar() {
	const [pending, setPending] = useState<PendingSend | null>(pendingSends.current);
	const [now, setNow] = useState(Date.now());

	useEffect(() => pendingSends.subscribe(setPending), []);

	useEffect(() => {
		if (!pending) return;
		const t = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(t);
	}, [pending]);

	// Don't lose the message if the tab is closed while it is still held.
	useEffect(() => {
		if (!pending) return;
		const warn = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			e.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [pending]);

	if (!pending) return null;
	const seconds = Math.max(0, Math.ceil((pending.deadline - now) / 1000));

	return (
		<div
			role="status"
			aria-live="polite"
			className="fixed bottom-4 left-4 z-50 flex items-center gap-3 rounded-lg border border-kumo-line bg-kumo-base px-4 py-2.5 shadow-lg"
		>
			<span className="text-sm text-kumo-default">
				Sending {pending.label} in {seconds}s
			</span>
			<Button variant="secondary" size="xs" onClick={() => pendingSends.undo()}>
				Undo
			</Button>
		</div>
	);
}
