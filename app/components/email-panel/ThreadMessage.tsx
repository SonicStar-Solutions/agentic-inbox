// Copyright (c) 2026 Cloudflare, Inc.
// Modifications Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Tooltip } from "@cloudflare/kumo";
import InitialsAvatar from "~/components/airmail/InitialsAvatar";
import { displayName } from "~/lib/avatar";
import {
	CaretDownIcon,
	CaretUpIcon,
	CodeIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import EmailAttachmentList from "~/components/EmailAttachmentList";
import MessageBody from "~/components/MessageBody";
import {
	formatDetailDate,
	formatShortDate,
	stripHtml,
} from "~/lib/utils";
import type { Email } from "~/types";

interface ThreadMessageProps {
	email: Email;
	mailboxId?: string;
	mailboxEmail?: string;
	isLast: boolean;
	isDraft?: boolean;
	isSending?: boolean;
	isExpanded: boolean;
	onToggleExpand: () => void;
	onSendDraft?: () => void;
	onEditDraft?: () => void;
	onDeleteDraft?: () => void;
	onViewSource?: () => void;
	onPreviewImage?: (url: string, filename: string) => void;
}

function Avatar({ isDraft, sender }: { isDraft?: boolean; isSelf: boolean; sender: string }) {
	if (!isDraft) return <InitialsAvatar name={displayName(sender)} />;
	return (
		<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-airmail-tertiary-container text-[15px] font-semibold text-airmail-on-tertiary-container">
			D
		</div>
	);
}

export default function ThreadMessage({
	email,
	mailboxId,
	mailboxEmail,
	isDraft,
	isSending,
	isExpanded,
	onToggleExpand,
	onSendDraft,
	onEditDraft,
	onDeleteDraft,
	onViewSource,
	onPreviewImage,
}: ThreadMessageProps) {
	const isSelf = email.sender === mailboxEmail;
	const containerClassName = `mx-4 my-2 overflow-hidden rounded-xl bg-airmail-container-low ${isDraft ? "border-l-4 border-l-kumo-warning" : ""}`;
	const senderLabel = isDraft ? "Draft reply" : isSelf ? "You" : email.sender_name?.trim() || displayName(email.sender) || email.sender;

	if (!isExpanded) {
		return (
			<div className={containerClassName}>
				<button
					type="button"
					onClick={onToggleExpand}
					className="w-full flex items-center gap-4 px-4 py-3 hover:bg-kumo-tint text-left"
				>
					<Avatar isDraft={isDraft} isSelf={isSelf} sender={email.sender_name?.trim() || email.sender} />
					<div className="flex-1 min-w-0">
						<div className="flex items-center justify-between">
							<span className="text-sm font-semibold text-kumo-default truncate">
								{senderLabel}
							</span>
							<span className="text-xs text-kumo-subtle shrink-0">
								{formatDetailDate(email.date)}
							</span>
						</div>
						<p className="text-xs text-kumo-subtle truncate">
							{stripHtml(email.body || "").slice(0, 80)}
						</p>
					</div>
					<CaretDownIcon size={14} className="text-kumo-subtle shrink-0" />
				</button>
			</div>
		);
	}

	return (
		<div className={`group/thread-msg ${containerClassName}`}>
			<div className="p-4">
				<div className="flex items-center justify-between gap-3 mb-3">
					<div className="flex items-center gap-4 min-w-0">
						<button
							type="button"
							onClick={onToggleExpand}
							className="shrink-0"
							aria-label="Collapse message"
						>
							<div className="cursor-pointer hover:ring-2 hover:ring-kumo-brand/30 transition-shadow rounded-full">
								<Avatar isDraft={isDraft} isSelf={isSelf} sender={email.sender} />
							</div>
						</button>
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<span className="text-sm font-semibold text-kumo-default truncate">
									{senderLabel}
								</span>
								{isDraft && (
									<span className="rounded-lg bg-airmail-tertiary-container px-2 py-0.5 text-xs font-semibold text-airmail-on-tertiary-container">
										Draft
									</span>
								)}
							</div>
							<div className="text-xs text-kumo-subtle">To: {email.recipient}</div>
						</div>
					</div>
					<div className="flex items-center gap-1 shrink-0">
						<span className="text-xs text-kumo-subtle">
							{formatShortDate(email.date)}
						</span>
						{onViewSource && (
							<Tooltip content="View source" side="bottom" asChild>
								<Button
									variant="ghost"
									shape="square"
									size="sm"
									icon={<CodeIcon size={14} />}
									onClick={onViewSource}
									aria-label="View source"
									className="transition-opacity !h-6 !w-6"
								/>
							</Tooltip>
						)}
						<button
							type="button"
							onClick={onToggleExpand}
							className="ml-1"
							aria-label="Collapse message"
						>
							<CaretUpIcon
								size={14}
								className="text-kumo-subtle hover:text-kumo-default transition-colors"
							/>
						</button>
					</div>
				</div>

				<div className="md:ml-14">
					<MessageBody email={email} mailboxId={mailboxId || ""} autoSize />
				</div>

				{isDraft && (onSendDraft || onEditDraft || onDeleteDraft) && (
					<div className="flex gap-2 mt-3 md:ml-14">
						{onSendDraft && (
							<Button
								variant="primary"
								size="sm"
								icon={<PaperPlaneTiltIcon size={14} />}
								onClick={onSendDraft}
								loading={isSending}
								disabled={isSending}
							>
								{isSending ? "Sending..." : "Send"}
							</Button>
						)}
						{onEditDraft && (
							<Button
								variant="secondary"
								size="sm"
								icon={<PencilSimpleIcon size={14} />}
								onClick={onEditDraft}
								disabled={isSending}
							>
								Edit
							</Button>
						)}
						{onDeleteDraft && (
							<Button
								variant="ghost"
								size="sm"
								icon={<TrashIcon size={14} />}
								onClick={onDeleteDraft}
								disabled={isSending}
							>
								Discard
							</Button>
						)}
					</div>
				)}

				<EmailAttachmentList
					mailboxId={mailboxId}
					emailId={email.id}
					attachments={email.attachments}
					onPreviewImage={onPreviewImage}
					className="mt-3 md:ml-14"
				/>
			</div>
		</div>
	);
}
