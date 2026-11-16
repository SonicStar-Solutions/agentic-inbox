// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * "Test connection": sign in, list the folders with message counts and the
 * suggested destination for each. Imports nothing.
 */
import type { ProbeResult } from "../../../shared/import";
import { ImapClient, ImapConnectionError, type ImapCredentials, type OpenTransport } from "./client";
import { folderPriority, isNoSelect, suggestTarget } from "./folders";

const MAX_FOLDERS = 300;

export async function probeImap(creds: ImapCredentials, open?: OpenTransport): Promise<ProbeResult> {
	const client = await ImapClient.connect(creds, open);
	try {
		const listed = (await client.list()).filter((f) => !isNoSelect(f)).slice(0, MAX_FOLDERS);
		const folders: ProbeResult["folders"] = [];
		for (const f of listed) {
			let messages = 0;
			try {
				messages = (await client.status(f.path)).messages;
			} catch (e) {
				if (e instanceof ImapConnectionError) throw e;
				// A folder we cannot read is listed with zero messages.
			}
			folders.push({ path: f.path, name: f.name, messages, suggested: suggestTarget(f) });
		}
		const flagsByPath = new Map(listed.map((f) => [f.path, f]));
		folders.sort(
			(a, b) =>
				folderPriority(flagsByPath.get(a.path)!, a.suggested) - folderPriority(flagsByPath.get(b.path)!, b.suggested) ||
				a.name.localeCompare(b.name),
		);
		return { folders, totalMessages: folders.reduce((n, f) => n + (f.suggested === null ? 0 : f.messages), 0) };
	} finally {
		await client.logout();
	}
}
