# Runbook — support pipeline (tickets, contact, MCP, custom agents)

Spec: `docs/plans/support-pipeline/SPEC.md`. Code: `src/lib/support/**`. Ships **dark**: with
`SUPPORT_PIPELINE_ENABLED` unset or anything but `true`, Betsy behaves exactly as before
(`/api/contact` emails Rafael, `/api/feedback` writes `FeedbackTicket`, everyone keeps the agent editor).
`/soporte` is live either way (contact info + form; the form uses the legacy email while dark).

Every step marked **GO** needs Rafael's explicit go-ahead (shared production DB / production Worker).

## 1. Env vars (Cloudflare Worker → container)

The Worker only forwards names listed in `CONTAINER_ENV_KEYS` (`src/cf-container-worker.ts`); all of
these are listed, so they reach the app after the next Worker deploy. Set secrets with
`wrangler secret put NAME` and plain values as Worker vars (or secrets, either works).

| Name | Kind | Value to set | Notes |
|---|---|---|---|
| `SUPPORT_PIPELINE_ENABLED` | var | `false` now, `true` at step 6 | kill switch; only the literal `true` turns it on |
| `SUPPORT_MCP_TOKEN` | **secret** | generate (below), ≥ 32 chars | bearer for `/api/mcp`; unset/short → `/api/mcp` answers 503 |
| `SUPPORT_WEBHOOK_SECRET` | **secret** | generate (below) | `Authorization: Bearer` + `X-Betsy-Signature` HMAC on the push; also the bearer for `GET /api/support/events` (≥ 16 chars) |
| `SUPPORT_AGENT_WEBHOOK_URL` | var | Advance Ticket agent URL (**open question Q3**) | https only; empty = webhook `skipped` (email + poll still work) |
| `SUPPORT_WEBHOOK_EVENTS` | var | `ticket.created` | comma list; add `ticket.customer_replied,ticket.escalated` if the agent understands them |
| `SUPPORT_AGENT_EMAIL` | var | `hola@betsycrm.com` | notification inbox (Cloudflare Email Routing → Grok Bot) — default if unset |
| `SUPPORT_ESCALATION_EMAIL` | var | `betsycrm.cr@gmail.com` | Rafael — default if unset; also where `/api/contact` mail goes while dark |
| `SUPPORT_FROM_EMAIL` | var | `Betsy <noreply@betsycrm.com>` (default) | switch to `Betsy <hola@betsycrm.com>` once Resend sends as hola@ (same verified domain) |
| `SUPPORT_PUBLIC_EMAILS` | var | `hola@betsycrm.com` | comma list on `/soporte`; set to empty to hide |
| `SUPPORT_WHATSAPP` | var | `50662470831` | digits; shown `+506 6247-0831`; empty hides |
| `SUPPORT_INSTAGRAM` | var | `betsy_crm` | handle without @; empty hides |
| `SUPPORT_HOURS` | var | e.g. `Lun–Sáb 8:00–18:00 (CR)` | empty (default) hides |
| `SUPPORT_AGENT_DRAFT_CATEGORIES` | var | `billing,agent_request` (default) | agent "public" replies in these categories become drafts for Rafael (Q4); empty = never draft |
| `SUPPORT_PUBLIC_BASE_URL` | var | optional | links in payloads/emails; default `NEXTAUTH_URL`, then `https://www.betsycrm.com` |
| `CRON_SECRET` | existing | — | the Worker cron already sends it |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | existing | — | already used by signup; when both are set the contact form requires Turnstile too (Q5) |

Defaults mean only `SUPPORT_PIPELINE_ENABLED`, `SUPPORT_MCP_TOKEN`, `SUPPORT_WEBHOOK_SECRET` and
`SUPPORT_AGENT_WEBHOOK_URL` must be set; the rest are optional overrides.

Generate each secret locally (never commit, never paste in chat):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Give the Advance Ticket agent: the MCP URL `https://www.betsycrm.com/api/mcp`, `SUPPORT_MCP_TOKEN`,
`SUPPORT_WEBHOOK_SECRET` (to verify pushes / poll), and `docs/plans/support-pipeline/AGENT_BRIEF.md`.

## 2. Deploy dark (GO)

