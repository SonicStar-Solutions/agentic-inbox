// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import { ArchiveIcon, EnvelopeOpenIcon, EnvelopeSimpleIcon, StarIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import type { BulkAction } from "~/lib/bulk";

interface BulkToolbarProps {
	count: number;
	allSelected: boolean;
	onToggleAll: () => void;
	onClear: () => void;
	onAction: (action: BulkAction, folderId?: string) => void;
	/** Folders a conversation can be moved to (current folder excluded). */
	moveTargets: { id: string; name: string }[];
	canArchive: boolean;
	inTrash: boolean;
	busy: boolean;
	/** Labels that can be applied or removed. */
	labels?: { id: string; name: string }[];
}

/** Replaces the folder header while conversations are selected (#88). */
export default function BulkToolbar({
	count,
	allSelected,
	onToggleAll,
	onClear,
	onAction,
	moveTargets,
	canArchive,
	inTrash,
	busy,
	labels = [],
}: BulkToolbarProps) {
	return (
		<div
			role="toolbar"
			aria-label="Bulk actions"
			className="flex flex-wrap items-center gap-1 px-4 py-2.5 border-b border-kumo-line bg-kumo-tint shrink-0 md:px-5"
		>
			<input
				type="checkbox"
				checked={allSelected}
				onChange={onToggleAll}
				aria-label={allSelected ? "Deselect all" : "Select all"}
				className="mr-2 h-4 w-4"
			/>
			<span className="text-sm font-medium text-kumo-default mr-2">{count} selected</span>

			{canArchive && (
				<Tooltip content="Archive" asChild>
					<Button variant="ghost" shape="square" size="sm" icon={<ArchiveIcon size={16} />} onClick={() => onAction("move", "archive")} disabled={busy} aria-label="Archive" />
				</Tooltip>
			)}
			<Tooltip content="Mark read" asChild>
				<Button variant="ghost" shape="square" size="sm" icon={<EnvelopeOpenIcon size={16} />} onClick={() => onAction("read")} disabled={busy} aria-label="Mark read" />
			</Tooltip>
			<Tooltip content="Mark unread" asChild>
				<Button variant="ghost" shape="square" size="sm" icon={<EnvelopeSimpleIcon size={16} />} onClick={() => onAction("unread")} disabled={busy} aria-label="Mark unread" />
			</Tooltip>
			<Tooltip content="Star" asChild>
				<Button variant="ghost" shape="square" size="sm" icon={<StarIcon size={16} />} onClick={() => onAction("star")} disabled={busy} aria-label="Star" />
			</Tooltip>
			<Tooltip content={inTrash ? "Delete permanently" : "Move to Trash"} asChild>
				<Button variant="ghost" shape="square" size="sm" icon={<TrashIcon size={16} />} onClick={() => onAction("delete")} disabled={busy} aria-label={inTrash ? "Delete permanently" : "Move to Trash"} />
			</Tooltip>

			{moveTargets.length > 0 && (
				<select
					aria-label="Move to folder"
					value=""
					disabled={busy}
					onChange={(e) => e.target.value && onAction("move", e.target.value)}
					className="ml-1 h-7 rounded-md border border-kumo-line bg-kumo-base px-2 text-xs text-kumo-default"
				>
					<option value="">Move to…</option>
					{moveTargets.map((f) => (
						<option key={f.id} value={f.id}>
							{f.name}
						</option>
					))}
				</select>
			)}

			{labels.length > 0 && (
				<>
					<select
						aria-label="Apply label"
						value=""
						disabled={busy}
						onChange={(e) => e.target.value && onAction("label", e.target.value)}
						className="ml-1 h-7 rounded-md border border-kumo-line bg-kumo-base px-2 text-xs text-kumo-default"
					>
						<option value="">Label…</option>
						{labels.map((l) => (
							<option key={l.id} value={l.id}>
								{l.name}
							</option>
						))}
					</select>
					<select
						aria-label="Remove label"
						value=""
						disabled={busy}
						onChange={(e) => e.target.value && onAction("unlabel", e.target.value)}
						className="h-7 rounded-md border border-kumo-line bg-kumo-base px-2 text-xs text-kumo-default"
					>
						<option value="">Remove label…</option>
						{labels.map((l) => (
							<option key={l.id} value={l.id}>
								{l.name}
							</option>
						))}
					</select>
				</>
			)}

			<Tooltip content="Clear selection" asChild>
				<Button variant="ghost" shape="square" size="sm" icon={<XIcon size={16} />} onClick={onClear} className="ml-auto" aria-label="Clear selection" />
			</Tooltip>
		</div>
	);
}
