# Plan: mailbox import (migrate from any IMAP provider)

## Status (branch `feat/imap-import`)

Phases 0–3 are implemented. Phase 4 (file import, Gmail labels, Mobile, scheduled re-sync) is not started.

Where the build differs from the plan above:

- **Transport:** the IMAP client runs on `cloudflare:sockets` (not `node:tls`), behind a small `ImapTransport` interface. That gave STARTTLS (Phase 1 item 8) and lets tests drive the client with a scripted fake. The `node-tls.d.ts` shim was not needed.
- **Gmail "All Mail"** maps to Archive and is imported **last**, instead of being skipped. Archived Gmail mail exists only there, and Message-ID de-duplication stops everything else from being stored twice.
- **Windowed fetching:** each folder is walked in UID windows (headers for ~50 messages per round trip), so duplicates are skipped without downloading them and no UID list is kept in storage. The per-folder cursor is just `UIDVALIDITY` plus the next UID.
- **Engine split out:** the state machine is `workers/lib/import-engine.ts` (testable without Durable Object code); `ImportJobDO` only owns storage and alarms.
- **Password field:** a plain password input, because Kumo's `SensitiveInput` masks a value and reveals it on click, which is wrong for entry.
- Existing live deployments: `ImportJobDO` keeps its name and migration tag v4, so existing state stays reachable.

Verified against real servers from `wrangler dev`: TLS on 993 and STARTTLS on 143 connect, the greeting is parsed, and a bad login comes back as a clear "rejected" error. The folder list, fetch and import path is covered by scripted-server tests only; it has **not** been run against a real mailbox yet.

## Goal

Any user of a deployment can open a mailbox, enter their old provider's IMAP details, press Start and watch
their mail move into Agentic Inbox, with no scripts and no operator involvement. The import survives closing
the tab, can be cancelled and resumed, and never duplicates or triggers the AI agent.

## Starting point

The private `Worker` project already has a working but one-off Purelymail importer (commit `aaa2624`):

| Piece | File in `Worker` | Reuse |
|---|---|---|
| Background job, alarm ticks, 5 messages per tick | `workers/durableObject/importJob.ts` (`ImportJobDO`) | Keep the design, harden it |
| Minimal IMAP client on `node:tls` | `workers/lib/imap-client.ts`, `node-tls.d.ts` | Keep, extend (see Phase 1) |
| Store one parsed message, bypassing the agent | `workers/lib/import-shared.ts` | Keep as is |
| Start/status/cancel routes | `workers/routes/importImap.ts` | Keep, add validation and presets |
| Raw MIME single-message endpoint | `workers/routes/import.ts` | Optional, Phase 4 |
| Settings UI and query hooks | `app/routes/settings.tsx`, `app/queries/imapImport.ts` | Rebuild as a proper Import page |

**The live `agentic-inbox` Worker already has `ImportJobDO` (migration tag v4).** `wrangler.jsonc` in this
repo already carries the v4 tag, so we keep the class name `ImportJobDO` and bring the class back rather than
deleting it. That also means existing job state on the live Worker stays reachable.

Gaps in the current code that must be fixed before it is safe for everyone:

1. **No de-duplication.** The `skipped` counter exists but is never incremented, and `createEmail` does not
   check `message_id`. Starting twice, or resuming after a crash, duplicates mail.
2. **Name-based folder mapping.** `INBOX`, `Sent`, `Junk`... only works for a handful of servers. Gmail
   (`[Gmail]/Sent Mail`, `[Gmail]/All Mail`), iCloud and Outlook use other names, and `All Mail` would import
   every message twice.
3. **Any error ends the job.** A dropped connection or throttle mid-run sets `status: "error"` instead of retrying.
4. **No totals.** The UI can show counts but not progress (`12,400 of 80,000`).
5. **Failures are not listed.** Only a count; nothing says which messages failed or why.
6. **Unvalidated host/port.** Users can aim the Worker's outbound socket at any host.
7. **Whole class of providers unsupported:** non-ASCII folder names (modified UTF-7), STARTTLS (port 143).
8. **UI copy is wrong.** It says the password "is never stored". It is held in Durable Object storage until the
   job stops. Say that, accurately.
9. **Per-message live updates.** Each `createEmail` calls `#notify("emails")`, which would flood connected
   browsers during a large import.

## Design decisions

- **One job per mailbox**, keyed by mailbox ID (as today). Starting while one is running returns 409.
- **Password lifetime:** kept only in the job's own storage, wiped on done, error, cancel, and after 24 hours
  idle. Never logged, never returned by the API, never stored in R2 or the mailbox DB.
- **Idempotent by `Message-ID`:** a message whose `Message-ID` already exists in the mailbox is skipped and counted
  as skipped. Messages with no `Message-ID` get a stable synthetic key (hash of `Date + From + Subject + size`).