Deploy the Worker + image as usual with `SUPPORT_PIPELINE_ENABLED=false`. Changes visible while dark:
`/soporte` page and the help-center link to it; `/api/contact` gets rate limits + spam checks;
the `*/5` cron calls `/api/cron/support-dispatch` (answers `{"status":"disabled"}`).
The Worker deploy is needed for the new env names and the cron path.

## 3. Apply SQL 059 (GO)

Additive only (4 new tables, RLS on). Take a backup first (`npm run backup:*` or the nightly R2 dump).

```bash
BETSY_V2_APPLY_FILES=059 node scripts/apply-betsy-v2-additive-sql.mjs
node scripts/verify-betsy-v2-additive-sql.mjs
```

Never `prisma db push` / `migrate` (drops `lm_*`).

## 4. Seed `custom_agents` for businesses that already run agents (GO, before step 6)

Once the switch is on, only businesses with the flag (or super admins) can open the agent editor.
The live agent keeps replying regardless; this only protects the editor.

```bash
npx tsx scripts/seed-custom-agents-flag.ts                        # dry run: prints the list
SEED_CUSTOM_AGENTS_APPLY=1 npx tsx scripts/seed-custom-agents-flag.ts --apply
```

Picks: active channel binding to a non-`human_only` agent, or an agent turn in 30 days, plus DeepSleep.
Existing rows (including an explicit OFF) are never changed. Check `/super-admin/agentes` →
"Agente personalizado por negocio": any business marked "Apagado (tiene canales)" was missed.

## 5. Backfill old feedback tickets (optional, GO)

```bash
npx tsx --import ./scripts/shim-server-only.mjs scripts/backfill-feedback-to-support.ts
SUPPORT_BACKFILL_APPLY=1 npx tsx --import ./scripts/shim-server-only.mjs scripts/backfill-feedback-to-support.ts --apply
```

No emails or webhooks for backfilled rows.

## 6. Turn it on (GO)

Set `SUPPORT_PIPELINE_ENABLED=true` (+ the secrets/URL above) and redeploy / restart the container.

Smoke test (production container only sends mail/webhooks — Railway preview never dispatches):
1. `/soporte` (logged out): WhatsApp / Instagram / email show; send the form → "Tu número de caso es BETSY-n".
   Within 5 min: email to `hola@`, ack to the sender, webhook delivered (or `skipped` if no URL).
2. Logged in: `/soporte` → "Mis tickets" lists it (when sent while logged in); open → reply.
3. Agents tab as a business without the flag → sales page → "Quiero mi agente" → `[BETSY-n] Lead agente IA — …`.
4. `/super-admin/soporte`: ticket, thread, outbox counters; reply as Rafael.
5. MCP:
   ```bash
   curl -s https://www.betsycrm.com/api/mcp -H "Authorization: Bearer $SUPPORT_MCP_TOKEN" \
     -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```
   → 8 tools. Or `npx @modelcontextprotocol/inspector` (Streamable HTTP, same URL + header).
6. Webhook check: point `SUPPORT_AGENT_WEBHOOK_URL` at a webhook.site URL for one ticket, check the
   body (`event`, `source:"betsy"`, `ticket{…}`, `betsy{…}`) and headers, then point it at the agent.

Poll fallback for the agent: `GET /api/support/events?since=<ISO>` with `Authorization: Bearer SUPPORT_WEBHOOK_SECRET`.

## 7. Enable a business's custom agent

`/super-admin/agentes` → "Agente personalizado por negocio" → Activar (pick its agents). The owner gets
"Tu agente está activo". Audited in `AuditLog` (entity `TenantFeatureFlag`, `custom_agents`).
Desactivar shows the sales page again; it does **not** stop a live agent — use the emergency stop.

## Rollback

`SUPPORT_PIPELINE_ENABLED=false` → legacy behavior immediately (tickets stay in the tables, ignored).
The tables can stay. Removing the code: revert the PR; nothing else depends on 059.

## Data notes

- `SupportTicket.contactEmail` / `meta.phone` are personal data. The Ley 8968 export/erase work (on hold)
  must include `SupportTicket*` rows when it ships.
- Raw IPs are never stored (`meta.ipHash` = salted sha256). Webhook pushes carry a masked email only.
