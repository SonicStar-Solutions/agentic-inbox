// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Pagination, Tooltip, useKumoToastManager } from "@cloudflare/kumo";
import {
	ArchiveIcon,
	ArrowsClockwiseIcon,
	EnvelopeSimpleIcon,
	FileIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	TrashIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { Folders } from "shared/folders";
import BulkToolbar from "~/components/BulkToolbar";
import DayHeader from "~/components/airmail/DayHeader";
import EmailRow, { hasUnread } from "~/components/EmailRow";
import { groupByDay } from "~/lib/day-groups";
import { useMailbox } from "~/queries/mailboxes";
import { useLabels } from "~/queries/labels";
import MailboxSplitView from "~/components/MailboxSplitView";
import { buildBulkRequest, type BulkAction } from "~/lib/bulk";
import { moveSelection, shouldHandleKey } from "~/lib/shortcuts";
import {
	useBulkAction,
	useDeleteEmail,
	useEmails,
	useMarkThreadRead,
	useUpdateEmail,
} from "~/queries/emails";
import { useFolders } from "~/queries/folders";
import { queryKeys } from "~/queries/keys";
import { useUIStore } from "~/hooks/useUIStore";
import type { Email } from "~/types";

const PAGE_SIZE = 25;

const FOLDER_EMPTY_STATES: Record<
	string,
	{
		icon: React.ReactNode;
		title: string;
		description: string;
		showCompose?: boolean;
	}
> = {
	[Folders.INBOX]: {
		icon: <TrayIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Your inbox is empty",
		description:
			"New emails will appear here when they arrive. Send an email to get the conversation started.",
		showCompose: true,
	},
	[Folders.SENT]: {
		icon: (
			<PaperPlaneTiltIcon size={48} weight="thin" className="text-kumo-subtle" />
		),
		title: "No sent emails",
		description: "Emails you send will show up here.",
		showCompose: true,
	},
	[Folders.DRAFT]: {
		icon: <FileIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "No drafts",
		description: "Emails you're still working on will be saved here.",
		showCompose: true,
	},
	[Folders.ARCHIVE]: {
		icon: <ArchiveIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Archive is empty",
		description:
			"Move emails here to keep your inbox clean without deleting them.",
	},
	[Folders.TRASH]: {
		icon: <TrashIcon size={48} weight="thin" className="text-kumo-subtle" />,
		title: "Trash is empty",
		description:
			"Deleted emails will appear here. You can restore them or permanently delete them.",
	},
};

function EmailListSkeleton() {
	return (
		<div className="animate-pulse" aria-hidden="true">
			{Array.from({ length: 8 }).map((_, i) => (
				<div key={i} className="relative flex gap-4 px-4 py-3 after:absolute after:bottom-0 after:left-[72px] after:right-0 after:h-px after:bg-kumo-line">
					<div className="h-10 w-10 shrink-0 rounded-full bg-kumo-fill" />
					<div className="flex-1 space-y-2 pt-0.5">
						<div className="flex items-center gap-2">
							<div className="h-3.5 w-28 rounded bg-kumo-fill" />
							<div className="ml-auto h-3 w-10 rounded bg-kumo-fill" />
						</div>
						<div className="h-3 w-3/4 rounded bg-kumo-fill" />
						<div className="h-2.5 w-2/3 rounded bg-kumo-fill" />
					</div>
				</div>
			))}
		</div>
	);
}

function FolderEmptyState({
	folder,
	onCompose,
}: {
	folder?: string;
	onCompose: () => void;
}) {
	const config = (folder && FOLDER_EMPTY_STATES[folder]) || {
		icon: (
			<EnvelopeSimpleIcon size={48} weight="thin" className="text-kumo-subtle" />
		),
		title: "No emails",
		description: "This folder is empty.",
	};

	return (
		<div className="flex flex-col items-center justify-center py-24 px-6 text-center">
			<div className="mb-4">{config.icon}</div>
			<h3 className="text-base font-semibold text-kumo-default mb-1.5">
				{config.title}
			</h3>
			<p className="text-sm text-kumo-subtle max-w-xs mb-5">
				{config.description}
			</p>
			{"showCompose" in config && config.showCompose && (
				<Button
					variant="primary"
					size="sm"
					icon={<PencilSimpleIcon size={16} />}
					onClick={onCompose}
				>
					Compose
				</Button>
			)}
		</div>
	);
}

export default function EmailListRoute() {
	const { mailboxId, folder, labelId } = useParams<{
		mailboxId: string;
		folder: string;
		labelId: string;
	}>();
	const {
		selectedEmailId,
		isComposing,
		selectEmail,
		closePanel,
		startCompose,
	} = useUIStore();
	const [page, setPage] = useState(1);

	const queryClient = useQueryClient();
	const updateEmail = useUpdateEmail();
	const markThreadRead = useMarkThreadRead();
	const deleteEmail = useDeleteEmail();
	const bulk = useBulkAction();
	const toastManager = useKumoToastManager();
	// Selected list rows by email id (#88)
	const [selected, setSelected] = useState<Map<string, Email>>(new Map());

	// The same list serves folders and, at /label/:labelId, a label's messages (#89).
	const params = useMemo(() => {
		const p: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) };
		if (labelId) p.label = labelId;
		else p.folder = folder || "";
		return p;
	}, [folder, labelId, page]);

	const {
		data: emailData,
		isFetching: isRefreshing,
		isError: isListError,
		error: listError,
		refetch: refetchList,
	} = useEmails(mailboxId, params, { refetchInterval: 30_000 });

	const emails = emailData?.emails ?? [];
	const totalCount = emailData?.totalCount ?? 0;

	const { data: mailbox } = useMailbox(mailboxId);
	const dayGroups = useMemo(() => groupByDay(emails, (e) => e.date), [emails]);
	const { data: folders = [] } = useFolders(mailboxId);
	const { data: labels = [] } = useLabels(mailboxId);

	const folderName = useMemo(() => {
		if (labelId) return labels.find((l) => l.id === labelId)?.name ?? "Label";
		const found = folders.find((f) => f.id === folder);
		if (found) return found.name;
		return folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : "Inbox";
	}, [folders, labels, folder, labelId]);

	// Selection only makes sense for the rows on screen: drop it on folder or
	// page change, and prune rows that disappeared (moved, deleted, refetched).
	useEffect(() => {
		setSelected((prev) => {
			if (prev.size === 0) return prev;
			const visible = new Set(emails.map((e) => e.id));
			const next = new Map([...prev].filter(([id]) => visible.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [emails]);
	useEffect(() => setSelected(new Map()), [mailboxId, folder, labelId, page]);

	const toggleSelected = (email: Email) =>
		setSelected((prev) => {
			const next = new Map(prev);
			if (next.has(email.id)) next.delete(email.id);
			else next.set(email.id, email);
			return next;
		});
	const allSelected = emails.length > 0 && selected.size === emails.length;
	const toggleAll = () => setSelected(allSelected ? new Map() : new Map(emails.map((e) => [e.id, e])));

	const inTrash = folder === Folders.TRASH;
	const runBulk = (action: BulkAction, folderId?: string, rowsOverride?: Email[]) => {
		const rows = rowsOverride ?? [...selected.values()];
		if (!mailboxId || rows.length === 0) return;
		let effective: BulkAction = action;
		const isLabelAction = action === "label" || action === "unlabel";
		// For label actions the second argument is the label id
		let destination = isLabelAction ? undefined : folderId;
		if (action === "delete") {
			if (inTrash) {
				if (!window.confirm(`Permanently delete ${rows.length} conversation${rows.length === 1 ? "" : "s"}? This cannot be undone.`)) return;
			} else {
				effective = "move";
				destination = Folders.TRASH;
			}
		}
		bulk.mutate(
			{ mailboxId, request: buildBulkRequest(effective, rows, folder || Folders.INBOX, destination, isLabelAction ? folderId : undefined) },
			{
				onSuccess: () => {
					if (selectedEmailId && rows.some((r) => r.id === selectedEmailId) && (effective === "move" || effective === "delete")) closePanel();
					setSelected(new Map());
					toastManager.add({ title: `${rows.length} conversation${rows.length === 1 ? "" : "s"} updated` });
				},
			},
		);
	};

	// Track folder identity to detect folder changes vs page changes
	const prevFolderRef = useRef<string | undefined>(undefined);

	useEffect(() => {
		const folderChanged = prevFolderRef.current !== `${mailboxId}/${folder}`;
		prevFolderRef.current = `${mailboxId}/${folder}`;

		if (folderChanged) {
			closePanel();
			setPage(1);
		}
	}, [mailboxId, folder, closePanel]);

	// List shortcuts (#89): j/k move through conversations, x selects, e archives,
	// # deletes, s stars, u marks unread. They act on the selected rows, or on the
	// open conversation when nothing is ticked.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (!shouldHandleKey(e) || isComposing) return;
			const current = emails.find((m) => m.id === selectedEmailId) ?? null;
			const target = (): Email[] => (selected.size > 0 ? [...selected.values()] : current ? [current] : []);

			switch (e.key) {
				case "j":
				case "k": {
					const next = moveSelection(emails.map((m) => m.id), selectedEmailId, e.key === "j" ? 1 : -1);
					const row = emails.find((m) => m.id === next);
					if (row) {
						e.preventDefault();
						handleRowClick(row);
						document.querySelector(`[data-email-id="${row.id}"]`)?.scrollIntoView({ block: "nearest" });
					}
					break;
				}
				case "x":
					if (current) {
						e.preventDefault();
						toggleSelected(current);
					}
					break;
				case "e":
					if (folder !== Folders.ARCHIVE && target().length > 0) {
						e.preventDefault();
						runBulk("move", Folders.ARCHIVE, target());
					}
					break;
				case "#":
					if (target().length > 0) {
						e.preventDefault();
						runBulk("delete", undefined, target());
					}
					break;
				case "s":
					if (current && mailboxId) {
						e.preventDefault();
						updateEmail.mutate({ mailboxId, id: current.id, data: { starred: !current.starred } });
					}
					break;
				case "u":
					if (current && mailboxId) {
						e.preventDefault();
						updateEmail.mutate({ mailboxId, id: current.id, data: { read: false } });
					}
					break;
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	});

	const handleRefresh = () => {
		if (mailboxId) {
			queryClient.invalidateQueries({ queryKey: ["emails", mailboxId] });
			queryClient.invalidateQueries({
				queryKey: queryKeys.folders.list(mailboxId),
			});
		}
	};

	const handleRowClick = (email: Email) => {
		selectEmail(email.id);
		if (mailboxId && hasUnread(email)) {
			if (email.thread_id && email.thread_count && email.thread_count > 1) {
				markThreadRead.mutate({
					mailboxId,
					threadId: email.thread_id,
				});
			} else {
				updateEmail.mutate({
					mailboxId,
					id: email.id,
					data: { read: true },
				});
			}
		}
	};

	return (
		<MailboxSplitView
			selectedEmailId={selectedEmailId}
			isComposing={isComposing}
		>
				{/* Folder header, or the bulk toolbar while rows are selected */}
				{selected.size > 0 ? (
					<BulkToolbar
						count={selected.size}
						allSelected={allSelected}
						onToggleAll={toggleAll}
						onClear={() => setSelected(new Map())}
						onAction={runBulk}
						moveTargets={folders.filter((f) => f.id !== folder && f.id !== Folders.DRAFT && f.id !== Folders.SENT).map((f) => ({ id: f.id, name: f.name }))}
						canArchive={folder !== Folders.ARCHIVE}
						inTrash={inTrash}
						busy={bulk.isPending}
						labels={labels.map((l) => ({ id: l.id, name: l.name }))}
					/>
				) : (

				<div className="flex items-center justify-between px-4 py-3 border-b border-kumo-line shrink-0">
					<h1 className="text-[22px] font-semibold leading-7 text-kumo-brand">
						{folderName}
					</h1>
					<div className="flex items-center gap-1">
						{totalCount > 0 && (
							<span className="text-sm text-kumo-subtle mr-2 hidden sm:inline">
								{totalCount} conversation{totalCount !== 1 ? "s" : ""}
							</span>
						)}
						<Tooltip
							content={isRefreshing ? "Refreshing..." : "Refresh"}
							side="bottom"
							asChild
						>
							<Button
								variant="ghost"
								shape="square"
								size="sm"
								icon={
									<ArrowsClockwiseIcon
										size={18}
										className={isRefreshing ? "animate-spin" : ""}
									/>
								}
								onClick={handleRefresh}
								disabled={isRefreshing}
								aria-label="Refresh"
							/>
						</Tooltip>
					</div>
				</div>
				)}

				{/* Email rows */}
				<div className="flex-1 overflow-y-auto">
				{isRefreshing && emails.length === 0 ? (
					<EmailListSkeleton />
				) : isListError && emails.length === 0 ? (
					<div role="alert" className="flex flex-col items-center justify-center py-24 px-6 text-center">
						<h3 className="text-base font-semibold text-kumo-default mb-1.5">Couldn't load emails</h3>
						<p className="text-sm text-kumo-subtle max-w-xs mb-4">{listError instanceof Error && listError.message ? listError.message : "Something went wrong while loading this folder."}</p>
						<Button variant="secondary" size="sm" onClick={() => refetchList()}>Try again</Button>
					</div>
				) : emails.length > 0 ? (
						<div>
							{dayGroups.map((group) => (
								<section key={group.key} aria-label={group.label}>
									<DayHeader date={group.date} label={group.label} unread={group.items.filter(hasUnread).length} />
									{group.items.map((email) => (
										<EmailRow
											key={email.id}
											email={email}
											mailboxEmail={mailbox?.email ?? mailboxId}
											underDayHeader
											open={selectedEmailId === email.id}
											checked={selected.has(email.id)}
											selectionMode={selected.size > 0}
											onOpen={() => handleRowClick(email)}
											onToggleChecked={() => toggleSelected(email)}
											onToggleStar={() => {
												if (mailboxId) updateEmail.mutate({ mailboxId, id: email.id, data: { starred: !email.starred } });
											}}
											onToggleRead={() => {
												if (mailboxId) updateEmail.mutate({ mailboxId, id: email.id, data: { read: !email.read } });
											}}
											onDelete={() => {
												if (!mailboxId) return;
												if (!window.confirm("Are you sure you want to delete this email?")) return;
												deleteEmail.mutate({ mailboxId, id: email.id });
												if (selectedEmailId === email.id) closePanel();
											}}
										/>
									))}
								</section>
							))}
						</div>
					) : (
						<FolderEmptyState
							folder={folder}
							onCompose={() => startCompose()}
						/>
					)}
				</div>

				{/* Pagination */}
				{totalCount > PAGE_SIZE && (
					<div className="flex justify-center py-3 border-t border-kumo-line shrink-0">
						<Pagination
							page={page}
							setPage={setPage}
							perPage={PAGE_SIZE}
							totalCount={totalCount}
						/>
					</div>
				)}
		</MailboxSplitView>
	);
}
