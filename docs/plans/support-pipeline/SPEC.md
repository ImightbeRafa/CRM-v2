# Betsy Support Pipeline — AI support, contact, tickets, MCP, custom-agent sales + per-tenant enablement

Status: PLAN (docs only). Owner: Rafael. Implementer: local Claude Code (`D:\Coder\CRM-v2`).
Target: ONE fat PR against `dev`. Never merge without Rafael's explicit "merge". Claudio deploys (wrangler / Cloudflare Containers) only on Rafael's word.
Modeled on Advance AI (`ImightbeRafa/IANAI`: `api/ticket-events.ts`, `api/lib/ticket-events.ts`, `api/lib/mcp/admin-tools.ts`, `src/pages/AdminTickets.tsx`, `src/components/FeedbackButton.tsx`).

---

## 0. Goal (Rafael, revised Oct 22 2026)

- **Everything flows through Grok Bot** (the existing Advance **Ticket** Grok agent) while the flow is refined. Every contact, ticket and agent lead becomes a Betsy ticket → webhook on arrival to the Ticket agent + notification email to **hola@betsycrm.com** (Grok Bot manages that inbox).
- **Support / Contacto page** shows business contact info from config (WhatsApp, Instagram, emails) plus the ticket form and "Mis tickets".
- **Agents tab for users = SALES page**: "¿Querés un agente de IA en tu negocio?" + CTA that creates a lead ticket `agent_request` routed to the Ticket agent. Rafael sells custom-built agents. Users have **no agent access by default**.
- Once Rafael builds a tenant's agent, he **enables it per tenant from super-admin**; that tenant then sees/uses its agent on its channels.
- **Super-admin and any Regular/Enhanced review views are Rafael's internal tools only** — no user-facing tiers.
- An **MCP** on the Betsy site lets the Ticket agent read/answer tickets.

## 1. Grounding: what exists today (dev @ 4561866)

| Area | Current state | Reuse |
|---|---|---|
| Stack | Next.js 15 App Router, Prisma + Supabase Postgres, NextAuth JWT | yes |
| Tickets | `FeedbackTicket` model (tenantId, userId required; category/subject/description/status/priority/adminNotes). `src/app/api/feedback/route.ts` GET/POST for the logged-in user. No admin UI, no webhook, no email. | extend into the new pipeline |
| Contact | `src/app/api/contact/route.ts`: public POST → Resend email to a hardcoded `betsycrm.cr@gmail.com`; no DB row, no rate limit, no spam check. | replace internals |
| Email | Resend, `src/lib/email.ts`, from `noreply@betsycrm.com` | yes |
| Rate limit | `src/lib/rate-limit.ts` (`createRateLimit`, `createIdentifierRateLimit`, `getClientIP`, Upstash + memory fallback) | yes |
| Roles | `Membership.role` OWNER/ADMIN/MANAGER/SALES/PRODUCTION/VIEWER; `User.isSuperAdmin`; `src/lib/super-admin-helpers.ts` (`isSuperAdmin`, `isSuperAdminRequest`); `hasSessionPermission` | yes |
| Flags | `TenantFeatureFlag` (scope = `global` or tenantId, `key`, `enabled`, `config Json`), `src/lib/feature-flags.ts` `isTenantFeatureEnabled` | **use for agent entitlement** |
| Agents | Soft AI agents: `ChatAgent` + `/config/agentes` (editor, gated `update_config`, flag `chat_agent_layer_v1`) | the custom agents Rafael builds are these rows; tenant access is gated by the new `custom_agents` flag |
| API keys | `ApiKey` (tenant-scoped SHA256 hash) | pattern only; MCP uses its own token |
| Super admin | `/super-admin` page + `/api/super-admin/tenants/[tenantId]` | add toggle here |
| MCP | **none** | new |
| Migrations | raw SQL in `supabase/migrations/NNN_*.sql`, gated by manifest + `BETSY_V2_APPLY_FILES`; **never** `prisma db push/migrate` (drops `lm_*`) | follow exactly |

