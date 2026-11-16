// Copyright (c) 2026 Cloudflare, Inc.
// Modifications Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Input, Tooltip } from "@cloudflare/kumo";
import InitialsAvatar from "~/components/airmail/InitialsAvatar";
import {
	ArchiveIcon,
	CaretLeftIcon,
	FileIcon,
	FolderIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
	TrayArrowDownIcon,
	TrayIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useKumoToastManager } from "@cloudflare/kumo";
import { NavLink, useNavigate, useParams } from "react-router";
import { ClockIcon } from "@phosphor-icons/react";
import { Folders, SYSTEM_FOLDER_IDS } from "shared/folders";
import { useCreateFolder, useDeleteFolder, useFolders, useUpdateFolder } from "~/queries/folders";
import { useMailbox } from "~/queries/mailboxes";
import LabelsSection from "~/components/LabelsSection";
import { useScheduled } from "~/queries/scheduled";
import { useUIStore } from "~/hooks/useUIStore";

const FOLDER_ICONS: Record<string, React.ReactNode> = {
	[Folders.INBOX]: <TrayIcon size={18} weight="regular" />,
	[Folders.SENT]: <PaperPlaneTiltIcon size={18} weight="regular" />,
	[Folders.DRAFT]: <FileIcon size={18} weight="regular" />,
	[Folders.ARCHIVE]: <ArchiveIcon size={18} weight="regular" />,
	[Folders.TRASH]: <TrashIcon size={18} weight="regular" />,
};

const SYSTEM_FOLDER_LINKS = [
	{ id: Folders.INBOX, label: "Inbox" },
	{ id: Folders.SENT, label: "Sent" },
	{ id: Folders.DRAFT, label: "Drafts" },
	{ id: Folders.ARCHIVE, label: "Archive" },
	{ id: Folders.TRASH, label: "Trash" },
];

interface FolderLinkProps {
	to: string;
	icon: React.ReactNode;
	label: string;
	unreadCount?: number;
	onClick?: () => void;
}

function FolderLink({
	to,
	icon,
	label,
	unreadCount,
	onClick,
}: FolderLinkProps) {
	return (
		<NavLink
			to={to}
			onClick={onClick}
			className={({ isActive }) =>
				`flex items-center gap-3 h-11 px-4 rounded-full text-sm font-semibold transition-colors ${
					isActive
						? "bg-airmail-secondary-container text-airmail-on-secondary-container"
						: "text-kumo-subtle hover:bg-kumo-tint"
				}`
			}
		>
			<span className="shrink-0">{icon}</span>
			<span className="truncate flex-1">{label}</span>
			{unreadCount != null && unreadCount > 0 && (
				<span className="text-xs font-normal">{unreadCount > 99 ? "99+" : unreadCount}</span>
			)}
		</NavLink>
	);
}

