// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import {
	ArrowBendUpLeftIcon,
	CheckIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	StarIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import InitialsAvatar from "~/components/airmail/InitialsAvatar";
import LabelChip from "~/components/LabelChip";
import { displayName } from "~/lib/avatar";
import { formatClock } from "~/lib/day-groups";
import { getSnippetText } from "~/lib/utils";
import { formatListDate } from "shared/dates";
import type { Email } from "~/types";

const MAX_ROW_LABELS = 3;

export interface EmailRowProps {
	email: Email;
	/** The mailbox's own address, so a conversation's avatar shows the other person. */
	mailboxEmail?: string;
	/** True when the row sits under a day header, which already carries the day. */
	underDayHeader?: boolean;
	/** The conversation open in the reading pane. */
	open: boolean;
	/** Ticked for a bulk action. */
	checked: boolean;
	/** Any row is ticked: every avatar shows its checkbox. */
	selectionMode: boolean;
	onOpen: () => void;
	onToggleChecked: () => void;
	onToggleStar: () => void;
	onToggleRead: () => void;
	onDelete: () => void;
}

export function hasUnread(email: Email): boolean {
	return email.thread_unread_count !== undefined ? email.thread_unread_count > 0 : !email.read;
}

function participantNames(email: Email): string[] {
	// One sender: the server-supplied display name beats the address. A thread lists addresses.
	const single = !email.participants || email.participants.split(",").length === 1;
	if (single && email.sender_name?.trim()) return [email.sender_name.trim()];
	const raw = email.participants ? email.participants.split(",") : [email.sender];
	const names = raw.map((p) => displayName(p)).filter(Boolean);
	return names.filter((n, i) => names.indexOf(n) === i);
}

