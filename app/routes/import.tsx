// Copyright (c) 2026 SonicStar Solutions.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Banner, Button, Input, Loader, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowLeftIcon, TrayArrowDownIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import {
	IMPORT_PROVIDERS,
	type FolderTarget,
	type ImapImportStatus,
	type ImportSecurity,
	type ProbeResult,
	isMicrosoftMailHost,
} from "shared/import";
import {
	TARGET_OPTIONS,
	buildFolderMap,
	choiceToTarget,
	connectionErrorMessage,
	countToImport,
	estimateRemaining,
	formatDuration,
	percentDone,
	processed,
	targetToChoice,
} from "~/lib/import-ui";
import { useMailbox } from "~/queries/mailboxes";
import {
	useCancelImapImport,
	useDismissImportFailures,
	useImapImportStatus,
	useProbeImap,
	useRetryFailedImport,
	useStartImapImport,
} from "~/queries/imapImport";
import { ApiError } from "~/services/api";

const selectClass =
	"w-full rounded-lg border border-kumo-line bg-kumo-recessed px-3 py-2 text-sm text-kumo-default focus:outline-none focus:ring-1 focus:ring-kumo-ring";

function Card({ children }: { children: React.ReactNode }) {
	return <div className="rounded-lg border border-kumo-line bg-kumo-base p-5">{children}</div>;
}

function errorOf(e: unknown, providerId: string): string {
	if (e instanceof ApiError) return connectionErrorMessage(e.body.code as string | undefined, e.message, providerId);
	return e instanceof Error ? e.message : "Something went wrong.";
}

