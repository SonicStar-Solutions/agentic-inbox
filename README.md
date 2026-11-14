<div align="center">
  <h1>Agentic Inbox</h1>
  <p><em>A self-hosted email client with an AI agent, running entirely on Cloudflare Workers</em></p>
</div>

Agentic Inbox lets you send, receive, and manage emails through a modern web interface -- all powered by your own Cloudflare account. Incoming emails arrive via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/), each mailbox is isolated in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) with a SQLite database, and attachments are stored in [R2](https://developers.cloudflare.com/r2/).

An **AI-powered Email Agent** can read your inbox, search conversations, and draft replies -- built with the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) and [Workers AI](https://developers.cloudflare.com/workers-ai/).

![Agentic Inbox screenshot](./demo_app.png)


Read the blog post to learn more about Cloudflare Email Service and how to use it with the Agents SDK, MCP, and from the Wrangler CLI: [Email for Agents](https://blog.cloudflare.com/email-for-agents/).

## How to setup

**Important**: Clicking the 'Deploy to Cloudflare' button is only one part of the setup. You must follow the **After deploying** steps as well. For a full step-by-step guide with screenshots, refer to this comment: 
https://github.com/cloudflare/agentic-inbox/issues/4#issuecomment-4269118513

### To set up

1. Deploy to Cloudflare. The deploy flow will automatically provision R2, Durable Objects, and Workers AI. You'll be prompted for **DOMAINS**, which is the domain (yourdomain.com) you want to receive emails for (email@yourdomain.com).

     [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/agentic-inbox)

2. **Configure Cloudflare Access** -- Enable [one-click Cloudflare Access](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/) on your Worker under Settings > Domains & Routes. The modal will show your `POLICY_AUD` and `TEAM_DOMAIN` values. `TEAM_DOMAIN` can be either your Access team URL or the full `.../cdn-cgi/access/certs` URL. **You must set these as secrets for your Worker.**
3. **Set up Email Routing** -- In the Cloudflare dashboard, go to your domain > Email Routing and create a catch-all rule that forwards to this Worker
4. **Enable Email Service** -- The worker needs the `send_email` binding to send outbound emails. See [Email Service docs](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/)
5. **Create a mailbox** -- Visit your deployed app and create a mailbox for any address on your domain (e.g. `hello@example.com`)

### Troubleshooting Access

1. If you see `Invalid or expired Access token`, that usually means `POLICY_AUD` or `TEAM_DOMAIN` secrets are incorrect.
   * Resolution: [turn Access off and back on for the Worker to get the Access modal again](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/), then reset your Worker secrets to the latest `POLICY_AUD` and `TEAM_DOMAIN` values shown there.
2. If you see `Cloudflare Access must be configured in production`, this application is intentionally enforcing Cloudflare Access so your inbox is not exposed to anyone on the internet.
   * Resolution: enable Access using [one-click Cloudflare Access for Workers](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/), then set the `POLICY_AUD` and `TEAM_DOMAIN` Worker secrets from the modal values.
3. If you still see `Invalid or expired Access token` right after enabling Access, the values that were auto-populated as secrets may not be correct. Copy `POLICY_AUD` and `TEAM_DOMAIN` from the Access modal and **re-save them yourself** (rotate the secrets).
4. If you can't find **Domains & Routes** in the dashboard, the Access toggles may now live in the Worker's **Domains** section: enable the Access checkboxes there and set the policy to *Restricted*.
5. There is no sign-up page. The only way in is through your Cloudflare Access policy, so add your own email (or group) to the Access policy for the Worker.
6. If the Deploy button fails with HTTP 400 and "GitHub authorization has expired", [reinstall the Cloudflare GitHub app](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#reinstall-the-cloudflare-github-app) with access to your account, or fork this repo and deploy your fork.

### Troubleshooting sending and the agent

- **Sending fails or mail never arrives.** Outbound mail goes through [Email Service](https://developers.cloudflare.com/email-service/), which has its own [plan requirements and limits](https://developers.cloudflare.com/email-service/platform/pricing/) (for example, sending to arbitrary recipients needs a paid Workers plan). If the service rejects a message, the app now reports the error and does not file the message in Sent. Receiving only needs Email Routing.
- **The agent does not respond.** The agent needs the Workers AI binding. Check `wrangler tail` for `Auto-draft trigger failed` or Workers AI errors. Auto-drafts are skipped for emails the prompt-injection scanner flags, and for emails the agent decides need no reply (it logs `Skipped: <reason>` in the agent chat).
- **Attachments.** Inbound attachments are stored in R2 and downloadable from the message. Outbound attachments are sent inline (subject to email provider size limits).
- **MCP.** The `/mcp` endpoint is behind the same Access check as the app. MCP clients must authenticate through Access, for example with an [Access service token](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/) (`CF-Access-Client-Id` / `CF-Access-Client-Secret` headers) allowed by your Access policy.

## Features

- **Full email client** — Send and receive emails via Cloudflare Email Routing with a rich text composer, reply/forward threading, folder organization, search, and attachments
- **Per-mailbox isolation** — Each mailbox runs in its own Durable Object with SQLite storage and R2 for attachments
- **Built-in AI agent** — Side panel with 9 email tools for reading, searching, drafting, and sending
- **Auto-draft on new email** — Agent automatically reads inbound emails and generates draft replies, always requiring explicit confirmation before sending
- **Configurable and persistent** — Custom system prompts per mailbox, persistent chat history, streaming markdown responses, and tool call visibility

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS, Zustand, TipTap, `@cloudflare/kumo`
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing
- **AI Agent:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI (default `@cf/moonshotai/kimi-k2.5`, [configurable](#ai-models)), `react-markdown` + `remark-gfm`
- **Auth:** Cloudflare Access JWT validation (required outside local development)

## Getting Started

```bash
npm install
npm run dev
```

### Configuration

1. Set your domain in `wrangler.jsonc`
2. Create an R2 bucket named `agentic-inbox`: `wrangler r2 bucket create agentic-inbox`

### Deploy

```bash
npm run deploy
```

### Multiple domains

`DOMAINS` accepts a comma-separated list, for example `"DOMAINS": "example.com,example.org"` in `wrangler.jsonc`. The home page then shows a domain picker when you create a mailbox, and the API rejects mailboxes on domains that are not listed. Enable Email Routing (and Email Service for sending) on **each** domain and point each catch-all rule at this Worker; mail is routed to the mailbox matching the SMTP envelope recipient.

### Using the HTTP API from scripts and other apps

Everything the web app does goes through `/api/v1`, which is protected by Cloudflare Access like the rest of the app. For scripts, servers or mobile apps, use an [Access service token](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/):

1. In Zero Trust, create a service token and copy the Client ID and Secret.
2. Add a policy with action **Service Auth** that includes that token to the Access application for your Worker.
3. Send the token on every request:

```bash
H1="CF-Access-Client-Id: <client-id>"; H2="CF-Access-Client-Secret: <client-secret>"
BASE=https://your-worker.example.com/api/v1

# read: list the inbox, or fetch one message
curl -H "$H1" -H "$H2" "$BASE/mailboxes/hello@example.com/emails?folder=inbox"
curl -H "$H1" -H "$H2" "$BASE/mailboxes/hello@example.com/emails/<id>"

# send (the `from` address must be the mailbox itself)
curl -H "$H1" -H "$H2" -H "Content-Type: application/json"   -d '{"to":"you@example.net","from":"hello@example.com","subject":"Hi","text":"Hello"}'   "$BASE/mailboxes/hello@example.com/emails"
```

A rejected send returns `502` with the provider error, and a rate-limited one returns `429`. The `/mcp` endpoint accepts the same headers. As with the web app, a valid token can reach every mailbox.

### AI models

Models are defined in `workers/lib/models.ts`. Override any of them with a Worker var (see the commented examples in `wrangler.jsonc`) without changing code:

| Role | Variable | Default |
| --- | --- | --- |
| Agent chat | `AI_MODEL_AGENT` | `@cf/moonshotai/kimi-k2.5` |
| Auto-draft | `AI_MODEL_AUTO_DRAFT` | `@cf/moonshotai/kimi-k2.5` |
| Prompt-injection scanner | `AI_MODEL_INJECTION_SCANNER` | `@cf/zai-org/glm-4.7-flash` |
| Draft verifier | `AI_MODEL_DRAFT_VERIFIER` | `@cf/meta/llama-4-scout-17b-16e-instruct` |

Workers AI periodically deprecates models; check the [catalog](https://developers.cloudflare.com/workers-ai/models/) and override the variable if one is retired. If the injection scanner model errors or returns no verdict, auto-draft is skipped (fail closed).

### Tests

```bash
npm test
```

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- [Email Service](https://developers.cloudflare.com/email-service/) enabled for sending
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled (for the agent)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) configured for deployed/shared environments (required in production)

Any user who passes the shared Cloudflare Access policy can access all mailboxes in this app by design. This includes the MCP server at `/mcp` -- external AI tools (Claude Code, Cursor, etc.) connected via MCP can operate on any mailbox by passing a `mailboxId` parameter. There is no per-mailbox authorization; the Cloudflare Access policy is the single trust boundary.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────>│  Hono Worker     │────>│  MailboxDO      │
│  React SPA   │     │  (API + SSR)     │     │  (SQLite + R2)  │
│  Agent Panel │     │                  │     └─────────────────┘
└──────┬───────┘     │  /agents/* ──────┼────>┌─────────────────┐
       │             │                  │     │  EmailAgent DO  │
       │ WebSocket   │                  │     │  (AIChatAgent)  │
       └─────────────┤                  │     │  9 email tools  │
                     │                  │────>│  Workers AI     │
                     └──────────────────┘     └─────────────────┘
```

## License

Apache 2.0 -- see [LICENSE](LICENSE).
