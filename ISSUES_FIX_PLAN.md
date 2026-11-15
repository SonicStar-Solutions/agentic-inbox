# Fix plan for cloudflare/agentic-inbox issues

Reviewed 2026-11-14 against `main` @ 48039bb (clean, same as upstream HEAD). 34 issues: 29 open, 5 closed.
Upstream has ~28 open PRs, so many items below are "adopt/port an existing PR" rather than writing from scratch.
Test infra: none (no test script, no `.github/`), so Phase 0 adds a minimal one.

## Triage summary

| Bucket | Issues |
|---|---|
| Real bugs, reproduced against this code | #83, #84, #85, #32, #57, #73, #36, #16, #86 (closed), #87 (closed) |
| Hardening / observability | #18, #19, #17 (*), #30 |
| Features (decide whether to take) | #8, #9, #11, #41, #47, #29, #88/#89 (closed, backlog list) |
| Docs / support questions (no code, or README only) | #4, #5, #6, #27, #31, #54, #77 |
| Not applicable / no action | #22 (*), #35, #61, #67, #70 |

(*) #17 and #22 point at `workers/intel/` (deep-scan, feeds, bloom filter). That directory does **not exist** in this checkout. The issues were written against someone's fork. Skip unless you add that subsystem.

## Phase 0: groundwork (small, do first)