export default function Sidebar() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const { data: scheduledItems } = useScheduled(mailboxId);
	const scheduledCount = scheduledItems?.filter((i) => i.status !== "sending").length ?? 0;
	const navigate = useNavigate();
	const { data: folders = [] } = useFolders(mailboxId);
	const createFolderMutation = useCreateFolder();
	const { startCompose, closeSidebar } = useUIStore();
	const { data: currentMailbox } = useMailbox(mailboxId);
	const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");

	const customFolders = useMemo(
		() =>
			folders.filter((f) => !(SYSTEM_FOLDER_IDS as readonly string[]).includes(f.id)),
		[folders],
	);

	const getUnreadCount = (folderId: string) => {
		const found = folders.find((f) => f.id === folderId);
		return found?.unreadCount || 0;
	};

	// Rename / delete a custom folder (#89)
	const toastManager = useKumoToastManager();
	const updateFolderMutation = useUpdateFolder();
	const deleteFolderMutation = useDeleteFolder();
	const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
	const [renameValue, setRenameValue] = useState("");
	const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);

	const handleRenameFolder = (e: React.FormEvent) => {
		e.preventDefault();
		const name = renameValue.trim();
		if (!renaming || !mailboxId || !name) return;
		updateFolderMutation.mutate(
			{ mailboxId, id: renaming.id, name },
			{ onSuccess: () => setRenaming(null) },
		);
	};

	const handleDeleteFolder = () => {
		if (!deleting || !mailboxId) return;
		const wasViewing = location.pathname.endsWith(`/emails/${deleting.id}`);
		deleteFolderMutation.mutate(
			{ mailboxId, id: deleting.id },
			{
				onSuccess: () => {
					toastManager.add({ title: `"${deleting.name}" deleted. Its messages were moved to Archive.` });
					setDeleting(null);
					if (wasViewing) navigate(`/mailbox/${mailboxId}/emails/inbox`);
				},
			},
		);
	};

	const handleCreateFolder = (e: React.FormEvent) => {
		e.preventDefault();
		if (newFolderName.trim() && mailboxId) {
			createFolderMutation.mutate({ mailboxId, name: newFolderName.trim() });
			setNewFolderName("");
			setIsCreateFolderOpen(false);
		}
	};

	const displayName = useMemo(() => {
		if (!currentMailbox) return mailboxId?.split("@")[0] || "Mailbox";
		// Prefer settings.fromName > name > local part of email
		if (currentMailbox.settings?.fromName) {
			return currentMailbox.settings.fromName;
		}
		if (currentMailbox.name && currentMailbox.name !== currentMailbox.email) {
			return currentMailbox.name;
		}
		return currentMailbox.email.split("@")[0] || currentMailbox.name;
	}, [currentMailbox, mailboxId]);

	const handleNavClick = () => {
		// Close mobile sidebar on navigation
		closeSidebar();
	};

	return (
		<aside className="h-full w-64 bg-kumo-recessed flex flex-col shrink-0 border-r border-kumo-line">
			{/* Back + identity */}
			<div className="px-4 pt-4 pb-1">
				<button
					type="button"
					onClick={() => {
						navigate("/");
						closeSidebar();
					}}
					className="flex items-center gap-1.5 text-kumo-subtle text-sm hover:text-kumo-default transition-colors mb-2.5 cursor-pointer bg-transparent border-0 p-0"
				>
					<CaretLeftIcon size={14} />
					<span>Mailboxes</span>
				</button>
				<div className="flex items-center gap-3 px-1">
					<InitialsAvatar name={displayName} />
					<div className="min-w-0">
						<div className="text-base font-semibold text-kumo-default truncate">
							{displayName}
						</div>
						<div className="text-xs text-kumo-subtle truncate">
							{currentMailbox?.email || mailboxId}
						</div>
					</div>
				</div>
			</div>

			{/* Compose */}
			<div className="px-3 py-3">
				<Button
					variant="primary"
					icon={<PencilSimpleIcon size={16} />}
					onClick={() => startCompose()}
					className="w-full"
				>
					Compose
				</Button>
			</div>

			{/* Navigation */}
			<nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
				{SYSTEM_FOLDER_LINKS.map((folder) => (
					<FolderLink
						key={folder.id}
						to={`/mailbox/${mailboxId}/emails/${folder.id}`}
						icon={FOLDER_ICONS[folder.id]}
						label={folder.label}
						unreadCount={getUnreadCount(folder.id)}
						onClick={handleNavClick}
					/>
				))}

				<FolderLink
					to={`/mailbox/${mailboxId}/scheduled`}
					icon={<ClockIcon size={18} weight="regular" />}
					label="Scheduled"
					unreadCount={scheduledCount}
					onClick={handleNavClick}
				/>

				{/* Custom folders */}
				{customFolders.length > 0 && (
					<div className="pt-5">
						<div className="flex items-center justify-between px-3 mb-1.5">
							<span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
								Folders
							</span>
							<Tooltip content="New folder" asChild>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateFolderOpen(true)}
									aria-label="Create new folder"
								/>
							</Tooltip>
						</div>
						{customFolders.map((folder) => (
							<div key={folder.id} className="group/folder relative">
								<FolderLink
									to={`/mailbox/${mailboxId}/emails/${folder.id}`}
									icon={<FolderIcon size={18} />}
									label={folder.name}
									unreadCount={folder.unreadCount}
									onClick={handleNavClick}
								/>
								<div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 bg-kumo-recessed group-hover/folder:flex group-focus-within/folder:flex">
									<Button
										variant="ghost"
										shape="square"
										size="xs"
										icon={<PencilSimpleIcon size={13} />}
										aria-label={`Rename folder ${folder.name}`}
										onClick={() => {
											setRenameValue(folder.name);
											setRenaming({ id: folder.id, name: folder.name });
										}}
									/>
									<Button
										variant="ghost"
										shape="square"
										size="xs"
										icon={<TrashIcon size={13} />}
										aria-label={`Delete folder ${folder.name}`}
										onClick={() => setDeleting({ id: folder.id, name: folder.name })}
									/>
								</div>
							</div>
						))}
					</div>
				)}

				{/* Add folder button when no custom folders */}
				{customFolders.length === 0 && (
					<div className="pt-5">
						<div className="flex items-center justify-between px-3 mb-1.5">
							<span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">
								Folders
							</span>
							<Tooltip content="New folder" asChild>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									icon={<PlusIcon size={16} />}
									onClick={() => setIsCreateFolderOpen(true)}
									aria-label="Create new folder"
								/>
							</Tooltip>
						</div>
					</div>
				)}

				<LabelsSection mailboxId={mailboxId} onNavigate={handleNavClick} />

				<div className="pt-5">
					<FolderLink
						to={`/mailbox/${mailboxId}/import`}
						icon={<TrayArrowDownIcon size={18} weight="regular" />}
						label="Import mail"
						onClick={handleNavClick}
					/>
				</div>
			</nav>

			{/* Rename folder dialog */}
			<Dialog.Root open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">Rename folder</Dialog.Title>
					<form onSubmit={handleRenameFolder} className="space-y-4">
						<Input
							label="Folder name"
							value={renameValue}
							onChange={(e) => setRenameValue(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								disabled={!renameValue.trim() || renameValue.trim() === renaming?.name}
								loading={updateFolderMutation.isPending}
							>
								Rename
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>

			{/* Delete folder dialog */}
			<Dialog.Root open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-2">Delete "{deleting?.name}"?</Dialog.Title>
					<p className="text-sm text-kumo-subtle mb-4">
						The folder is removed. Messages in it are not deleted: they move to Archive.
					</p>
					<div className="flex justify-end gap-2">
						<Dialog.Close
							render={(props) => (
								<Button {...props} variant="secondary">
									Cancel
								</Button>
							)}
						/>
						<Button variant="destructive" onClick={handleDeleteFolder} loading={deleteFolderMutation.isPending}>
							Delete folder
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>

			{/* Create folder dialog */}
			<Dialog.Root
				open={isCreateFolderOpen}
				onOpenChange={setIsCreateFolderOpen}
			>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">
						Create folder
					</Dialog.Title>
					<form onSubmit={handleCreateFolder} className="space-y-4">
						<Input
							label="Folder name"
							placeholder="e.g. Projects"
							value={newFolderName}
							onChange={(e) => setNewFolderName(e.target.value)}
							required
						/>
						<div className="flex justify-end gap-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary">
										Cancel
									</Button>
								)}
							/>
							<Button
								type="submit"
								variant="primary"
								disabled={!newFolderName.trim()}
							>
								Create
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>
		</aside>
	);
}
