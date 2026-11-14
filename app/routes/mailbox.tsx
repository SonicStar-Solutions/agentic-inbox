// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { Outlet, useParams } from "react-router";
import AgentSidebar from "~/components/AgentSidebar";
import ShortcutsDialog from "~/components/ShortcutsDialog";
import UndoSendBar from "~/components/UndoSendBar";
import { useGlobalShortcuts } from "~/hooks/useGlobalShortcuts";
import Header from "~/components/Header";
import Sidebar from "~/components/Sidebar";
import { useMailbox } from "~/queries/mailboxes";
import { useUIStore } from "~/hooks/useUIStore";

export default function MailboxRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	// Prefetch mailbox data for child components
	useMailbox(mailboxId);
	const prevMailboxIdRef = useRef<string | undefined>(undefined);
	const {
		isSidebarOpen,
		closeSidebar,
		isAgentPanelOpen,
		isAgentSheetOpen,
		toggleAgentSheet,
		closePanel,
	} = useUIStore();

	useGlobalShortcuts();

	useEffect(() => {
		if (
			prevMailboxIdRef.current &&
			mailboxId &&
			prevMailboxIdRef.current !== mailboxId
		) {
			closePanel();
			closeSidebar();
		}

		prevMailboxIdRef.current = mailboxId;
	}, [mailboxId, closePanel, closeSidebar]);

	return (
		<div className="flex h-screen overflow-hidden">
			{/* Mobile sidebar overlay backdrop */}
			{isSidebarOpen && (
				<div
					className="fixed inset-0 z-30 bg-black/30 md:hidden"
					onClick={closeSidebar}
					onKeyDown={(e) => e.key === "Escape" && closeSidebar()}
					role="button"
					tabIndex={-1}
					aria-label="Close sidebar"
				/>
			)}

			{/* Sidebar: hidden on mobile by default, shown as overlay when open */}
			<div
				className={`fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 md:z-0 ${
					isSidebarOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				<Sidebar />
			</div>

			{/* Main content */}
			<div className="flex-1 flex flex-col min-w-0 bg-kumo-base">
				<Header />
				<main className="flex-1 overflow-hidden">
					<Outlet />
				</main>
			</div>

			{/* Agent + MCP sidebar -- togglable on desktop */}
			{isAgentPanelOpen && (
				<div className="hidden lg:flex w-[380px] shrink-0 border-l border-kumo-line flex-col bg-kumo-base overflow-hidden">
					<AgentSidebar />
				</div>
			)}

			{/* Agent as a full-screen sheet below the lg breakpoint, where the side panel is hidden */}
			{isAgentSheetOpen && (
				<div className="fixed inset-0 z-50 flex flex-col bg-kumo-base lg:hidden">
					<div className="flex items-center justify-between border-b border-kumo-line px-3 py-2">
						<span className="text-sm font-semibold text-kumo-default">Agent</span>
						<Button variant="ghost" shape="square" size="sm" icon={<XIcon size={18} />} onClick={toggleAgentSheet} aria-label="Close agent" />
					</div>
					<div className="min-h-0 flex-1">
						<AgentSidebar />
					</div>
				</div>
			)}
			<UndoSendBar />
			<ShortcutsDialog />
		</div>
	);
}
