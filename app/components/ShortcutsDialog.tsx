// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog } from "@cloudflare/kumo";
import { useUIStore } from "~/hooks/useUIStore";
import { SHORTCUT_DOCS } from "~/lib/shortcuts";

const GROUPS = ["Navigation", "Conversations", "General"] as const;

/** Help dialog listing every keyboard shortcut (#89). Opened with "?". */
export default function ShortcutsDialog() {
	const open = useUIStore((s) => s.isShortcutsOpen);
	const toggle = useUIStore((s) => s.toggleShortcuts);

	return (
		<Dialog.Root open={open} onOpenChange={(next) => next !== open && toggle()}>
			<Dialog size="lg" className="p-6 max-h-[85vh] overflow-y-auto">
				<Dialog.Title className="text-lg font-semibold mb-4">Keyboard shortcuts</Dialog.Title>
				<div className="grid gap-6 sm:grid-cols-2">
					{GROUPS.map((group) => (
						<section key={group}>
							<h3 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle mb-2">{group}</h3>
							<ul className="space-y-1.5">
								{SHORTCUT_DOCS.filter((s) => s.group === group).map((s) => (
									<li key={s.description} className="flex items-center justify-between gap-3 text-sm">
										<span className="text-kumo-default">{s.description}</span>
										<span className="flex shrink-0 items-center gap-1">
											{s.keys.map((k, i) => (
												<span key={`${k}-${i}`} className="flex items-center gap-1">
													{i > 0 && <span className="text-xs text-kumo-subtle">then</span>}
													<kbd className="rounded border border-kumo-line bg-kumo-tint px-1.5 py-0.5 font-mono text-xs text-kumo-default">{k}</kbd>
												</span>
											))}
										</span>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
				<div className="mt-6 flex justify-end">
					<Dialog.Close>
						<Button variant="primary" size="sm">
							Close
						</Button>
					</Dialog.Close>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