- **Resume cursor:** per source folder store `UIDVALIDITY` and the last imported UID. A resume continues from
  there; if `UIDVALIDITY` changed, fall back to Message-ID de-duplication.
- **Imported mail is quiet:** no auto-draft, no agent, no send. Keep the "never references `EMAIL_AGENT`" rule and
  add a test that enforces it.
- **Read-only against the source:** only `LOGIN`, `LIST`, `SELECT` (use `EXAMINE`), `UID SEARCH`, `UID FETCH`.
  Never delete or flag anything on the old server.
- **Auth model unchanged (decided):** routes sit behind Cloudflare Access and `requireMailbox`, like every other
  route. Anyone who passes the shared Access policy can import into any mailbox, matching the rest of the app
  (there is no mailbox-owner concept). Two guard rails instead: the UI confirms the target mailbox
  ("Import into support@yourdomain.com"), and the job records who started it (the email from the Access JWT)
  and logs it.

## Phases

### Phase 0 — Port and make it build (0.5 day)

- Copy `importJob.ts`, `imap-client.ts`, `node-tls.d.ts`, `import-shared.ts`, `importImap.ts` from `Worker`.
- Re-add `export { ImportJobDO }` in `workers/app.ts`, the `IMPORT_JOB` binding and `ImportJobDO` type in
  `workers/types.ts`, the binding in `wrangler.jsonc` (and `wrangler.local.jsonc`), and the three routes in
  `workers/index.ts`.
- Replace the "temporary, delete after migration" headers with permanent-feature comments.
- Exit: `npm run typecheck`, `npm run lint`, `npm test` all pass; the feature works as it did in `Worker`.

### Phase 1 — Correctness and resilience (2 days, tests first)

1. **Dedupe.** Add `findEmailIdByMessageId` (or reuse the `message_id` lookup already in `findThreadByMessageIds`)
   and skip existing. Increment `skipped`. *Test:* importing the same message twice yields one row.
2. **Resume cursor** per folder (`UIDVALIDITY` + last UID) saved every tick. *Test:* kill after N messages,
   resume, no duplicates and no gaps.
3. **Totals.** After `SELECT`, record the folder's message count; expose `totals: { folders, messages }` and the
   current folder position. Add all folders' counts up front for an overall percentage.
4. **Transient-error retry.** Reconnect with backoff (e.g. 5 tries: 2, 5, 15, 30, 60 s) before failing the job.
   Treat `NO`/`BAD` on a single message as a per-message failure, not a job failure.
5. **Failure log (decided).** Keep the first 200 failures (`folder`, `uid`, `reason`) in job state; expose in
   status; add `POST …/import/imap/retry-failed`. The log survives after the job ends and is cleared when the
   next import starts or the user presses **Dismiss** (`POST …/import/imap/dismiss-failures`). It stores no
   subjects or senders. Because the password is wiped when the job stops, *Retry failed* asks for it again.
6. **Special-use folder mapping.** Parse `LIST` attributes (`\Sent`, `\Drafts`, `\Trash`, `\Junk`, `\Archive`,
   `\All`, `\Flagged`) and map by attribute first, name second. Default mapping:
   INBOX → inbox, `\Sent` → sent, `\Trash` → trash, `\Junk` → spam, `\Archive` → archive,
   `\Drafts` → archive (not `draft`, which renders as a live compose session), everything else → a new
   folder with the source name (created on demand), `\All` and `\Flagged` skipped. Show the mapping in the UI
   and let the user change it.
7. **Folder names.** Decode/encode modified UTF-7 so `Entwürfe` or `送信済み` work.
8. **STARTTLS.** Support port 143 with STARTTLS as well as implicit TLS on 993.
9. **Quiet notifications.** Add a `createEmailsBulk`/"import mode" on `MailboxDO` that suppresses per-email
   `#notify` and sends a single `changed` event per tick.
10. **Threading (decided).** Header threading (`References`, then `In-Reply-To`) stays first. Add an
    import-only subject fallback that is stricter than the live one (`findThreadBySubject` only looks at the
    last 7 days, which is useless for old mail): group by normalized subject only when the senders or
    recipients overlap with the candidate thread and the message is within 30 days of that thread's latest
    message; never group on an empty or generic subject (e.g. "Hello", "Invoice", "(no subject)"). Put the rule
    in a small pure function with unit tests, and run it in the importer rather than changing the live path.
    Also verify imported mail is searchable (FTS).
- Exit: a 20k-message fixture mailbox imports, is killed and resumed twice, and ends with exactly 20k rows.

### Phase 2 — Safe for anyone (1 day)

- **Host validation:** hostname only (no IP literals), reject `localhost`, `*.local`, `*.internal`, private and
  link-local ranges, and any host that resolves to Cloudflare's own network; allow ports 993 and 143 by default.
  Make the port list configurable by an optional `IMPORT_ALLOWED_PORTS` variable.