Advance pattern being copied:
- `ticket.created` payload builder (pure function) + outbound POST to `TICKETS_EVENT_WEBHOOK_URL` with `Authorization: Bearer TICKETS_WEBHOOK_SECRET`; GET poll `?since=` as a fallback (secret or admin session); timing-safe compare.
- Client fires notify after save; "ticket already saved, poll picks it up" if notify fails.
- MCP admin tools: `admin_list_tickets`, `admin_get_ticket`, `admin_update_ticket`, plus masking (`maskEmail`, `redactSecrets`, `scrubPageUrl`) before anything reaches the agent.

Improvement over Advance: delivery is **server-side with an outbox** (no client-triggered notify; retries; idempotency key), and the agent can **reply** (thread) instead of only changing status.

## 2. Design (pstack architect: two candidates, one synthesis)

**Candidate A — DB-first tickets + outbox webhook + MCP (chosen).** Every channel (contact form, in-app, AI chat escalation, later inbound email) writes `SupportTicket` + `SupportTicketMessage`. A `SupportTicketEvent` outbox row is written in the same transaction; a dispatcher POSTs it to the Grok agent and sends the notification email. The agent acts only through MCP tools.

**Candidate B — Email-first.** Betsy just emails the support inbox; Grok Bot treats the mailbox as the system of record. Rejected: no tenant isolation, no status in the dashboard, users can't see their tickets, Betsy can't enforce who sees what, and the inbox does not exist yet.

Red-flag screen: A has one write path (`createSupportTicket()` in `src/lib/support/tickets.ts`) that every route calls, so an agent copying the nearest example cannot skip the outbox or the spam check. Interface kept small: 1 lib module, 4 routes, 1 MCP route.

Synthesis: A, with email as a notification side effect of the outbox (not the record), and inbound email left as Phase 2 (`source='email'` already in the enum).

### Usage sketch (caller first)

```ts
// any route
const ticket = await createSupportTicket({
  source: 'contact_form',            // 'contact_form' | 'in_app' | 'ai_chat' | 'email' | 'agent_request'
  tenantId: null,                    // null for public contact
  userId: null,
  contact: { name, email },
  subject, body, category: 'question',
  meta: { pageUrl, locale, userAgent, ipHash },
})
// -> row + first message + outbox event 'ticket.created' in ONE transaction
await dispatchPendingSupportEvents({ limit: 10 })   // after() / cron; idempotent
```

### Module map

```
src/lib/support/
  types.ts            // SupportTicketSource, Status, Priority, Category, payload types
  tickets.ts          // createSupportTicket, addTicketMessage, updateTicket, listTicketsForUser, getTicketForUser
  events.ts           // buildTicketEventPayload (pure), dispatchPendingSupportEvents, signPayload
  notify.ts           // sendTicketNotificationEmail (to SUPPORT_AGENT_EMAIL), sendCustomerReplyEmail
  spam.ts             // honeypot, min-fill-time, Turnstile verify, link/size heuristics
  redact.ts           // maskEmail, redactSecrets (port from Advance admin-tools.ts)
  agent-access.ts     // isCustomAgentEnabled(tenantId); setCustomAgentEnabled (super admin only)
  contact-config.ts   // getSupportContactConfig(): {whatsapp, instagram, emails, hours} from env (section 8)
  mcp/
    protocol.ts       // JSON-RPC 2.0: initialize, tools/list, tools/call
    auth.ts           // bearer SUPPORT_MCP_TOKEN (timing-safe) -> {actor:'support_agent'}
    tools.ts          // tool registry (section 5)
src/app/api/support/contact/route.ts       // public POST (replaces /api/contact internals; keep /api/contact as thin alias)
src/app/api/support/tickets/route.ts       // GET mine / POST in-app
src/app/api/support/tickets/[id]/route.ts  // GET thread / POST user reply
src/app/api/support/events/route.ts        // GET poll ?since= (secret) / POST dispatch (cron secret)
src/app/api/mcp/route.ts                   // MCP endpoint (POST JSON-RPC; GET -> 405)
src/app/api/super-admin/tenants/[tenantId]/custom-agents/route.ts  // PUT {enabled, agentIds}
src/app/api/support/agent-request/route.ts // sales lead from /agentes
src/app/api/support/contact-config/route.ts // public contact info
src/app/agentes/page.tsx                   // Agents tab: sales page (default) or link to the tenant's enabled agent
src/app/super-admin/... SupportTicketsPanel + CustomAgentToggle (Rafael only)
src/app/soporte/page.tsx                   // business contact info + ticket form + "Mis tickets"
```

