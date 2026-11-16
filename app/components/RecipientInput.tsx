// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Input } from "@cloudflare/kumo";
import { useEffect, useId, useRef, useState } from "react";
import { useContactSuggestions } from "~/queries/contacts";
import { applySuggestion, currentToken, enteredAddresses } from "~/lib/recipients";

interface RecipientInputProps {
	mailboxId: string | undefined;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	required?: boolean;
	label?: string;
}

/**
 * A comma-separated recipient field that suggests past correspondents of the
 * mailbox as you type (#88). Arrow keys move through the list, Enter or Tab
 * picks, Escape dismisses.
 */
export default function RecipientInput({ mailboxId, value, onChange, placeholder, required, label }: RecipientInputProps) {
	const listId = useId();
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const wrapperRef = useRef<HTMLDivElement>(null);

	const token = currentToken(value);
	const { data: contacts = [] } = useContactSuggestions(mailboxId, token, open);
	const taken = enteredAddresses(value);
	const suggestions = contacts.filter((c) => !taken.includes(c.address));
	const showList = open && token.length > 0 && suggestions.length > 0;

	useEffect(() => setActive(0), [token]);

	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, []);

	const pick = (address: string) => {
		onChange(applySuggestion(value, address));
		setOpen(false);
	};

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (!showList) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActive((a) => (a + 1) % suggestions.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
		} else if (e.key === "Enter" || e.key === "Tab") {
			e.preventDefault();
			pick(suggestions[active].address);
		} else if (e.key === "Escape") {
			e.preventDefault();
			setOpen(false);
		}
	};

	return (
		<div ref={wrapperRef} className="relative w-full">
			<Input
				type="text"
				size="sm"
				value={value}
				placeholder={placeholder}
				required={required}
				aria-label={label}
				role="combobox"
				aria-expanded={showList}
				aria-controls={listId}
				aria-autocomplete="list"
				autoComplete="off"
				onChange={(e) => {
					onChange(e.target.value);
					setOpen(true);
				}}
				onFocus={() => setOpen(true)}
				onKeyDown={onKeyDown}
			/>
			{showList && (
				<ul
					id={listId}
					role="listbox"
					className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-kumo-line bg-kumo-base shadow-lg"
				>
					{suggestions.map((c, i) => (
						<li
							key={c.address}
							role="option"
							aria-selected={i === active}
							onMouseDown={(e) => {
								e.preventDefault();
								pick(c.address);
							}}
							onMouseEnter={() => setActive(i)}
							className={`cursor-pointer px-3 py-2 text-sm text-kumo-default ${i === active ? "bg-kumo-tint" : ""}`}
						>
							{c.address}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