- **Provider presets** (host, port, notes shown in the UI):
  Gmail (`imap.gmail.com:993`, app password required), iCloud (`imap.mail.me.com`, app-specific password),
  Yahoo (`imap.mail.yahoo.com`, app password), Fastmail (`imap.fastmail.com`), Purelymail
  (`imap.purelymail.com`), Zoho, and "Other (enter manually)".
  Microsoft 365 / Outlook.com no longer accept password IMAP; the UI says so and points to the `.eml`/mbox
  fallback in Phase 4. OAuth sign-in is out of scope for this plan.
- **Limits:** skip messages over 25 MB (record as failure with the reason), one job per mailbox, and an
  overall cap on concurrent jobs per deployment if abuse appears (not needed up front).
- **Secrets hygiene:** redact credentials in every `console.*` call; the status endpoint never returns them.
- Exit: unit tests for the host validator and a test asserting the status payload contains no password.

### Phase 3 — UI (1.5 days)

- New **Import** page at `/mailbox/:id/import`, linked from Settings and the sidebar footer. Move the IMAP form
  out of Settings.
- Steps: (1) choose provider or enter details, (2) **Test connection** (new `POST …/import/imap/test`, connects,
  lists folders and counts, never imports), (3) review and edit the folder mapping and see message counts,
  (4) Start, (5) live progress.
- Progress: overall bar and counts (imported / skipped / failed / total), current folder, elapsed and estimated
  time, **Cancel**, and after finishing a **Failures** list (folder, UID, reason) with *Retry failed* and
  **Dismiss**. A confirmation names the target mailbox before Start.
- Accurate privacy copy: "Your password is kept only while the import runs and deleted when it stops. We only
  read from your old account; nothing there is changed."
- Handle `running`, `done`, `error`, `canceled` and "resume previous import" states; poll status every 2 s while
  running, back off when the tab is hidden.
- Follow `PRODUCT.md`/design tokens and use Kumo components like the rest of the app.
- Exit: manual pass on desktop and phone width, light and dark themes.

### Phase 4 — Optional follow-ups (separate PRs)

- **File import (first follow-up; decided: IMAP ships first):** upload `.eml` files or an `.mbox` archive. This is
  the only route for Microsoft 365 and Outlook.com, which no longer allow password IMAP, so the Import page
  says so and points here. Reuse `import-shared.ts`; stream to avoid the Worker's body limit; process in a DO
  job like IMAP.
- **Gmail labels** (`X-GM-LABELS`) → Agentic Inbox labels, once the label feature is stable.
- **Mobile app:** the status API is stable, so Mobile can show the same flow later.
- **Scheduled re-sync** ("pull new mail from the old account for N days during cutover").

## Testing

- **Unit:** IMAP response parser using recorded transcripts from Gmail, Dovecot, iCloud and Purelymail
  (literals, `BODY[]` with CRLF, `\Seen`/`\Flagged`, `LIST` special-use attributes, modified UTF-7).
- **Job state machine** with an injected fake `ImapClient`: happy path, retry then success, retry then fail,
  cancel mid-run, resume with the same and a changed `UIDVALIDITY`, duplicate `Message-ID`, oversized message,
  no `Message-ID`.
- **Agent isolation:** a test that importing a message does not call `EMAIL_AGENT` or send anything.
- **API:** start/status/cancel/test/retry-failed with Hono test helpers like `workers/routes/*.test.ts`;
  host validation cases; 409 on double start.
- **Integration:** run a local Dovecot (Docker) seeded with a few thousand messages; import into `npm run dev`.

## Rollout

1. Land Phase 0 + 1 + 2 behind the existing app (no flag needed; the feature only runs when a user starts it).
2. Deploy to the live `agentic-inbox` Worker. The v4 migration already exists there, so no new migration is
   needed unless you add a new Durable Object class. If a later change adds one, append v5; never rewrite
   v1–v4.
3. Update the README (features, "Importing from another provider", privacy note, troubleshooting for Gmail app
   passwords and Microsoft accounts) and the API section.
4. Retire the private `Worker` importer once the public one has imported your own Purelymail mailbox cleanly.

## Decisions

All four earlier open questions are settled:

1. **Subject threading:** yes for imports, with a stricter rule than live mail (30-day gap, sender/recipient
   overlap, generic subjects excluded). See Phase 1 item 10.
2. **Who may import:** any user of the deployment, as for the rest of the app. Target-mailbox confirmation and
   an audit log of who started the import. See Design decisions.
3. **Failed-message log:** kept until the next import starts or the user dismisses it; no subjects or senders
   stored; password requested again on retry. See Phase 1 item 5.
4. **Order:** IMAP first, file upload first among the Phase 4 follow-ups.

## Effort

| Phase | Estimate |
|---|---|
| 0 Port and build | 0.5 day |
| 1 Correctness and resilience | 2 days |
| 2 Safe for anyone | 1 day |
| 3 UI | 1.5 days |
| **Total to ship** | **about 5 days** |