function formatParticipants(names: string[]): string {
	if (names.length <= 3) return names.join(", ");
	return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/**
 * One conversation row on the Airmail 72px grid: a 40px leading slot (avatar, or a check circle
 * while selecting) plus a 16px gutter, so sender, subject and snippet share one left edge and the
 * divider insets to it. Unread is weight plus navy time, never a dot or a tint; the only tint is
 * the selected / open row. Amber marks what is kept or waiting (star, draft, needs reply).
 */
export default function EmailRow({
	email,
	mailboxEmail,
	underDayHeader = false,
	open,
	checked,
	selectionMode,
	onOpen,
	onToggleChecked,
	onToggleStar,
	onToggleRead,
	onDelete,
}: EmailRowProps) {
	const unread = hasUnread(email);
	const tinted = open || checked;
	const names = participantNames(email);
	const own = mailboxEmail ? displayName(mailboxEmail) : "";
	const avatarName = names.find((n) => n !== own) ?? names[0] ?? "?";
	const snippet = getSnippetText(email.snippet);
	const weight = unread ? "font-semibold" : "font-normal";
	const muted = tinted ? "text-airmail-on-primary-container" : "text-kumo-subtle";
	const hiddenLabels = (email.labels?.length ?? 0) - MAX_ROW_LABELS;

	return (
		<div
			data-email-id={email.id}
			role="button"
			tabIndex={0}
			onClick={onOpen}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget) return;
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onOpen();
				}
			}}
			className={`group relative flex w-full cursor-pointer gap-4 px-4 py-3 text-left transition-colors after:absolute after:bottom-0 after:left-[72px] after:right-0 after:h-px after:bg-kumo-line ${
				tinted ? "bg-airmail-primary-container text-airmail-on-primary-container" : "bg-kumo-base text-kumo-default hover:bg-kumo-tint"
			}`}
		>
			{/* Leading slot: avatar, swapped for a check circle on hover or while selecting. */}
			<div className="relative h-10 w-10 shrink-0">
				<div className={selectionMode || checked ? "invisible" : "group-hover:invisible group-focus-within:invisible"}>
					<InitialsAvatar name={avatarName} />
				</div>
				<button
					type="button"
					role="checkbox"
					aria-checked={checked}
					aria-label={`Select conversation: ${email.subject}`}
					onClick={(e) => {
						e.stopPropagation();
						onToggleChecked();
					}}
					className={`absolute inset-0 cursor-pointer items-center justify-center rounded-full border-2 p-0 ${
						checked
							? "border-kumo-brand bg-kumo-brand text-kumo-inverse"
							: "border-airmail-outline bg-kumo-base text-transparent hover:border-kumo-brand"
					} ${selectionMode || checked ? "flex" : "hidden group-hover:flex group-focus-within:flex"}`}
				>
					<CheckIcon size={18} weight="bold" />
				</button>
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				{/* Sender, thread count, time */}
				<div className="flex items-center gap-2">
					<span className={`min-w-0 truncate text-base leading-6 ${weight}`}>{formatParticipants(names)}</span>
					{(email.thread_count ?? 1) > 1 && (
						<span className={`shrink-0 text-xs ${muted}`} title={`${email.thread_count} messages`}>
							{email.thread_count}
						</span>
					)}
					<span
						className={`ml-auto shrink-0 text-xs leading-4 group-hover:invisible group-focus-within:invisible ${unread ? "font-semibold" : ""} ${
							unread && !tinted ? "text-kumo-brand" : muted
						}`}
					>
						{underDayHeader ? formatClock(email.date) : formatListDate(email.date)}
					</span>
				</div>

				{/* Subject and star */}
				<div className="flex items-center gap-2">
					<span className={`min-w-0 flex-1 truncate text-sm leading-5 ${weight}`}>{email.subject}</span>
					{email.has_draft && (
						<span className="shrink-0 rounded-lg bg-airmail-tertiary-container px-2 py-0.5 text-xs font-semibold text-airmail-on-tertiary-container">
							Draft
						</span>
					)}
					{email.needs_reply && !email.has_draft && (
						<Tooltip content="Needs reply" asChild>
							<span className="shrink-0 text-airmail-star">
								<ArrowBendUpLeftIcon size={14} weight="bold" aria-label="Needs reply" />
							</span>
						</Tooltip>
					)}
				</div>

				{snippet && <p className={`line-clamp-2 text-xs leading-4 ${muted}`}>{snippet}</p>}

				{(email.labels?.length ?? 0) > 0 && (
					<div className="mt-0.5 flex items-center gap-1">
						{email.labels?.slice(0, MAX_ROW_LABELS).map((l) => (
							<LabelChip key={l.id} label={l} />
						))}
						{hiddenLabels > 0 && <span className={`text-[11px] ${muted}`}>+{hiddenLabels}</span>}
					</div>
				)}
			</div>

			{/* Star stays put; the other actions overlay the time on hover so the text never reflows. */}
			<button
				type="button"
				aria-label={email.starred ? "Unstar" : "Star"}
				aria-pressed={email.starred}
				onClick={(e) => {
					e.stopPropagation();
					onToggleStar();
				}}
				className="-mr-2 h-8 w-8 shrink-0 cursor-pointer self-end rounded-full border-0 bg-transparent p-0"
			>
				<StarIcon
					size={18}
					weight={email.starred ? "fill" : "regular"}
					className={`mx-auto ${email.starred && !tinted ? "text-airmail-star" : tinted ? "text-airmail-on-primary-container" : "text-kumo-inactive hover:text-airmail-star"}`}
				/>
			</button>

			<div className="absolute right-3 top-2 hidden items-center rounded-lg bg-inherit group-hover:flex group-focus-within:flex">
				<Tooltip content={email.read ? "Mark unread" : "Mark read"} asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={email.read ? <EnvelopeSimpleIcon size={16} /> : <EnvelopeOpenIcon size={16} />}
						onClick={(e) => {
							e.stopPropagation();
							onToggleRead();
						}}
						aria-label={email.read ? "Mark unread" : "Mark read"}
					/>
				</Tooltip>
				<Tooltip content="Delete" asChild>
					<Button
						variant="ghost"
						shape="square"
						size="sm"
						icon={<TrashIcon size={16} />}
						onClick={(e) => {
							e.stopPropagation();
							onDelete();
						}}
						aria-label="Delete"
					/>
				</Tooltip>
			</div>
		</div>
	);
}