1. Add Vitest and a `test` script. Several fixes below need regression tests. Upstream PR #62 does deps + CI, so port that rather than redoing it.
2. Add a `parseJsonBody` helper (see #16) because Phase 1 touches the same routes.

## Phase 1: correctness bugs (highest value)

Order matters for the send path: #84 before #83.

### 1. #84 Rejected sends reported as sent (P1)
- `workers/index.ts:166-211`, `workers/routes/reply-forward.ts:58-112, 148-197`.
- Today: `createEmail(SENT)` -> `waitUntil(sendEmail().catch(log))` -> 202 `{status:"sent"}`.
- Fix: `await sendEmail()` first, return 4xx/5xx with the binding's message on failure, and only then write to Sent. Keep the rate-limit check ahead of both. MCP tools in `workers/lib/tools.ts` already await the send; align the order there too.
- Test: binding that throws -> response is an error and Sent folder is empty. Control: accepted send still lands in Sent.
- This also resolves most of #27 and #19's server side.

### 2. #83 Stored Message-ID is never the one sent (P2)
- `generateMessageId` in `workers/lib/email-helpers.ts:85-92`; all send sites.
- Fix: after #84 awaits `sendEmail`, store the `messageId` the binding returns as `message_id` and in the stored `message-id` header. Caveat from the issue: production Email Service Message-ID format is unverified, so check the real `send()` return on a deployed worker before relying on it. If it is not the delivered header, fall back to documenting the limitation.
- Depends on #84.

### 3. #85 Inbound replies land in a separate thread (P2)
- `workers/index.ts:383-391`: `threadId = references[0] || inReplyTo || messageId`.
- Fix: look up stored `message_id` for every referenced ID (add a `findThreadByMessageIds` method to `MailboxDO`); use that thread's `thread_id`, else keep current behaviour, else subject fallback. Upstream PR #81 already does this; review and port it with its tests.
- Follow-up after #83: replies to messages composed in the app only match once the real sent Message-ID is stored.

### 4. #32 Route inbound mail by envelope recipient (P2, silent mail loss)
- `workers/index.ts:348-367`, `workers/app.ts:113`.
- Fix: use `event.to` (lowercased) as `mailboxId`; type the handler as `ForwardableEmailMessage`; keep header parsing for display. Honour `EMAIL_ADDRESSES`. Cc-only, Bcc and list mail then work, and mail can no longer land in the wrong mailbox (second comment on the issue).
- There are three competing PRs (#48, #78, #82). Pick one (#82 or #78 look closest to the proposal), close the rest, and ensure `recipient` still stores the header list for display. Also remove the `parsedEmail.to` "empty to" throw, which breaks Bcc-only mail.

### 5. #57 Auto-draft 500 for never-opened mailboxes
- `workers/index.ts:405`: raw `idFromName` stub misses the partyserver set-name handshake.
- Fix: `getAgentByName(env.EMAIL_AGENT, mailboxId)` from `agents`, then `.fetch(...)`. One line; upstream PR #65 is exactly this. Add a log at `error` level (see #18/#17 theme) so it is visible if it recurs.

### 6. #73 "No reply needed" becomes a junk draft
- `workers/agent/index.ts:475-481` (text fallback) plus `DEFAULT_SYSTEM_PROMPT`.
- Fix: add a `skip_email` tool with a `reason`; when called, skip the inline-text fallback and log "Skipped: <reason>". Update the default prompt so the agent may decline for spam/newsletters/automated mail. Keep the fallback for model-wrote-draft-as-text.

### 7. #36 Long search strings 500
- `workers/durableObject/index.ts:679-687`: DO SQLite rejects LIKE patterns over 50 chars.
- Fix: chunk each term into <=48-char pieces and AND the chunk predicates. Several PRs exist (#37, #40, #56). #56 truncates (silently changes results); prefer chunking (#37). Apply to `query`, `from`, `to`, `subject`. Return 400 for absurd lengths (e.g. >500).

### 8. #16 Malformed JSON gives 500
- Five sites: `workers/index.ts:103, 170, 216`, `workers/routes/reply-forward.ts:27, 118`.
- Fix: `parseJsonBody(c, Schema)` returning a discriminated union, 400 on failure. PR #38 does this. Mechanical.

### 9. #86 Preview shows `&lt;` (closed, but real)
- `app/components/email-panel/ThreadMessage.tsx:94` uses `stripHtml(...).slice(0, 80)`; `stripHtml` in `app/lib/utils.ts:77` does not decode entities on that path (a separate `decodeHtmlEntities` exists at :81). Decode before truncating; add a unit test.

### 10. #87 "Edit & send in composer" (closed, real)
- `app/components/AgentPanel.tsx:~415-440`: matches `toolName === "draft_reply"` + `result`, but AI SDK v6 parts are `type: "tool-draft_reply"` with `output`, and the result has `draftId`, not `id`, and no `in_reply_to`. Reuse the existing `getToolNameFromPart` helper (line ~101), read `output`/`draftId`, load the saved draft with threading info, and delete the draft on send. Verify in the browser.

## Phase 2: hardening and observability

- **#18** log rate-limit hits (`workers/index.ts:184`, `reply-forward.ts:53,143`, `tools.ts:409,487`): one structured log line per 429. PR #39. Also PR #59 fixes the rate limit counting a full day; review that alongside.
- **#19** add `isPending`/`isError` handling and toasts in the mutations listed (email list, AgentPanel, ComposeEmail, search, pagination). Do after #84, since errors only surface once the server reports them.
- **#30** deprecated models: `@cf/meta/llama-3.1-8b-instruct-fast` in `workers/lib/ai.ts:33` is a deprecated family (`llama-3.1-8b-instruct` listed). Replace with a supported small model (e.g. GLM 4.7 Flash or Gemma 4); check the catalog for the exact ID and that `-fast` is covered. kimi-k2.5 is aliased to k2.6, so no urgency there. PR #34 does the injection-model swap. Do together with #41 so the model lives in one place.
- **#17** only if a deep-scan pipeline is added; otherwise close as not applicable to this tree.

## Phase 3: features (prioritised, each optional)

1. **#41 + #11 configurable models and per-mailbox auto-draft toggle.** One shared model-config module (env overrides, defaults unchanged), then a per-mailbox `autoDraft.enabled` and `agentModel` in the R2 settings blob plus a Settings UI. PR #43 covers #41. Takes care of #30 cleanly.
2. **#8 multiple domains.** The code already splits `DOMAINS` on commas (per the comment), so the gap is the UI. PR #49. Moderate.
3. **#9 / #29 send/read API.** Needs an auth design first (Access service tokens vs API keys; see #5). Don't start until that is decided. Related PRs: #66 (scoped per-mailbox access + remote MCP), #68 (make agent/MCP optional), #74-76 (MCP tools).
4. **#47 large attachments via R2 links.** Large design (signed links, multipart, expiry). Park unless needed. Note PRs #79 and #80 fix outbound attachment decoding and rollback on insert failure, which are worth taking regardless.
5. **#88 / #89 backlog** (remote-image blocking, recipient autocomplete, bulk actions, keyboard shortcuts, search index, dark mode, folding quoted text, signature editor, send-later, mailbox delete leaving data behind, inbound `date` using receipt time). Take only the cheap, high-value ones: remote-image blocking (privacy), mailbox-delete purge (PR #60), inbound Date header, dead-code removal.

## Phase 4: docs and support-type issues (README changes only)

- **#4** Access setup keeps tripping people: the README already has a troubleshooting section. Add: Access auto-populated `POLICY_AUD`/`TEAM_DOMAIN` secrets may be wrong and must be rotated; the "Domains & Routes" UI moved; GitHub reauthorization error on Deploy; `Invalid or expired Access token` vs `Cloudflare Access must be configured`.
- **#5** MCP: document that `/mcp` sits behind the same Access JWT check (`workers/app.ts:~50-90`), so clients need an Access service token header. Note PR #66 for scoped access.
- **#6, #27** Email sending needs a Workers Paid plan. State plainly in Prerequisites and in the send error from #84.
- **#77** AI/agent not responding on free plan: confirm whether Workers AI free allocation is the cause; document, and make the agent panel show an error instead of silence (ties to #19).
- **#31** inbound attachments: appear to work in code (stored to R2 on receive); reproduce and document, or find the real gap (links in HTML mail are noted as sandboxed in #88).
- **#54** "Only lets me log in": there is no sign-up, since login is Cloudflare Access. One README sentence.

## No action

- **#22** PhishDestroy feed: no `workers/intel` here.
- **#35** vendor pitch for a security layer; reply or ignore.
- **#61** your own mobile client; leave open or close at your discretion.
- **#67** not a code issue.
- **#70** "is this dead?": since this is your fork, the answer is to ship the fixes.

## Suggested PR sequence (each independently reviewable)

1. Tests + `parseJsonBody` (#16)
2. Send path: await send, 4xx on failure (#84), then real Message-ID (#83)
3. Envelope routing (#32) and auto-draft handshake (#57)
4. Inbound threading (#85)
5. Agent `skip_email` (#73), search chunking (#36)
6. UI fixes (#86, #87) and mutation states (#19)
7. Models config + deprecation (#41, #30, #11), rate-limit logging (#18)
8. README/docs pass (#4, #5, #6, #27, #54, #77, #31)

Biggest open question: for steps 2-4 (and others), upstream PRs already exist. Merging their branches into your fork saves time but you should review each (several overlap, e.g. #32 has three competing PRs).

