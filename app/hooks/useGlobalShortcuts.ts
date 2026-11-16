// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useUIStore } from "~/hooks/useUIStore";
import { ChordTracker, GO_TO_CHORDS, shouldHandleKey } from "~/lib/shortcuts";

/** Shortcuts that work anywhere in a mailbox: compose, search, help, close, go-to (#89). */
export function useGlobalShortcuts() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const startCompose = useUIStore((s) => s.startCompose);
	const closePanel = useUIStore((s) => s.closePanel);
	const toggleShortcuts = useUIStore((s) => s.toggleShortcuts);

	useEffect(() => {
		const chords = new ChordTracker();
		const onKey = (e: KeyboardEvent) => {
			if (!shouldHandleKey(e)) return;

			const chord = chords.feed(e.key, Date.now());
			if (chord) {
				const dest = GO_TO_CHORDS[chord];
				if (dest && mailboxId) {
					e.preventDefault();
					navigate(`/mailbox/${mailboxId}/${dest}`);
				}
				return;
			}
			if (chords.pending) return; // waiting for the second key of "g _"

			switch (e.key) {
				case "c":
					e.preventDefault();
					startCompose();
					break;
				case "/": {
					const search = document.querySelector<HTMLInputElement>('input[aria-label="Search emails"]');
					if (search) {
						e.preventDefault();
						search.focus();
						search.select();
					}
					break;
				}
				case "?":
					e.preventDefault();
					toggleShortcuts();
					break;
				case "Escape": {
					const { selectedEmailId, isComposing } = useUIStore.getState();
					if (selectedEmailId && !isComposing) closePanel();
					break;
				}
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [mailboxId, navigate, startCompose, closePanel, toggleShortcuts]);
}
