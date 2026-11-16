// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useCallback, useMemo, useState } from "react";
import { addAllowedSender, countRemoteImages, isSenderAllowed, senderAddress } from "~/lib/remote-images";

const safeStorage = (): Storage | undefined => {
	try {
		return typeof window !== "undefined" ? window.localStorage : undefined;
	} catch {
		return undefined;
	}
};

/**
 * Remote-image policy for one message: blocked unless the sender is on the
 * allow-list, it's the mailbox's own message, or the reader chose to show them.
 */
export function useRemoteImages(mailboxId: string, sender: string, body: string) {
	const [shownOnce, setShownOnce] = useState(false);
	const [allowedNow, setAllowedNow] = useState(false);

	const isOwn = senderAddress(sender) === mailboxId.toLowerCase();
	const alwaysAllowed = useMemo(
		() => isOwn || allowedNow || isSenderAllowed(safeStorage(), mailboxId, sender),
		[isOwn, allowedNow, mailboxId, sender],
	);
	const blockedCount = useMemo(() => countRemoteImages(body), [body]);

	const showImages = useCallback(() => setShownOnce(true), []);
	const alwaysShowFromSender = useCallback(() => {
		addAllowedSender(safeStorage(), mailboxId, sender);
		setAllowedNow(true);
	}, [mailboxId, sender]);

	return {
		allowImages: shownOnce || alwaysAllowed,
		blockedCount: shownOnce || alwaysAllowed ? 0 : blockedCount,
		showImages,
		alwaysShowFromSender,
	};
}
