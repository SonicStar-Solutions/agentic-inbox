// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Dialog, Input, Tooltip } from "@cloudflare/kumo";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router";
import { LABEL_COLORS, type LabelColor, labelHex } from "~/lib/label-colors";
import { useCreateLabel, useDeleteLabel, useLabels } from "~/queries/labels";

/** The sidebar's Labels list with create and delete (#89). */
export default function LabelsSection({ mailboxId, onNavigate }: { mailboxId: string | undefined; onNavigate?: () => void }) {
	const { data: labels = [] } = useLabels(mailboxId);
	const createLabel = useCreateLabel();
	const deleteLabel = useDeleteLabel();
	const navigate = useNavigate();
	const location = useLocation();

	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [color, setColor] = useState<LabelColor>("blue");
	const [error, setError] = useState<string | null>(null);

	const submit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!mailboxId || !name.trim()) return;
		setError(null);
		createLabel.mutate(
			{ mailboxId, name: name.trim(), color },
			{
				onSuccess: () => {
					setName("");
					setOpen(false);
				},
				onError: (err) => setError(err instanceof Error && err.message ? err.message : "Could not create the label"),
			},
		);
	};

	const remove = (id: string, labelName: string) => {
		if (!mailboxId) return;
		if (!window.confirm(`Delete the label "${labelName}"? Messages keep their other labels and are not deleted.`)) return;
		const viewing = location.pathname.endsWith(`/label/${id}`);
		deleteLabel.mutate(
			{ mailboxId, id },
			{ onSuccess: () => viewing && navigate(`/mailbox/${mailboxId}/emails/inbox`) },
		);
	};

	return (
		<div className="pt-5">
			<div className="flex items-center justify-between px-3 mb-1.5">
				<span className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle">Labels</span>
				<Tooltip content="New label" asChild>
					<Button variant="ghost" shape="square" size="sm" icon={<PlusIcon size={16} />} onClick={() => setOpen(true)} aria-label="Create new label" />
				</Tooltip>
			</div>

			{labels.length === 0 && <p className="px-3 text-xs text-kumo-subtle">No labels yet.</p>}
			{labels.map((label) => (
				<div key={label.id} className="group/label relative">
					<NavLink
						to={`/mailbox/${mailboxId}/label/${label.id}`}
						onClick={onNavigate}
						className={({ isActive }) =>
							`flex items-center gap-3 py-2 px-3 rounded-md text-sm transition-colors ${
								isActive ? "bg-kumo-fill font-semibold text-kumo-default" : "text-kumo-strong hover:bg-kumo-tint"
							}`
						}
					>
						<span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: labelHex(label.color) }} aria-hidden="true" />
						<span className="truncate flex-1">{label.name}</span>
						{label.count ? <Badge variant="secondary">{label.count}</Badge> : null}
					</NavLink>
					<div className="absolute right-1 top-1/2 hidden -translate-y-1/2 bg-kumo-recessed group-hover/label:flex group-focus-within/label:flex">
						<Button
							variant="ghost"
							shape="square"
							size="xs"
							icon={<TrashIcon size={13} />}
							aria-label={`Delete label ${label.name}`}
							onClick={() => remove(label.id, label.name)}
						/>
					</div>
				</div>
			))}

			<Dialog.Root open={open} onOpenChange={(next) => !next && setOpen(false)}>
				<Dialog size="sm" className="p-6">
					<Dialog.Title className="text-base font-semibold mb-4">Create label</Dialog.Title>
					<form onSubmit={submit} className="space-y-4">
						<Input label="Label name" placeholder="e.g. Receipts" value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required />
						<fieldset>
							<legend className="mb-1.5 text-xs text-kumo-subtle">Colour</legend>
							<div className="flex flex-wrap gap-2">
								{LABEL_COLORS.map((c) => (
									<button
										key={c}
										type="button"
										onClick={() => setColor(c)}
										aria-label={c}
										aria-pressed={color === c}
										className={`h-6 w-6 rounded-full border-2 ${color === c ? "border-kumo-default" : "border-transparent"}`}
										style={{ backgroundColor: labelHex(c) }}
									/>
								))}
							</div>
						</fieldset>
						{error && (
							<p role="alert" className="text-xs text-kumo-destructive">
								{error}
							</p>
						)}
						<div className="flex justify-end gap-2">
							<Dialog.Close
								render={(props) => (
									<Button {...props} variant="secondary">
										Cancel
									</Button>
								)}
							/>
							<Button type="submit" variant="primary" disabled={!name.trim()} loading={createLabel.isPending}>
								Create
							</Button>
						</div>
					</form>
				</Dialog>
			</Dialog.Root>
		</div>
	);
}