## 3. Data model — `supabase/migrations/030_support_pipeline.sql` (+ matching `schema.prisma` models)

Check other open branches first: if `030` is taken, use the next free number. Additive / expand-only, `BEGIN; SET LOCAL lock_timeout='3s'; statement_timeout='30s'`, `CREATE ... IF NOT EXISTS`, registered in the migration manifest but NOT in `DEFAULT_APPLY_FILES`. Header: "HUMAN APPROVAL REQUIRED BEFORE EXECUTION AGAINST SHARED SUPABASE". Apply only via `BETSY_V2_APPLY_FILES=030` after Blob backup.

```sql
CREATE TABLE IF NOT EXISTS public."SupportTicket" (
  "id" text PRIMARY KEY,                       -- cuid
  "number" bigserial UNIQUE,                   -- human ref: BETSY-1042
  "tenantId" text NULL REFERENCES public."Tenant"(id) ON DELETE SET NULL,
  "userId"   text NULL REFERENCES public."User"(id)   ON DELETE SET NULL,
  "source"   text NOT NULL,                    -- contact_form|in_app|ai_chat|email|agent_request
  "category" text NOT NULL DEFAULT 'question', -- bug|billing|question|feature|agent_request|other
  "priority" text NOT NULL DEFAULT 'normal',   -- low|normal|high|critical
  "status"   text NOT NULL DEFAULT 'open',     -- open|ai_answered|waiting_customer|escalated|resolved|closed|spam
  "subject"  text NOT NULL,
  "contactName"  text NULL,
  "contactEmail" text NOT NULL,
  "assignee" text NOT NULL DEFAULT 'grok_agent', -- grok_agent|rafael
  "meta" jsonb NOT NULL DEFAULT '{}',          -- pageUrl, locale, ua, ipHash (never raw IP)
  "legacyFeedbackTicketId" text NULL UNIQUE,
  "lastCustomerMessageAt" timestamptz NULL,
  "lastAgentMessageAt" timestamptz NULL,
  "resolvedAt" timestamptz NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "SupportTicket_tenant_status_idx" ON public."SupportTicket"("tenantId","status");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_created_idx" ON public."SupportTicket"("status","createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SupportTicket_email_idx" ON public."SupportTicket"(lower("contactEmail"));

CREATE TABLE IF NOT EXISTS public."SupportTicketMessage" (
  "id" text PRIMARY KEY,
  "ticketId" text NOT NULL REFERENCES public."SupportTicket"(id) ON DELETE CASCADE,
  "author" text NOT NULL,          -- customer|grok_agent|rafael|system
  "visibility" text NOT NULL DEFAULT 'public', -- public|internal (internal never shown/emailed to customer)
  "body" text NOT NULL,            -- max 10k chars, plain text/markdown, sanitized on render
  "emailMessageId" text NULL,      -- for threading when email ingest lands
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "SupportTicketMessage_ticket_idx" ON public."SupportTicketMessage"("ticketId","createdAt");

CREATE TABLE IF NOT EXISTS public."SupportTicketEvent" (   -- outbox
  "id" text PRIMARY KEY,
  "ticketId" text NOT NULL REFERENCES public."SupportTicket"(id) ON DELETE CASCADE,
  "type" text NOT NULL,            -- ticket.created|ticket.customer_replied|ticket.escalated
  "payload" jsonb NOT NULL,
  "webhookStatus" text NOT NULL DEFAULT 'pending', -- pending|sent|failed|skipped
  "emailStatus"   text NOT NULL DEFAULT 'pending',
  "attempts" int NOT NULL DEFAULT 0,
  "nextAttemptAt" timestamptz NOT NULL DEFAULT now(),
  "lastError" text NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "SupportTicketEvent_pending_idx" ON public."SupportTicketEvent"("nextAttemptAt") WHERE "webhookStatus" IN ('pending','failed') OR "emailStatus" IN ('pending','failed');

CREATE TABLE IF NOT EXISTS public."SupportMcpAudit" (
  "id" text PRIMARY KEY, "tool" text NOT NULL, "ticketId" text NULL,
  "ok" boolean NOT NULL, "error" text NULL, "createdAt" timestamptz NOT NULL DEFAULT now()
);
COMMIT;
```

