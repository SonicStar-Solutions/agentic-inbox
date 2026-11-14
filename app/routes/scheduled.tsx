// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { ClockIcon } from "@phosphor-icons/react";
import { useParams } from "react-router";
import { useCancelScheduled, useScheduled } from "~/queries/scheduled";

/** Messages waiting to send later, and any that failed (#89). */
export default function ScheduledRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toastManager = useKumoToastManager();
	const { data: items, isLoading, isError, refetch } = useScheduled(mailboxId);
	const cancel = useCancelScheduled();

	const onCancel = (id: string) => {
		if (!mailboxId) return;
		cancel.mutate(
			{ mailboxId, id },
			{ onSuccess: () => toastManager.add({ title: "Scheduled message cancelled" }) },
		);
	};

	return (
		<div className="h-full overflow-y-auto">
			<div className="flex items-center gap-2 px-4 py-3.5 border-b border-kumo-line md:px-5">
				<ClockIcon size={20} className="text-kumo-subtle" />
				<h1 className="text-lg font-semibold text-kumo-default">Scheduled</h1>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Loader size="lg" />
				</div>
			) : isError ? (
				<div role="alert" className="flex flex-col items-center py-24 px-6 text-center">
					<p className="text-sm text-kumo-subtle mb-4">Couldn't load scheduled messages.</p>
					<Button variant="secondary" size="sm" onClick={() => refetch()}>
						Try again
					</Button>
				</div>
			) : !items || items.length === 0 ? (
				<div className="flex flex-col items-center py-24 px-6 text-center">
					<ClockIcon size={48} weight="thin" className="text-kumo-subtle mb-4" />
					<h3 className="text-base font-semibold text-kumo-default mb-1.5">Nothing scheduled</h3>
					<p className="text-sm text-kumo-subtle max-w-xs">Use "Send later" in the composer to send a message at a time you choose.</p>
				</div>
			) : (
				<ul>
					{items.map((item) => (
						<li key={item.id} className="flex items-center gap-3 border-b border-kumo-line px-4 py-3 md:px-5">
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="truncate text-sm font-medium text-kumo-default">To: {item.to}</span>
									{item.status === "failed" && <Badge variant="destructive">Failed</Badge>}
									{item.status === "sending" && <Badge variant="secondary">Sending</Badge>}
								</div>
								<div className="truncate text-sm text-kumo-subtle">{item.subject || "(no subject)"}</div>
								{item.status === "failed" && item.error && (
									<div className="mt-0.5 text-xs text-kumo-destructive">{item.error}</div>
								)}
							</div>
							<span className="shrink-0 text-xs text-kumo-subtle">
								{new Date(item.send_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
							</span>
							<Button
								variant="secondary"
								size="xs"
								disabled={item.status === "sending" || cancel.isPending}
								onClick={() => onCancel(item.id)}
							>
								{item.status === "failed" ? "Dismiss" : "Cancel"}
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