export default function ImportRoute() {
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const toast = useKumoToastManager();
	const { data: mailbox } = useMailbox(mailboxId);
	const { data: status } = useImapImportStatus(mailboxId);
	const [wizardOpen, setWizardOpen] = useState(false);

	if (!mailboxId || !mailbox || !status) {
		return (
			<div className="flex justify-center py-20">
				<Loader size="lg" />
			</div>
		);
	}

	const showWizard = status.status === "idle" || wizardOpen;

	return (
		<div className="max-w-2xl px-4 py-4 md:px-8 md:py-6 h-full overflow-y-auto">
			<Link to={`/mailbox/${mailboxId}/settings`} className="inline-flex items-center gap-1 text-xs text-kumo-subtle hover:text-kumo-default mb-3">
				<ArrowLeftIcon size={12} /> Settings
			</Link>
			<h1 className="text-lg font-semibold text-kumo-default mb-1">Import mail</h1>
			<p className="text-sm text-kumo-subtle mb-6">
				Copy mail from another provider into {mailbox.email}. Your old account is only read, never changed. Imported mail keeps its original date and never triggers the AI agent.
			</p>

			<div className="space-y-6">
				{status.status === "running" && <Progress status={status} mailboxId={mailboxId} />}
				{status.status !== "running" && status.status !== "idle" && !wizardOpen && (
					<Result status={status} mailboxId={mailboxId} onNew={() => setWizardOpen(true)} />
				)}
				{status.status !== "running" && showWizard && (
					<Wizard
						mailboxId={mailboxId}
						mailboxEmail={mailbox.email}
						onStarted={() => {
							setWizardOpen(false);
							toast.add({ title: "Import started" });
						}}
						onCancel={status.status === "idle" ? undefined : () => setWizardOpen(false)}
					/>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Connect, review folders, start
// ---------------------------------------------------------------------------

function Wizard({
	mailboxId,
	mailboxEmail,
	onStarted,
	onCancel,
}: {
	mailboxId: string;
	mailboxEmail: string;
	onStarted: () => void;
	onCancel?: () => void;
}) {
	const [providerId, setProviderId] = useState("gmail");
	const provider = IMPORT_PROVIDERS.find((p) => p.id === providerId) ?? IMPORT_PROVIDERS[0];
	const [host, setHost] = useState(provider.host);
	const [port, setPort] = useState(String(provider.port));
	const [security, setSecurity] = useState<ImportSecurity>(provider.security);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [probed, setProbed] = useState<{ result: ProbeResult; key: string } | null>(null);
	const [overrides, setOverrides] = useState<Record<string, FolderTarget>>({});
	const [error, setError] = useState<string | null>(null);

	const probeMutation = useProbeImap();
	const startMutation = useStartImapImport();

	const conn = { host: host.trim(), port: Number(port), security, username: username.trim(), password };
	const canConnect = conn.host && Number.isInteger(conn.port) && conn.username && conn.password;

	// A folder list only applies to the connection it came from.
	const connKey = `${conn.host}|${conn.port}|${conn.security}|${conn.username}`;
	const probe = probed && probed.key === connKey ? probed.result : null;

	const pickProvider = (id: string) => {
		const p = IMPORT_PROVIDERS.find((x) => x.id === id) ?? IMPORT_PROVIDERS[0];
		setProviderId(id);
		setHost(p.host);
		setPort(String(p.port));
		setSecurity(p.security);
		setError(null);
	};

	const connect = async () => {
		setError(null);
		try {
			const result = await probeMutation.mutateAsync({ mailboxId, conn });
			setOverrides({});
			setProbed({ result, key: connKey });
		} catch (e) {
			setError(errorOf(e, providerId));
		}
	};

	const folderMap = useMemo(() => (probe ? buildFolderMap(probe.folders, overrides) : {}), [probe, overrides]);
	const totals = useMemo(() => (probe ? countToImport(probe.folders, folderMap) : { folders: 0, messages: 0 }), [probe, folderMap]);

	const start = async () => {
		setError(null);
		try {
			await startMutation.mutateAsync({ mailboxId, conn, folderMap });
			setPassword(""); // the server has it now; do not keep it in the page
			onStarted();
		} catch (e) {
			setError(errorOf(e, providerId));
		}
	};

	return (
		<Card>
			<div className="flex items-center gap-2 mb-4">
				<TrayArrowDownIcon size={16} weight="duotone" className="text-kumo-subtle" />
				<span className="text-sm font-medium text-kumo-default">{probe ? "Choose what to import" : "Connect to your old account"}</span>
			</div>

			{error && (
				<div className="mb-4">
					<Banner variant="error" text={error} />
				</div>
			)}

			{!probe ? (
				<div className="space-y-3">
					<label className="block text-sm text-kumo-default">
						<span className="mb-1 block">Provider</span>
						<select className={selectClass} value={providerId} onChange={(e) => pickProvider(e.target.value)}>
							{IMPORT_PROVIDERS.map((p) => (
								<option key={p.id} value={p.id}>
									{p.label}
								</option>
							))}
						</select>
					</label>

					{provider.note && (
						<p className="text-xs text-kumo-subtle">
							{provider.note}{" "}
							{provider.helpUrl && (
								<a href={provider.helpUrl} target="_blank" rel="noreferrer" className="underline">
									How to
								</a>
							)}
						</p>
					)}

					{(providerId === "other" || host) && (
						<div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
							<div className="min-w-0">
								<Input label="IMAP server" value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" />
							</div>
							<div className="min-w-0 [&_input]:w-0 [&_input]:min-w-full">
								<Input label="Port" value={port} inputMode="numeric" onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
							</div>
						</div>
					)}
					{providerId === "other" && (
						<label className="block text-sm text-kumo-default">
							<span className="mb-1 block">Connection security</span>
							<select className={selectClass} value={security} onChange={(e) => setSecurity(e.target.value as ImportSecurity)}>
								<option value="tls">SSL/TLS (usually port 993)</option>
								<option value="starttls">STARTTLS (usually port 143)</option>
							</select>
						</label>
					)}
					{isMicrosoftMailHost(host) && (
						<Banner variant="alert" text="Microsoft 365 and Outlook.com no longer allow password sign-in over IMAP, so this will not work. Export your mail to a file instead." />
					)}

					<Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@example.com" autoComplete="off" />
					<Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />

					<p className="text-xs text-kumo-subtle">
						Your password is kept only while the import runs and is deleted when it stops. It is never shown again or stored anywhere else.
					</p>

					<div className="flex justify-end gap-2 pt-1">
						{onCancel && (
							<Button variant="secondary" onClick={onCancel}>
								Back
							</Button>
						)}
						<Button variant="primary" onClick={connect} loading={probeMutation.isPending} disabled={!canConnect}>
							Connect
						</Button>
					</div>
				</div>
			) : (
				<div className="space-y-4">
					<p className="text-sm text-kumo-subtle">
						Signed in as <span className="text-kumo-default">{username}</span>. Pick where each folder's mail should go.
					</p>

					<div className="divide-y divide-kumo-line rounded-lg border border-kumo-line">
						{probe.folders.map((f) => (
							<div key={f.path} className="flex flex-col gap-2 p-3">
								<div className="min-w-0">
									<div className="truncate text-sm text-kumo-default">{f.name}</div>
									<div className="text-xs text-kumo-subtle">{f.messages.toLocaleString()} messages</div>
								</div>
								<select
									aria-label={`Destination for ${f.name}`}
									className={selectClass}
									value={targetToChoice(folderMap[f.path])}
									onChange={(e) => setOverrides((o) => ({ ...o, [f.path]: choiceToTarget(e.target.value, f) }))}
								>
									{TARGET_OPTIONS.map((o) => (
										<option key={o.value} value={o.value}>
											{o.label}
										</option>
									))}
									<option value="new">New folder{folderMap[f.path]?.startsWith("new:") ? `: ${folderMap[f.path]!.slice(4)}` : ""}</option>
									<option value="skip">Don't import</option>
								</select>
							</div>
						))}
					</div>

					<Banner
						variant="default"
						text={`${totals.messages.toLocaleString()} messages from ${totals.folders} folder${totals.folders === 1 ? "" : "s"} will be added to ${mailboxEmail}. Messages that are already here are skipped, so it is safe to run this again.`}
					/>

					<div className="flex justify-end gap-2">
						<Button variant="secondary" onClick={() => setProbed(null)}>
							Back
						</Button>
						<Button variant="primary" onClick={start} loading={startMutation.isPending} disabled={totals.folders === 0}>
							Start import
						</Button>
					</div>
				</div>
			)}
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function ProgressBar({ percent }: { percent: number | null }) {
	return (
		<>
			<progress className="sr-only" aria-label="Import progress" max={100} value={percent ?? undefined} />
			<div className="h-2 w-full overflow-hidden rounded-full bg-kumo-fill" aria-hidden="true">
				<div
					className={`h-full rounded-full bg-kumo-brand transition-[width] duration-500 ${percent === null ? "w-1/3 animate-pulse" : ""}`}
					style={percent === null ? undefined : { width: `${percent}%` }}
				/>
			</div>
		</>
	);
}

function Progress({ status, mailboxId }: { status: ImapImportStatus; mailboxId: string }) {
	const cancel = useCancelImapImport();
	const [confirming, setConfirming] = useState(false);
	const pct = percentDone(status);
	const left = estimateRemaining(status, Date.now());
	const done = processed(status);

	return (
		<Card>
			<div className="flex items-center gap-2 mb-4">
				<TrayArrowDownIcon size={16} weight="duotone" className="text-kumo-subtle" />
				<span className="text-sm font-medium text-kumo-default">Importing{status.source ? ` from ${status.source.host}` : ""}</span>
				<Badge variant="primary">running</Badge>
			</div>

			<ProgressBar percent={pct} />
			<div className="mt-2 flex flex-wrap items-baseline justify-between gap-2 text-xs text-kumo-subtle">
				<span>
					{status.totals.messages ? `${done.toLocaleString()} of ${status.totals.messages.toLocaleString()} messages` : "Getting ready…"}
					{pct !== null && ` · ${pct}%`}
				</span>
				{left !== null && <span>About {formatDuration(left)} left</span>}
			</div>

			<div className="mt-4 space-y-1 rounded-lg bg-kumo-recessed p-3 text-xs text-kumo-default">
				{status.currentFolder && (
					<div>
						Folder {Math.min(status.folderIndex + 1, status.totals.folders)} of {status.totals.folders}:{" "}
						<span className="font-mono">{status.currentFolder}</span>
					</div>
				)}
				<div>
					Imported {status.counts.imported.toLocaleString()} · Already here {status.counts.skipped.toLocaleString()}
					{status.counts.failed > 0 && ` · Failed ${status.counts.failed.toLocaleString()}`}
				</div>
				{status.retry && (
					<div className="text-kumo-warning">
						Lost the connection. Trying again (attempt {status.retry.attempt}) at {new Date(status.retry.nextAttemptAt).toLocaleTimeString()}.
					</div>
				)}
			</div>

			<p className="mt-3 text-xs text-kumo-subtle">
				You can close this page. The import keeps running{status.startedBy ? ` (started by ${status.startedBy})` : ""}.
			</p>

			<div className="mt-4 flex justify-end gap-2">
				{confirming ? (
					<>
						<Button variant="secondary" onClick={() => setConfirming(false)}>
							Keep importing
						</Button>
						<Button variant="destructive" loading={cancel.isPending} onClick={() => cancel.mutate(mailboxId)}>
							Stop import
						</Button>
					</>
				) : (
					<Button variant="secondary" onClick={() => setConfirming(true)}>
						Cancel import
					</Button>
				)}
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Finished, stopped or failed
// ---------------------------------------------------------------------------

function Result({ status, mailboxId, onNew }: { status: ImapImportStatus; mailboxId: string; onNew: () => void }) {
	const toast = useKumoToastManager();
	const dismiss = useDismissImportFailures();
	const retry = useRetryFailedImport();
	const [password, setPassword] = useState("");
	const [retryError, setRetryError] = useState<string | null>(null);

	const title = status.status === "done" ? "Import finished" : status.status === "canceled" ? "Import stopped" : "Import failed";
	const variant = status.status === "done" ? "success" : status.status === "canceled" ? "secondary" : "destructive";
	const shown = status.failures.slice(0, 50);
	const retryable = status.failures.some((f) => f.uid > 0);

	const doRetry = async () => {
		setRetryError(null);
		try {
			await retry.mutateAsync({ mailboxId, password });
			setPassword("");
			toast.add({ title: "Retrying failed messages" });
		} catch (e) {
			setRetryError(e instanceof Error ? e.message : "Could not start the retry");
		}
	};

	return (
		<Card>
			<div className="flex items-center gap-2 mb-3">
				<TrayArrowDownIcon size={16} weight="duotone" className="text-kumo-subtle" />
				<span className="text-sm font-medium text-kumo-default">{title}</span>
				<Badge variant={variant as "success" | "secondary" | "destructive"}>{status.status}</Badge>
			</div>

			{status.error && (
				<div className="mb-3">
					<Banner variant="error" text={status.error} />
				</div>
			)}

			<div className="rounded-lg bg-kumo-recessed p-3 text-xs text-kumo-default space-y-1">
				<div>
					Imported {status.counts.imported.toLocaleString()} · Already here {status.counts.skipped.toLocaleString()} · Failed{" "}
					{status.counts.failed.toLocaleString()}
				</div>
				{status.source && (
					<div className="text-kumo-subtle">
						From {status.source.username} on {status.source.host}
						{status.finishedAt && ` · ${new Date(status.finishedAt).toLocaleString()}`}
					</div>
				)}
			</div>

			{status.failureCount > 0 && (
				<div className="mt-4">
					<div className="text-sm font-medium text-kumo-default mb-1">Messages that could not be imported</div>
					<div className="max-h-56 overflow-y-auto rounded-lg border border-kumo-line divide-y divide-kumo-line text-xs">
						{shown.map((f) => (
							<div key={`${f.path}:${f.uid}`} className="flex flex-col gap-0.5 p-2">
								<span className="font-mono text-kumo-default">
									{f.folder}
									{f.uid > 0 ? ` #${f.uid}` : ""}
								</span>
								<span className="text-kumo-subtle">{f.reason}</span>
							</div>
						))}
					</div>
					{status.failureCount > shown.length && (
						<p className="mt-1 text-xs text-kumo-subtle">Showing {shown.length} of {status.failureCount.toLocaleString()}.</p>
					)}

					{retryable && (
						<div className="mt-3 space-y-2">
							<p className="text-xs text-kumo-subtle">Your password was deleted when the import stopped. Enter it again to retry only these messages.</p>
							{retryError && <Banner variant="error" text={retryError} />}
							<div className="flex items-end gap-2">
								<div className="flex-1">
									<Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
								</div>
								<Button variant="primary" size="sm" onClick={doRetry} loading={retry.isPending} disabled={!password}>
									Retry failed
								</Button>
							</div>
						</div>
					)}
				</div>
			)}

			<div className="mt-4 flex justify-end gap-2">
				{status.failureCount > 0 && (
					<Button variant="secondary" onClick={() => dismiss.mutate(mailboxId)} loading={dismiss.isPending}>
						Dismiss failures
					</Button>
				)}
				<Button variant="primary" onClick={onNew}>
					Import more mail
				</Button>
			</div>
		</Card>
	);
}