Backfill (separate, idempotent script `scripts/backfill-feedback-to-support.ts`, dry-run default): copy each `FeedbackTicket` into `SupportTicket` (`source='in_app'`, `legacyFeedbackTicketId`), description → first message, `adminNotes` → internal message. Keep `FeedbackTicket` table untouched (no drop in this PR). `/api/feedback` POST is rewired to `createSupportTicket` (same response shape so the current UI keeps working).

**Custom-agent enablement: no new table.** `TenantFeatureFlag` row `scope=<tenantId>, tenantId=<tenantId>, key='custom_agents', enabled, config={"enabledBy":"<userId>","enabledAt":"ISO","agentIds":["<ChatAgent.id>"]}`. Constant `CUSTOM_AGENTS_FLAG` in `feature-flags.ts`, NOT in `PREVIEW_UNLOCKED_KEYS`. Default off for every tenant. No tiers.

## 4. API routes

| Route | Auth | Behavior |
|---|---|---|
| `POST /api/support/contact` | public | Zod: name ≤120, email, subject ≤200, message 10–5000, `website` honeypot must be empty, `startedAt` ≥3s ago, `turnstileToken` (if `TURNSTILE_SECRET_KEY` set). Rate limit 5/10min per IP + 3/hour per email. If a logged-in session exists, attach tenantId/userId. Returns `{ok:true, ticketNumber}` (never echoes internals). Spam → `status='spam'`, no webhook, still 200 (don't teach bots). `/api/contact` becomes a wrapper calling the same lib. |
| `GET /api/support/tickets` | session | own tickets (`userId` = me) + if role OWNER/ADMIN, all tickets of current tenant. Never cross-tenant. |
| `POST /api/support/tickets` | session | in-app ticket, tenant from JWT only (never from body). |
| `GET /api/support/tickets/[id]` | session | thread, **public messages only**, ownership check (`userId` or tenant OWNER/ADMIN), 404 otherwise (not 403). |
| `POST /api/support/tickets/[id]` | session | customer reply → message + `ticket.customer_replied` event, status → `open`. |
| `GET /api/support/events?since=` | `Bearer SUPPORT_WEBHOOK_SECRET` or super admin | Advance-style poll fallback, max 50, redacted payloads. |
| `POST /api/support/events/dispatch` | `Bearer CRON_SECRET` | runs `dispatchPendingSupportEvents`. Also called via `after()` right after create. Schedule: existing cron mechanism every 2 min (do NOT run `wrangler triggers deploy` — Claudio wires the trigger). |
| `PUT /api/super-admin/tenants/[tenantId]/custom-agents` | super admin only | `{enabled:boolean, agentIds?:string[]}` → upserts flag, writes `AuditLog`, emails tenant owner "Tu agente está activo". |
| `GET /api/agents/access` | session | `{enabled}` only; drives the Agents tab (sales page vs. their agent). |
| `POST /api/support/agent-request` | session | sales lead from the Agents tab: `{businessType?, channels?:('whatsapp'|'instagram'|'messenger'|'web')[], message, phone?}` → `createSupportTicket({source:'agent_request', category:'agent_request', priority:'high'})`. Rate limit 3/day per tenant. Tenant/contact from session. |
| `GET /api/support/contact-config` | public | the business contact info for `/soporte` (from env; nothing secret). |
| Internal review (`/super-admin/agentes`) | super admin only | Rafael's internal per-tenant agent review: agents, status, turns (redacted), suggestions, escalations. Not exposed to tenants. |
| `POST /api/mcp` | `Bearer SUPPORT_MCP_TOKEN` | section 5 |

## 5. Webhook contract → Advance "Ticket" Grok agent (reused)

Reuse the agent that already handles Advance tickets. Same transport as Advance `api/ticket-events.ts`: `POST <SUPPORT_AGENT_WEBHOOK_URL>` with `Content-Type: application/json` and `Authorization: Bearer <SUPPORT_WEBHOOK_SECRET>`. Body keeps **Advance's `ticket.created` shape exactly** (same keys, same types) and adds `source: "betsy"` plus a `betsy` object the agent can ignore:

```json
{
  "event": "ticket.created",
  "source": "betsy",
  "ticket": {
    "id": "…",
    "subject": "…",
    "description": "…(≤2000 chars, secrets redacted)",
    "category": "question",            
    "priority": "medium",
    "status": "open",
    "user_email": "cliente@ejemplo.com",
    "page_url": "https://www.betsycrm.com/soporte",
    "created_at": "2026-10-22T10:00:00.000Z"
  },
  "betsy": {
    "ref": "BETSY-1042",
    "channel": "contact_form",          
    "delivery_id": "evt_…",
    "tenant": { "id": "…", "name": "…", "plan": "PRO" },
    "contact_name": "…",
    "phone": null,
    "mcp_url": "https://www.betsycrm.com/api/mcp",
    "admin_url": "https://www.betsycrm.com/super-admin/soporte/<id>"
  }
}
```
Mapping notes: Betsy priority `normal` → `medium` in the payload (Advance vocabulary); `channel` = Betsy source (`contact_form|in_app|ai_chat|email|agent_request`). `agent_request` tickets also send `category: "agent_request"` so the agent can treat them as sales leads. Follow-up events use the same envelope with `event: "ticket.customer_replied"` / `"ticket.escalated"`; if the Ticket agent only understands `ticket.created`, set `SUPPORT_WEBHOOK_EVENTS=ticket.created` (default) and the others are delivered only by poll/email.

Optional hardening (agent may ignore): headers `X-Betsy-Delivery` (idempotency), `X-Betsy-Timestamp`, `X-Betsy-Signature: sha256=HMAC(secret, timestamp + "." + rawBody)`.

Poll fallback, same as Advance: `GET /api/support/events?since=ISO` with the same bearer → `{since, events:[…same payloads…]}`, max 50.

Retries: non-2xx/timeout (8s) → 1m, 5m, 30m, 2h, 12h, then `failed`. Empty URL → `skipped` (poll + email still work).

Notification email (same outbox event): to `SUPPORT_AGENT_EMAIL` = **hola@betsycrm.com**, from `SUPPORT_FROM_EMAIL`, subject `[BETSY-1042] <subject>` (agent_request: `[BETSY-1042] Lead agente IA — <tenant>`). The Ticket agent replies via MCP so the thread stays in Betsy. Customer gets an auto-ack with the ref.

To reuse the agent: Rafael/the Advance side adds Betsy as a second source — either the same webhook URL (agent branches on `source`) or a second URL; give the agent the Betsy MCP URL + `SUPPORT_MCP_TOKEN` and `AGENT_BRIEF.md`.

## 6. MCP (`/api/mcp`, JSON-RPC 2.0, Streamable HTTP POST, protocol `2025-06-18`)

Auth: `Authorization: Bearer SUPPORT_MCP_TOKEN` (≥32 bytes random, timing-safe compare). No session cookies accepted. Rate limit 60 req/min. Every call writes `SupportMcpAudit`. All output passes `redact.ts`. Phase 2 can add OAuth like Advance; not needed for one agent.

| Tool | Input | Effect |
|---|---|---|
| `support_list_tickets` | `status?`, `source?`, `since?`, `limit≤50` | summaries, emails masked |
| `support_get_ticket` | `ticket_id` or `ref` | ticket + all messages (incl. internal) + tenant summary (name, plan, member count, custom_agents enabled). Full customer email included here only (needed to reply). |
| `support_reply` | `ticket_id`, `body`, `visibility:'public'|'internal'`, `set_status?` | adds message; public → emails customer via Resend from `SUPPORT_FROM_EMAIL`, subject keeps `[BETSY-n]`; status default `ai_answered` |
| `support_update_ticket` | `ticket_id`, `status?`, `priority?`, `category?` | updates; `spam` allowed |
| `support_escalate` | `ticket_id`, `reason` | status `escalated`, assignee `rafael`, emails `SUPPORT_ESCALATION_EMAIL` |
| `support_search_kb` | `query` | searches `src/content` help docs / `/docs` pages (read-only) so answers are grounded |
| `support_get_tenant_context` | `tenant_id` | plan, isActive, setup progress, custom_agents flag, last 5 tickets, connected channels (types only). No orders, no customer PII. |
| `agents_get_access` | `tenant_id` | read `custom_agents` flag (read-only) |

Deliberately NOT exposed: enabling agents (Rafael only, via super-admin UI), deleting tickets, any order/client data, any cross-tenant listing beyond support tickets.

## 7. UI

1. **Soporte / Contacto page** (`/soporte`, public; `/help` links to it): business info block rendered from `getSupportContactConfig()`:
   - WhatsApp (`wa.me/<SUPPORT_WHATSAPP>` button), Instagram (`instagram.com/<SUPPORT_INSTAGRAM>`), emails (`SUPPORT_PUBLIC_EMAILS`, default `hola@betsycrm.com`), hours (`SUPPORT_HOURS`). Any empty value hides that item.
   - Ticket form (name, email, subject, category, message, honeypot, Turnstile if configured) → ticket ref.
   - Logged in: "Mis tickets" list + thread + reply box. Spanish (CR) copy.
2. **In-app**: existing feedback entry point posts to `/api/support/tickets`.
3. **Agents tab** (`/agentes`, nav "Agentes", visible to all members):
   - Default (no `custom_agents` flag) = **sales page**: headline "¿Querés un agente de IA en tu negocio?", short value props (responde WhatsApp/Instagram 24/7, toma pedidos, escala a tu equipo), example use cases, CTA "Quiero mi agente" → form (tipo de negocio, canales, qué querés que haga, teléfono opcional) → `POST /api/support/agent-request` → "¡Listo! Te contactamos pronto (BETSY-n)". Secondary CTA: WhatsApp link from contact config. No access to any agent tooling.
   - Enabled by Rafael = the tenant's agent page: their agent(s) listed in `config.agentIds` with status and channels, linking to the existing `/config/agentes` editor/inbox (OWNER/ADMIN, `update_config`) so they can use it on their channels. `/config/agentes` and the agent APIs must also check the flag (server-side), so a non-enabled tenant cannot reach them by URL.
4. **Super admin (Rafael only)**:
   - "Soporte" panel: tickets (filter by channel incl. `agent_request` leads), thread, reply as Rafael, status/priority, outbox health + retry.
   - Per-tenant "Agente personalizado" toggle (On/Off + pick agent ids) with confirmation and audit.
   - Internal agent review (`/super-admin/agentes`): Rafael's own regular/enhanced views (agent list, turns, suggestions, escalations). Internal only; no tenant-facing tiers.

## 8. Env vars (add to `.env.example`, runbook, and Cloudflare container secrets via Claudio)

| Var | Default / value | Notes |
|---|---|---|
| `SUPPORT_AGENT_EMAIL` | `hola@betsycrm.com` | support inbox (CF Email Routing → juno@mail.grokbot.com, Grok Bot); `info@` is an alias that also forwards. Swappable via this env — no code change |
| `SUPPORT_ESCALATION_EMAIL` | `betsycrm.cr@gmail.com` | Rafael |
| `SUPPORT_FROM_EMAIL` | `Betsy <hola@betsycrm.com>` | must be sendable via Resend (domain verified, see §12) |
| `SUPPORT_PUBLIC_EMAILS` | `hola@betsycrm.com` | comma list shown on `/soporte` |
| `SUPPORT_WHATSAPP` | `50662470831` | digits only; shown as +506 6247-0831, links to `https://wa.me/50662470831` |
| `SUPPORT_INSTAGRAM` | `betsy_crm` | handle without @; shown as @betsy_crm, links to `https://www.instagram.com/betsy_crm/` |
| `SUPPORT_HOURS` | empty | e.g. `Lun–Sáb 8:00–18:00 (CR)` |
| `SUPPORT_AGENT_WEBHOOK_URL` | empty | Advance Ticket agent webhook; empty = skipped |
| `SUPPORT_WEBHOOK_SECRET` | secret | bearer (+ optional HMAC) |
| `SUPPORT_WEBHOOK_EVENTS` | `ticket.created` | comma list of events pushed |
| `SUPPORT_MCP_TOKEN` | secret | empty → `/api/mcp` 503 |
| `CRON_SECRET` | reuse existing | dispatch |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | optional | |
| `SUPPORT_PIPELINE_ENABLED` | `false` | kill switch |

Defaults: `getSupportContactConfig()` falls back to exactly these values when the env var is unset (empty string set explicitly = hide item):

```env
SUPPORT_PUBLIC_EMAILS=hola@betsycrm.com
SUPPORT_WHATSAPP=50662470831
SUPPORT_INSTAGRAM=betsy_crm
SUPPORT_HOURS=
```

Contact values may later move to a super-admin-editable settings row; env is the source for this PR. Never commit secret values; generate locally (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`).

## 9. Security

- Tenant isolation: tenantId only from JWT/session; every query filters by `userId` or (`tenantId` AND role ∈ OWNER/ADMIN); 404 on foreign ids. Add tests to `tenant-write-coverage` suite.
- MCP token is the only agent credential; scoped to support data; audited; rotatable by env change.
- Super-admin endpoints and internal review pages use `isSuperAdminRequest`; custom-agent enablement changes go to `AuditLog`. Default for every tenant: no agent access; enforced server-side on `/config/agentes` and agent APIs, not just hidden in nav.
- Spam: honeypot, min fill time, Turnstile, rate limits (IP + email), max sizes, URL-count heuristic (>3 links → `spam` candidate), store `ipHash` (sha256 with `NEXTAUTH_SECRET` salt) not raw IP.
- Output safety: escape HTML in all emails (reuse `escapeHtml`), render messages as text/markdown without raw HTML; `redactSecrets` on everything sent to the agent (tokens, card numbers, passwords).
- Webhook: HMAC + timestamp + delivery id; never include full email or tenant PII in the push.
- Prompt-injection note for the agent: ticket text is untrusted; the agent's own instructions must say so (see AGENT_BRIEF.md).

## 10. Acceptance criteria

1. Contact form → ticket + message + outbox event in one transaction; ack email with `BETSY-n`; Ticket agent webhook receives Advance-shaped `ticket.created` with `source:"betsy"` (or `skipped` if no URL); notification email to hola@betsycrm.com.
2. Webhook down → retries; poll returns the event; no duplicates.
3. MCP: `tools/list` returns 8 tools; `support_reply` public emails the customer and shows in their thread; internal notes never visible to customers.
4. User sees own tickets; OWNER/ADMIN sees tenant tickets; foreign id → 404.
5. `/soporte` shows WhatsApp/Instagram/emails/hours from env; empty values hidden.
6. Agents tab: non-enabled tenant sees the sales page; CTA creates an `agent_request` ticket delivered to the Ticket agent; `/config/agentes` and agent APIs return 403/redirect for that tenant. After Rafael enables the tenant in super-admin, the tenant sees its agent and can use it; disabling reverts. Audited.
7. No Regular/Enhanced or super-admin UI is reachable by non-super-admins.
8. `SUPPORT_PIPELINE_ENABLED=false` → legacy behavior.
9. Spam (honeypot/too-fast/rate-limited) → no webhook, no email.
10. `npm run lint`, `npm run build`, `npm run test:support`, `npm run test:security` pass.

## 11. Test plan

Unit (`src/lib/__tests__/support-*.test.ts`, `npx tsx --test`, add `test:support` script):
- payload builder is pure and redacts; HMAC signature verify; backoff schedule; spam heuristics; maskEmail/redactSecrets; custom_agents flag parsing (missing/invalid → off); Advance-payload compatibility snapshot test (same keys/types as IANAI `buildTicketCreatedPayload` + `source`).
- route auth matrix: anon / member / OWNER / other-tenant OWNER / super admin / MCP token / wrong token.
- MCP protocol: initialize, tools/list, unknown tool error, invalid args error, audit row written.
E2E (Playwright, `e2e/tenant/support.spec.ts`): /soporte shows contact info + submit; Agents tab shows sales page → agent_request ticket; `/config/agentes` blocked; super admin enables → tenant sees its agent.
Manual on preview: point `SUPPORT_AGENT_WEBHOOK_URL` at a request bin (webhook.site) to see a real signed delivery; run MCP with `npx @modelcontextprotocol/inspector` against the preview URL.

## 12. Rollout

**DNS / inbox (done Oct 22 2026):** betsycrm.com DNS is on Cloudflare (registrar Name.com, expires Oct 21 2027). Zoho was removed. **Cloudflare Email Routing** forwards `hola@betsycrm.com` (primary) and `hola@betsycrm.com` (alias) to the Grok Bot inbox `juno@mail.grokbot.com`. No mailbox setup needed.
- Outbound: Resend only, from `noreply@betsycrm.com` (system mail, already used) and `hola@betsycrm.com` (support replies). Confirm betsycrm.com is verified in Resend; if not, add Resend's DKIM (`resend._domainkey`) and `send.` subdomain MX/SPF records exactly as Resend shows them. Keep the apex SPF compatible with Cloudflare Email Routing (it manages its own apex MX/SPF) — don't remove those records. Until Resend is verified for hola@, send from `noreply@` with Reply-To `hola@`.
- Recommended later: add a DMARC record (`_dmarc`, start with `p=none`).

Steps:
1. Draft PR to `dev`; migration not auto-applied; CI green; Rafael reviews.
2. Blob backup → apply `030` via `BETSY_V2_APPLY_FILES=030` (human approved). Backfill dry-run, then real.
3. Claudio sets secrets in Cloudflare Containers and deploys on Rafael's word with `SUPPORT_PIPELINE_ENABLED=false`.
4. Inbox is live (above). Point `SUPPORT_AGENT_WEBHOOK_URL` at the Advance Ticket agent; give it the Betsy MCP URL + token + `AGENT_BRIEF.md`.
5. Flip `SUPPORT_PIPELINE_ENABLED=true`; smoke: contact ticket, in-app ticket, agent_request lead, one MCP reply.
6. First paying custom-agent tenant: Rafael builds the agent, enables `custom_agents` for that tenant in super-admin, verifies the tenant sees it.
Rollback: kill switch; tables additive.

## 13. Open questions for Rafael

1. (Answered) /soporte defaults: WhatsApp +506 6247-0831, Instagram @betsy_crm, email hola@betsycrm.com. Hours still open.
2. (Answered) hola@ + info@ forward to juno@mail.grokbot.com via Cloudflare Email Routing.
3. The Advance Ticket agent's webhook URL for Betsy: same URL (agent branches on `source`) or a separate one? Should it get follow-up events or only `ticket.created`?
4. May the Ticket agent auto-reply to customers publicly, or draft internal notes for your approval? (Proposal: auto-reply for questions, internal draft for billing and agent_request leads.)
5. Turnstile on the contact form: yes/no.

