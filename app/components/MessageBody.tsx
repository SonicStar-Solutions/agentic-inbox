// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { ImageIcon } from "@phosphor-icons/react";
import EmailIframe from "~/components/EmailIframe";
import { useInlineImages } from "~/hooks/useInlineImages";
import { useRemoteImages } from "~/hooks/useRemoteImages";
import { senderAddress } from "~/lib/remote-images";
import type { Email } from "~/types";

interface MessageBodyProps {
	email: Email;
	mailboxId: string;
	autoSize?: boolean;
}

/**
 * A message's HTML body in its sandboxed iframe, with remote images blocked
 * until the reader opts in (#88) and inline attachments embedded as data: URLs.
 */
export default function MessageBody({ email, mailboxId, autoSize }: MessageBodyProps) {
	const body = useInlineImages(email.body || "", mailboxId, email.id, email.attachments);
	const remote = useRemoteImages(mailboxId, email.sender, body);
	const sender = senderAddress(email.sender);

	return (
		<div className={autoSize ? undefined : "flex h-full flex-col"}>
			{remote.blockedCount > 0 && (
				<div
					role="status"
					className="flex flex-wrap items-center gap-2 border-b border-kumo-line bg-kumo-tint px-3 py-2 text-xs text-kumo-subtle"
				>
					<ImageIcon size={14} />
					<span>
						{remote.blockedCount} remote image{remote.blockedCount === 1 ? "" : "s"} blocked to protect your privacy.
					</span>
					<Button variant="secondary" size="xs" onClick={remote.showImages}>
						Show images
					</Button>
					{sender && (
						<Button variant="ghost" size="xs" onClick={remote.alwaysShowFromSender}>
							Always show from {sender}
						</Button>
					)}
				</div>
			)}
			<div className={autoSize ? undefined : "min-h-0 flex-1"}>
				<EmailIframe body={body} autoSize={autoSize} allowRemoteImages={remote.allowImages} />
			</div>
		</div>
	);
}
