## 2026-10-02 — Agent Ops S4: improvement loop — versions, staff thumbs, scorecard, safety test (claudio/agent-ops)

"Are the agents getting better" = compare rates between versions of the same agent.
- SQL 045 (new tables only, no FKs, RLS): ChatAgentVersion (immutable snapshot of instructions/tools/model/brand facts
  per version), ChatAgentFeedback (👍/👎 + reason chip per staff member per turn), ChatAgentEvalRun. HELD: not applied;
  all code is fail-safe on the missing tables (scorecard still works from existing data).
- Scorecard per agent + version from EXISTING data (no new events): suggestion accept rate, takeover-after-send
  (human replies within 30 min), fallback rate, conversion (client orders within 7 days of an agent turn), thumbs.
  Platform view in Agent Ops; per-business card in Avanzado (rates only, no dollars).
- Thumbs on agent-sent bubbles in the inbox (SoftThreadPane data component only; no chrome change).
- "Probar reglas de seguridad": replays the frozen fixture set through the deterministic safety layer (no tokens,
  no sends, no key) and stores pass rate per version. LLM judge arrives with the OpenAI key (held).
- Version snapshot written after every agent edit that bumps the version.
- SecureDog on S1 (INT-09..12) fixed: pinned OpenAI base URL/org/project, `server-only` client, safe failure log
  (never message/headers), `LLM_AUTH` code, dedicated `SOFT_AI_OPENAI_API_KEY`.
- Tests: agent-improvement.test.ts.

## 2026-10-02 — Agent Ops S1 fixes after Verifier review (claudio/agent-ops)

- HIGH: OpenAI strict function schemas — every property now `required` (optional ones nullable) for
  `get_shipping_status` and `escalate_to_human`; unit test asserts it for all tools.
- MEDIUM: an unlock record with no stored model no longer carries over to an OpenAI model (forces re-canary).
- Dedicated key `SOFT_AI_OPENAI_API_KEY` for inbox agents — the staff bot's `OPENAI_API_KEY` (voice transcription)
  is never used for them, so the "held key" is really held and spend/limits are separate. Forwarded to the container
  with `SOFT_AI_OPENAI_REASONING` and `SOFT_AGENT_KILL` (CONTAINER_ENV_KEYS).
- Tool-call cap: replayed calls past the cap get a stub output (OpenAI rejects unanswered calls).
- Timeout detection matches the SDK message ("Request timed out."); reasoning headroom scales with effort.

## 2026-10-02 — Agent Ops S3: platform kill switch for inbox agents (claudio/agent-ops)

- Two independent triggers: env `SOFT_AGENT_KILL=1` (works with the DB down) and a `PlatformAgentPolicy` row
  (SQL 044, written only by super admins via `/api/super-admin/agent-kill`, reason required, audited).
  Not in Tenant.settings on purpose: tenant admins can write that JSON.
- Checked first in the claim gate and again in the pre-send gate (new skipReason `kill_switch`), and before the
  legacy Soft path. Probar is not affected. Inbound messages still land for humans.
- Agent Ops page shows the panel (Frenar / Reanudar + motivo). Until SQL 044 is applied the panel answers 409 and
  the env trigger is the only one (code is fail-safe on the missing table).
- SQL 044 prepared + registered in the apply manifest (HELD: not applied). Tests: `soft-ai-kill-switch.test.ts`.

## 2026-10-02 — Agent Ops S2: usage dashboard (claudio/agent-ops, INBOX only, no SQL)

- Platform view `/super-admin/agentes` + `GET /api/super-admin/agent-usage` (isSuperAdmin only, 404 to others,
  aggregates only — no customer/output text, AuditLog row on every open). Totals, fallback/failure rate, p95 latency,
  by model / business / agent / day; filters 7/30/90 days and Reales/Probar/Todo. Costs are labelled estimated
  list price with the pricingVersions shown. Link added on the super-admin dashboard.
- Tenant view: `GET /api/chat/agents/usage` (view_config, tenantId from session) + "Últimos 30 días" card in
  Avanzado. Volume and outcomes only — dollars (COGS) never leave the platform view.
- Reads existing ChatAgentTurn (index tenantId+createdAt); no SQL, no staff-bot files.
- Tests: `agent-usage-dashboard.test.ts` (mode filters, rates, cost math, tenant strip, route gates).

## 2026-10-02 — Agent Ops S1: gpt-6-luna provider switch (claudio/agent-ops, INBOX only, default unchanged)

Plan: Notion "Agent Layer + Platform Admin (2026-10) — Claude SoT" v4. Inbox agent only; `src/lib/bot/**` and
`src/app/api/bot/**` untouched (diff empty), `XAI_API_KEY` untouched (staff bot + customer-paste still use it).
- Model id picks the provider: `gpt-*` → OpenAI (`OPENAI_API_KEY`), Grok ids → xAI as before. Default model
  stays `grok-4.7`; agents move to `gpt-6-luna` one at a time from Avanzado (button added; refused with 409 until
  the OpenAI key exists). Flipping the default is a later one-line change.
- OpenAI request shape: no `temperature` unless reasoning is `none` (env `SOFT_AI_OPENAI_REASONING`, default low),
  encrypted reasoning items replayed for the tool loop (`store:false`), output cap raised to 1500 for reasoning.
- Cost: per-model rate card; Luna $0.10 / $0.50 per 1M, cached input $0.01 (now billed at the discount);
  Grok unchanged. `pricingVersion` follows the provider (`openai-2026-10` / `xai-2026-09`).
- New provider-neutral error codes `LLM_NOT_CONFIGURED`, `LLM_TIMEOUT`, `LLM_ERROR` (Grok keeps `XAI_*`).
- Unlock key check is per provider; unlock already invalidates on model change (existing behavior).
- Tests: new `soft-ai-llm-provider.test.ts` (routing, body shape, pricing); added to test:soft-ai,
  test:soft-ai-agent, test:chat-harden. HELD: OPENAI_API_KEY (Rafael), default flip, deploy.

## 2026-10-01 — Chats not updating until refresh + calm notification chime (branch claudio/inbox-live)

- Location pin live (b3b7a13b, containers "enam"): API p50 now 0.22-0.57 s (dashboard 0.23, auth/me
  0.22, billing 0.24, chat list 0.82), pages fully loaded in 0.26-0.50 s.
- Reported: new chat messages only appeared after a page refresh (bell still updated). Cause: the
  inbox poll skips a tick while the previous poll is in flight, and its requests had no timeout — one
  hung request (e.g. during a container restart) froze polling until reload. Fix: 15 s timeout on
  every inbox request (V2 list / changes / thread, legacy poll), a poll in flight > 30 s no longer
  blocks, and a superseded poll can't clear the newer one's flag.
- Notification sound: soft two-note chime (Web Audio, no file), low volume, max once per 4 s, only
  when a customer message raises the unread count (not on first load, not our own replies); speaker
  toggle in the inbox header (per browser, on by default). Preview WAV sent to Rafael.

## 2026-10-02 — Meta sales attribution S3/S4: report paid ad sales (claudio/live-next, OFF)

Rafael's decisions: colones + dollars (business currency), a sale counts only once payment is CONFIRMED,
must never affect WhatsApp messaging.
- `payment.ts`: strict confirmed-payment rule (COD needs `cePaymentConfirmed`; others an explicit paid
  status; "Enviado" alone does NOT count), CRC/USD from Tenant.settings, 7-day window.
- `settings.ts`: per-business opt-in (TenantFeatureFlag `meta_sales_capi_v1`) — never on without a recorded
  acknowledgement (who/when); optional 24 h Events Manager test code.
- `dataset.ts`: per WhatsApp line — debug_token scope `whatsapp_business_manage_events`, then GET/POST
  `/{waba}/dataset`; status ready / missing_permission / token_invalid / error.
- `sweep.ts` + `sender.ts`: tenant-scoped outbox (one Purchase per order, unique), lease claims, batches of
  50, Meta error classes (190 pause, permission → reconnect, limits/5xx/network → backoff, max 6), 7-day expiry,
  click id read at send time; payload = WABA id + ctwa_clid + value/currency only.
- Cron `/api/cron/meta-attribution` on the existing */5 slot: does nothing unless `META_SALES_CAPI_SENDER=1`
  (Cloudflare only; never Railway). Config card "Ventas por anuncios (Meta)" in Cuentas conectadas.
- SQL 041 (MetaCapiDataset, MetaConversionEvent): additive, RLS, FKs only to Tenant/SocialAccount, not applied.
- Proof: test:meta-attribution 20/20, security 264, ops 16, chat-harden 461, config-ui 30, site-ui 50; lint
  clean; tsc clean on touched files; worker tsc clean.

## 2026-10-02 — Backups → Cloudflare R2; Sentry replaced by own error tracking (claudio/live-next)

- **Backups were failing silently**: Vercel Blob rejects the token from Cloudflare, no call had a
  timeout, failures were never recorded, `/api/backups/status` hung >170 s on prod.
  - R2 store (`src/lib/backups/r2-store.ts`, SigV4 via node:crypto, AWS test vector), hard timeouts,
    bounded retries; `store-factory.ts` (`BACKUP_STORE=vercel` only to read old dumps).
  - Runs: advisory lock, 12-min deadline, `idle_in_transaction_session_timeout` on the snapshot.
  - Status bounded (20 s → `unknown`), platform-admin only (was any business owner/admin), no raw errors.
  - Alerts to `OPS_ALERT_EMAIL` on failure + `/api/cron/ops-daily` (06:00 UTC) when the full is >26 h old.
  - Rafael: create bucket `betsy-backups` + bucket-scoped R/W token; Worker secrets/vars R2_*, OPS_ALERT_EMAIL.
- **Sentry removed** (quota 403s): `@sentry/nextjs` out of package.json/lock (surgical), configs/relay deleted,
  CSP host dropped. Replacement (`src/lib/observability/*`): scrubbed JSON error lines → Workers Logs,
  coalesced groups → `OpsErrorGroup` (SQL 040, additive, RLS, not applied), new-error email (capped),
  console.error capture (Error object only), browser reports → `/api/client-errors` (same-origin, 10/min,
  8 KB), Next `onRequestError`. Admin page `/super-admin/salud` (backups + errors, resolve / mute).
- Proof: test:ops 15, test:backups 17, security 264, chat-harden 461, site-ui 50, meta-attribution 12;
  lint clean; tsc clean on touched files; `npm ci --dry-run` ok on the trimmed lockfile.

## 2026-10-02 — Lint cleanup: 22 warnings → 0 (claudio/meta-attribution)

- 7 real fixes: internal `<a>` → `next/link` (SubscriptionBanner, data-deletion, chat list empty state,
  thread "Reconectar" ×2); logistics rates effect uses a functional update; worker default export named
  (`const worker`; perf-guards test marker updated).
- 15 `react-hooks/exhaustive-deps` kept as-is on purpose with a reason comment each (mount-only loads,
  filter-triggered effects): adding the non-memoised loaders would re-run them every render.
- Meta pixel `<noscript><img>` kept (must be a plain img) with a reasoned disable.
- Proof: `next lint` ✔ no warnings; security 264, chat-harden 461, chat-mobile 6, site-ui 50, config-ui 30,
  stats-ui 42, meta-attribution 12; worker tsc 0; app subset tsc only the known baseline session-type error.

## 2026-10-01 — Meta sales attribution S1+S2 (claudio/meta-attribution, not deployed)

Advisor plan (CTWA / IG click-to-message → Conversions API for Business Messaging); slices S0–S6.
- **S1 capture**: `src/lib/meta-attribution/referral.ts` parses WhatsApp `referral` (incl. `ctwa_clid`)
  and IG ad `message.referral` on live inbound messages only; webhook stores it best-effort in
  `ChatAdReferral` (idempotent, tenant-checked, silent until SQL 039 applied, click id never logged).
- **SQL 039** (`supabase/migrations/039_meta_sales_attribution.sql`, NOT applied, gated
  `BETSY_V2_APPLY_FILES=039`): ChatAdReferral, MetaCapiDataset, MetaConversionEvent, RLS on.
- **S2 visibility**: `GET /api/chat/conversations/[id]/attribution` + "Llegó por un anuncio" card in the
  chat side panel (separate request; not in the inbox list query).
- Proof: test:meta-attribution 11/11, chat-harden 461, security 264, chat-scale 15, backups 8,
  chat-mobile 6, site-ui 50; subset tsc no new errors; eslint clean.
- **Blocked on Rafael** before S3/S4 (sending Purchase events): Meta permission
  `whatsapp_business_manage_events` in the Embedded Signup config + App Review, SQL 039 apply,
  currency (CRC only?), what counts as "paid", privacy/terms wording.

## 2026-10-01 — Inbox live fix: verifier follow-ups (claudio/inbox-live)

Verifier PASS WITH NOTES on 10b00a3; all six notes addressed:
- **Open chat missed a late customer message** (pre-existing): the thread tail cursor sat at our last
  message's ms timestamp while WhatsApp stamps customer messages in whole seconds and delivers 1–3 s
  later. The poll now re-asks a 45 s window (`threadTailCursor`), merged by id. Window kept far below
  the 50-row tail page.
- First load now records a real poll start time (the stuck-release saw 0 and fired a parallel list load)
  and only clears the in-flight flag it owns.
- `mergeListDtoIntoMap` ignores an older revision of a chat (a late response can't overwrite a newer row).
- `inboxFetch` uses `AbortSignal.timeout`, so a stalled response body is also cut off.
- Chime: chats not on screen only chime if the customer wrote in the last 2 min (no chime when a teammate
  tags / assigns an old unanswered chat). Audio unlock also listens to pointerup/touchend/click and
  re-arms when the tab comes back; mobile header has the sound switch.
- Proof: chat-inbox-live 9/9, chat-harden 461/461, chat-mobile 6/6, site-ui 50/50, subset tsc 0, eslint 0 errors.

## 2026-10-01 — Performance batch 2 (branch claudio/perf-2) + speed indexes 032 applied

- Measured after batch 1 (live 9d776d0b): API p50 2-13x faster (dashboard 5.2 s → 0.38 s, auth/me
  3.1 → 0.93, chat list 3.0 → 1.1, billing 2.2 → 0.74); JS 49 → 34 files; edge cache HIT; 3 DB conns.
- 032 applied (8 indexes valid, 4 s; Order 3.8k rows).
- Batch 2: chat list reads in parallel (max revision read first); agent flag cached 60 s; lean 30 s
  cached membership for /api/auth/me + /api/billing/access (payments / writes stay fresh; billing
  screen uses ?fresh=1 so post-payment re-checks see the webhook); readiness readers memoised 30 s;
  Config Productos/Clientes/Envíos stop downloading a never-rendered legacy list; chat photo
  previews ?w=320|640 (sharp; real JPEG/PNG/WebP bytes only, 40 MP cap, 5 s timeout, 2 at a time,
  falls back to the original); stats summary in one round.
- Verifier: PASS WITH NOTES → all notes fixed (F1 billing freshness, F2 magic bytes = MEDIA finding,
  F3 throttle, F4 revision order). Tests: chat-harden 451+, security 263, all suites green.

## 2026-09-30 — Performance batch 1 (branch claudio/perf-1)

- Measured live (test tenant): HTML TTFB 0.4-0.8 s fine; API p50 1.5-5 s; ~700 KB JS per page;
  0% edge caching of static files.
- Root cause 1: Prisma connection_limit defaulted to 1 in production → every parallel query of
  every user queued on one DB connection (/api/auth/me 3 s p50 of pure waiting). Worker now passes
  PRISMA_CONNECTION_LIMIT=8 to the container (override via Worker var); Supabase max_connections 60.
- Root cause 2: a 2024 webpack splitChunks override (one chunk per npm package + an enforced
  "commons" chunk) → shared JS 468 → 223 KB, typical page ~700 → ~480 KB with Next defaults.
- /_next/static/* (immutable) cached at Cloudflare's edge by the Worker.
- Chat inbox no longer re-renders every second (self-ticking "Sincronizado hace" label, paused in
  hidden tabs); /api/auth/me shared in-flight request.
- Tests: fixed 3 CRLF-sensitive tests (theme, chat-mobile, whatsapp popup) that failed on Windows
  checkouts (baseline failures, now green). Local smoke of the new build: all 11 main pages render,
  same 4xx set as live.
- Verifier round 1 (FAIL → fixed, round 2 PASS WITH NOTES): billing-week finalize / revert ran raw
  BEGIN/COMMIT on the shared client (only safe with ONE pooled connection) → one interactive
  $transaction each (revert locks its orders FOR UPDATE); lifecycle order create/update retry P2034;
  pool default 6 per container; perf-guards test forbids raw BEGIN/COMMIT anywhere.
- Full app tsc crashes at random on this machine (segfault / illegal instruction, also on untouched
  code) → the Docker `next build` type check gates the deploy; changed files checked in isolation.
- Cost analysis (Cloudflare Containers): ~$45/mo + $5 plan today; memory dominates; a 2nd
  always-on server ≈ +$40/mo → not needed (bottleneck was the DB queue, not CPU).

## 2026-09-30 — FIX: chats answered by a teammate kept showing as pending for everyone else

- Cause: unread was per user only (ChatConversationReadState). Mom answering a chat left the badge
  on for every other teammate.
- Fix: SQL 037 adds ChatConversation.repliedInboundCount (team "answered up to here"); unread for a
  viewer = inboundCount - max(own read, team replied). Set by confirmed replies only (Betsy send once
  Meta accepts it, WhatsApp Business app echo, AI agent reply), counting only customer messages sent
  up to that reply (AI: up to the message it answered), non-duplicate, capped, only raises. A later
  async 'failed' status recomputes it from the last good reply. Backfill from last confirmed reply
  (20 chats; read-only timed 0.9 s). ALTER and backfill in separate transactions.
- Verifier: FAIL → 7 findings fixed (build-breaking BigInt test, gitignored SQL, echo/AI/history
  over-marking, migration lock, verify column, duplicates, async failures) → PASS WITH NOTES; note 1
  (finalize after async failed) fixed too.
- Proof: tsc 0, eslint 0, chat-harden 443, soft-ai 166, security 257, bot-inbox 8.

## 2026-09-30 — HOTFIX: Meta connect popups (WhatsApp + Instagram) — "2 popups, one never loads"

- Cause (since 4dae7d7, 2026-09-26): the WhatsApp click opened a reserved blank window AND
  FB.login's Embedded Signup window. Browsers grant one popup per click unless the site is
  allow-listed, so for most users the blank window took it and Meta's window was blocked (owner's
  browser had popups allowed, so it worked there — plus a blank window that never loaded).
- Fix: WhatsApp click opens only Meta's window. SDK 36008 fallback now fetches the direct-OAuth URL
  and shows a "Continuar en Meta" button (page banner + both connect modals) that opens it from its
  own click; only https://www.facebook.com/ URLs are opened. Instagram opens its single window on the
  click (with an "Abriendo Meta…" note) before awaiting the auth URL, then navigates it (Safari
  blocks window.open after a fetch); the window closes on error.
- Tests rewritten, not deleted: whatsapp-coexistence (one popup per click, fallback from its own
  click), aurora-site-rest, new oauth-popup.test.ts (in test:chat-harden).
- Proof: tsc 0, eslint clean on touched files, chat-harden 429, site-ui 50, config-ui 30.

## 2026-09-30 — Business switcher SHIPPED (8abb81ff live) — live line is now claudio/phase2b-switcher

- 5 SecureDog rounds on a5f81cd..69108bd. Fixed before prod: switch was per user (moved other
  tabs / devices) → per session + BusinessChangeWatcher reload; order drafts could restore in another
  business → tagged, frozen, stale-tab submit blocked; AUTH-40 POST/PUT /api/users attached EXISTING
  accounts without consent → invite only; INT-04 (pre-existing, live until now) unescaped names in
  invite / verification / OTP mails; AUTH-42 invites: rate limits (sequential, hashed, per business +
  loose global), seat pre-check + Serializable seat-locked accept, a failed invite never blocks
  Google sign-in; user-only auth for the switch (signed ctx, no billing trap, only importer);
  inactive businesses never kept; MASTER from the selected business.
- Staff bot (bot-session) deliberately untouched (Rafael rule); guard test keeps every bot-seat lock
  site Serializable.
- Proof: tsc 0; security 257, chat-harden 426, site/pedidos/config/tenant-ui, bot-inbox, soft-ai
  green. Deploy detected via new JS string on /auth/signin (no public route unique to the build).
  Live: drive-phase2a + drive-phase2b all true; switcher checks (memberships API, same-business
  no-op, foreign business 403, static header for 1 business, sign-in error text) all true; tail
  0 exceptions, crons ok.

## 2026-09-29 — Phase 2b workspace SHIPPED (036 applied, 99650237 live) — switcher held back

- Green baseline first (785d4c0): the 4 long-failing tests + 19 test type errors fixed, none
  removed (Windows CRLF / path separators; vercel.json → wrangler cron; Embedded Signup test rewritten
  for the current retryAfter design). tsc 0, all 29 offline suites green.
- Advisor plan → slices S0–S7 on claudio/phase2b-workspace: 036 (ChatConversationWorkState,
  CrmTask, WorkspaceNotification, ChatWorkspaceSettings; new tables only, RLS); note scope
  (solo este chat / todo el cliente); quick-reply + first-response activity; presence ("Ana está
  respondiendo", in-memory 20 s); @mentions + bell notifications + /chats?c= deep link; Posponer +
  Pospuestos; tasks / reminders + /tareas + overdue in bell; assignment rules (round-robin / least
  busy), business hours, auto-close, reopen-on-inbound — all OFF by default, per-minute sweep via the
  Worker */1 cron (also wakes expired snoozes). Plus INFRA-12 retention cron (30 3 * * *) and MEDIA-10.
- Reviews: Verifier ×2 + SecureDog on 785d4c0..a771a07. Real bugs fixed before prod, e.g. M1 (Prisma
  NOT drops aiMode NULL → rules would never assign), M2 (deep link dead on /chats), reopen backlog +
  fail-safe, stale pinned rows, DATA-12 (036 CHECK would have broken the Meta data-deletion callback;
  fixed in the SQL before apply), AUTH-39, DATA-13/14, INFRA-13. Register updated.
- 036 applied `ok 036 in 1602ms`. Deploy 99650237 (first wrangler call silently didn't deploy —
  verified with `wrangler deployments list`, re-ran). Rollout mixes old/new containers for a few
  minutes: poll /api/cron/<new route> (public path: 404 old → 401 new) before UI checks.
- Live proof: drive-phase2b.mjs on www (isolated tenant, read-only): snooze button + Pospuestos,
  tasks panel, notes, presence / tasks / notifications / rules APIs (rules all off), /tareas + nav,
  bell, Config › Chats rules card — all true (note-scope toggle hidden: test chat has no client).
  wrangler tail: 0 exceptions; `[cf-cron] ok cron=*/1` with the new sweep.
- Business switcher (S8, claudio/phase2b-switcher) NOT shipped: SecureDog round 2 left L2 remainder,
  N1 Medium (/api/users attaches existing accounts as active members without consent — now visible in
  the switcher), N2, N3. Fixing next.

## 2026-09-29 — Phase 2a SHIPPED (035 applied, 7bad9641 live)

- 035: first run refused by the apply script — my rollback note in the header contained a literal
  `DROP TABLE` (the destructive-SQL check scans comments). Reworded (8305bd6); a guard test now runs
  the script's regex over every migration ≥ 034. Re-run: `ok 035 in 2039ms`, feature flags off.
- Deploy `npx wrangler deploy --keep-vars` from claudio/phase2-workspace @ 8305bd6 → Worker
  7bad9641 (rollback target a21c2eb1; old code ignores the new tables). The container kept serving
  the old image for a few minutes after the Worker switched (first UI drive saw the old rail).
- Live smoke: signin/home 200; new endpoints 401 logged out; forged headers on /api/orders/x.png
  401; CSP + Referrer-Policy intact. verify-betsy drive-phase2a on www: every check true incl.
  notes panel, Config › Chats (3 editors, client defaults Nuevo lead → … → Recurrente).
  wrangler tail: 0 exceptions, all ok.

## 2026-09-29 — Phase 2a review fixes (branch claudio/phase2-workspace; 035 NOT applied, not deployed)

Verifier (S1–S7, N1–N10) and SecureDog (Lows + AUTH-38 Medium) findings on the workspace slice:
- **Client stage engine v2:** open orders older than 45 days or older than the last finished order
  no longer pin a client; statuses the business marked terminal count as finished; "Completado"
  is production; only successful guías count (failed Correos attempts ignored); `repeatCustomer`
  keeps the "Cliente recurrente" badge while a new order is in progress; an abandoned unpaid order
  is never "Entregado". "Team replied" check goes through the client's conversations (index).
- **Tenant safety:** lifecycle writes are `updateMany` by clientId+tenantId then create (DATA-08);
  `getClientStage` re-checks the client's tenant; PATCH / import-local-state validate stage keys and
  tags against the business catalog (DATA-07).
- **Before 035:** "table missing" memoized 5 min for stages / tags / lifecycle / notes (INFRA-09);
  stage chip read-only and legacy "Nota original" still shown.
- **Notes:** delete wipes the text (DATA-10); author names via `staffDisplayName` (DATA-09); own
  `workspaceWriteRateLimit` bucket for notes POST/PATCH/DELETE and client stage PUT (INFRA-10);
  legacy client note only for the linked client, not suggestions/search; INT-03 guard widened to
  Meta / send-guia / soft-ai routes / chat-automation cron and bans `notes: true` there.
- **Permissions:** GET stage / tag lists need update_sales or view_config (AUTH-37); GET
  `/api/shipping/generate-guia` needs view_production, is tenant-filtered and never returns PDFs
  (AUTH-38). Guía activity uses `Order.id` and an allow-listed surface.
- **UI:** toast on a failed stage change; renamed tag labels in the filter and thread chips; notes
  reload when a client is linked; no "your role cannot" guía hint while the session loads; config
  archive → re-add restores the archived stage/tag; 30 active stages / 50 active tags.
- **Re-check round (Verifier + SecureDog on 7f7e6c5):** my 035 comment tripped the RLS guard
  (phantom table "takes") — I had wrongly logged test:security as baseline; guard now strips SQL
  comments (both directions, self-tested). "Completado" = finished (walk-in / picked-up), feminine
  cancel forms, manual pick retried on P2002, tag toggle toast, Pedidos guías logged as `pedidos`.
  Notes edit/delete are conditional `updateMany` on live notes (DATA-11). workspaceWriteRateLimit
  also on PATCH conversation, import-local-state and link/unlink. Regression tests for AUTH-37/38,
  DATA-07, DATA-11, INFRA-09. Still open (tracked Low): ActivityEvent retention cron.
- 035 header: quiet-window + rollback note. Proof: Phase 2a tests 37/37; chat-harden, security,
  soft-ai at baseline; config-ui, site-ui, pedidos-ui, chat-mobile, theme green; lint 0 errors.

## 2026-09-29 — Phase 1 security SHIPPED (034 applied, a21c2eb1 live)

- Pre-check (read-only, 19:37 UTC): no long transactions; 45 users; 0 members of inactive tenants;
  0 never-activated accounts (AUTH-32 closed).
- 034 applied with Rafael's GO via the gated script (`ok 034`); postcheck: sessionVersion int
  default 0 (all 45 at 0 → no logouts), passwordChangedAt, "User_email_lower_idx", RLS still on.
- Deploy `npx wrangler deploy --keep-vars` from claudio/dark-mode @ 16e351e → Worker a21c2eb1;
  container rolled in ~40 s (rollback target 560d10ee).
- Live smoke: single CSP incl. Turnstile host, Referrer strict-origin-when-cross-origin,
  /api/auth/turnstile-config {siteKey:null} (Turnstile off), /monitoring junk → 400,
  forged identity headers on /api/orders/x.png → 401 (was reaching the handler), signin/home 200.
  wrangler tail: 74 requests, all ok, 0 exceptions.
- Security Register: AUTH-08 Verified (034 applied); nothing blocks prod.

## 2026-09-29 — Phase 1 security code (S1–S7; branch claudio/dark-mode, not deployed)

Advisor plan → slices, each with tests in `test:security` (195/196; the 1 failure is baseline):
- **S1 header spoof (High):** middleware skipped paths ending in an image extension, so
  `/api/<route>/x.png` reached handlers with client-set `x-user-id`/`x-tenant-id`. Matcher now adds
  `/api/:path*`; middleware signs its context (`x-betsy-ctx-sig`, HMAC from NEXTAUTH_SECRET) and
  handlers trust only signed headers (`src/lib/internal-auth-context.ts`). Logistics audit actor
  (`x-user-email`) now set.
- **S2 invite pre-hijack (High) + self-reactivation (Medium):** registering an invited email joined
  that business with no mailbox proof. Now only with the emailed invite token, a verified email, or a
  Google-verified email; verify-email never re-enables deactivated accounts; resend is generic.
- **S3 login gates:** lockout on failures (email+IP 5/15 min, IP 30/15 min; no global per-email lock),
  bcrypt timing equalizer, email verification opt-in via `EMAIL_VERIFICATION_ENFORCE_FROM` (only
  accounts created after it). Kill switch `AUTH_LOCKOUT_DISABLED=1`.
- **S4 reset links:** 256-bit token, SHA-256 at rest, 30 min, single atomic consume, verifies email;
  legacy UUID links accepted until they expire.
- **S5 session revocation:** migration **034 prepared, NOT applied** (`User.sessionVersion`,
  `passwordChangedAt`). Code works before and after it (raw SQL, missing-column fallback).
- **S6 data:** full DB export OWNER/ADMIN only (was `view_config` → SALES could dump everything),
  audited + rate limited; formula guard on every CSV/XLSX exporter; xlsx zip-bomb scan; import preview
  needs `create_sales`.
- **S7 web:** single CSP (next.config.js), Sentry tunnel `/monitoring` always on (the 403), replay
  masking explicit, Turnstile scaffold OFF until `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`.
- **Review rounds** (SecureDog ×2, Verifier): fixed in db9e70f, e228964, 8a99432:
  - AUTH-07 (Critical, pre-existing): `/api/bulk/*` type `users` wrote any column of any global User
    row (email, password, isSuperAdmin) or deleted it, for any owner of any tenant → refused.
  - AUTH-23 (High, pre-existing): ADMIN could grant OWNER / remove the OWNER → role hierarchy +
    last-owner guard (`src/lib/member-admin-guard.ts`).
  - AUTH-08/09: invites join only with the emailed token (never "newest invite for the address").
  - AUTH-10 (H1): right-most X-Forwarded-For hop (preview could rotate the first hop).
  - DATA-03 (H2): xlsx guard inflates for real with a cap (`src/lib/xlsx-guard.ts`).
  - AUTH-11/12 (H3/M1): reset = one UPDATE incl. sessionVersion; verifies email only post-034.
  - AUTH-13 (M2): every API request re-checks membership + role (cached 60 s).
  - AUTH-14/15/16: atomic attempt reservation, per-email cap, IPv6 /48, Redis TTL-safe counters.
  - INFRA-05 (M6): Sentry tunnel is our own allow-listed relay (the rewrite forwarded cookies).
  - Lows: exact `lower(email)` lookups (Prisma insensitive equals = ILIKE wildcards), timing,
    Sentry token scrub, SQL export `*/`, CORS preflights, non-ASCII email header.
  - 29 cookie-only routes use `getLiveToken` (revocation + membership).
- **Final sign-off (SecureDog, 6f1cb8a):** DATA-03 and AUTH-23/25/28 Verified (xlsx rebuilt from
  guard-inflated entries; `active` must be boolean). AUTH-08 Verified conditional on 034 first.
  All findings are in the Notion Security Register; only AUTH-08 still "Blocks prod" (until 034).
- **Deploy order: apply 034 BEFORE this code reaches prod** (revocation / squatter protection are
  inert without it; the code itself runs either way).
- Gotcha: local `tsc` crashes natively on node 24 (even `--jitless`); run it in Docker:
  `docker run --rm -v "D:/Coder/CRM-v2-chatfix:/app:ro" -w /app node:20-slim node node_modules/typescript/bin/tsc --noEmit -p . --incremental false`.
- Deferred: S8 TOTP for owners/admins (own migration), automated tenant deletion (legal review).
- Gotcha: `tsc` showing ~280 "not callable" errors = stale `tsconfig.tsbuildinfo`; delete it.
- `supabase/migrations/*` is gitignored: migration files must be `git add -f` (033 was untracked).

## 2026-09-29 — Security: Supabase data-API exposure closed (033 applied)

- `scripts/security-rls-check.mjs` (read-only) found 7/75 public tables without RLS and readable by
  anon/authenticated via PostgREST: TenantInvite (invite tokens) + 6 lm_* retiro/delivery tables.
  The 19 `lm_* admin only` policies are safe (`lm_is_admin()` needs an auth.uid()).
- 033_security_rls_lockdown.sql: ENABLE RLS (deny-all, no policies) on the 7; applied 05:0x UTC with
  Rafael's GO via the gated apply script (postcondition ok). Re-check: 0 exposed, 75/75 RLS.
  App unaffected (owner connection bypasses RLS); no permission errors in Workers Logs after apply.
- Guard test: migrations ≥ 033 must ENABLE RLS on every table they create (in test:security).
- Pending (Rafael, Cloudflare dashboard): enable R2 (backups off Vercel), Turnstile widget keys.

## 2026-09-29 — Chat files → Supabase Storage; quick-reply saves atomic; Workers Logs on

- Root cause (found via Workers Logs): Cloudflare's `BLOB_READ_WRITE_TOKEN` was rejected by Vercel
  ("Access denied") → quick-reply uploads failed, chat media never cached, backups at risk.
- Chat files now on Supabase Storage (`src/lib/chat-storage.ts`): private bucket `betsy-chat` in the
  same project as the DB, service role only, hard timeouts, privacy verified on every start, https
  `*.supabase.co` only, no redirects, legacy Vercel reads/deletes. No schema change (same paths in
  `ChatMessage.mediaBlobPath` / settings). Backups stay on Vercel Blob (off-site) — verify 14:00 UTC run.
- Quick replies: POST `{op: upsert|delete}` in a transaction with `SELECT … FOR UPDATE` (the version
  check produced false "Alguien más cambió"). Upload 60 s client timeout.
- Workers Logs enabled (`observability` in wrangler.jsonc): container console + exceptions queryable.
- Secrets set (Rafael GO): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Live: 61c5b7ea; Rafael's test
  upload + save at 03:16 UTC succeeded. SecureDog: OK (M-1 verified live: bucket private, only bucket).
- Open: rotate to a revocable `sb_secret_` key (L-4); register SecureDog items in Notion; confirm backups.

## 2026-09-29 — Outage: www 1101 for ~25 min (container stuck) + failover

- 00:21 UTC Cloudflare recreated the single container instance (`cf-singleton-container`); it stayed
  `inactive` and every Worker `container.fetch` threw a Durable Object `internal error` → Error 1101 on
  every page and webhook. No deploy / code change preceded it (live 73ae0636 since 22:51). A plain
  redeploy (b3a4dffb) did not reset the stuck object.
- Fix (8ee63e4e, branch `claudio/hotfix-container`, Rafael deployed 00:46): named container object
  `betsy-main-2` + `max_instances: 2`. Site back.
- Prevention (this branch): `fetchWithFailover` — thrown platform errors retry once on a standby object
  `betsy-standby-1`; if that fails too, a branded 503 page (API: JSON 503, Meta retries). Logged as
  `[container] primary failed` in `wrangler tail`. Runbook: docs/ops/aurora-release-plan.md › Outage.
- Separate: one Docker build hit a transient Next build-traces crash (`_interopRequireDefault` on
  number); the same commit built clean on retry.

## 2026-09-28 — Chats: drag & drop + paste images (branch `claudio/chat-feedback-batch`)

- Drop a file anywhere on the open chat (overlay "Soltá la imagen para adjuntarla") or paste a
  screenshot (Ctrl/⌘V) in the composer: it is staged like the paperclip (thumbnail + optional
  caption, then Enviar). Same gate as the paperclip (WhatsApp, Humano/pausa, not sending); client
  checks accept list + 9 MB, server still validates bytes. `src/lib/chat-attachment-drop.ts`.
- Prove: `test:chat-feedback` 31/0, soft-ai baseline (2), chat-mobile 6/0, tsc clean, eslint 0 errors.

## 2026-09-28 — Chats feedback batch (branch `claudio/chat-feedback-batch`, base `rafa/fix-token-health`)

- Source: Rafael's walkthrough doc (bugs + features, 2026-09-28). Decisions: outbound media ON by
  default (flag = kill switch), quick replies team-wide in `Tenant.settings` (no migration),
  payment confirmation skipped for now.
- **Humano by default:** server `aiMode` NULL/unknown = Humano in the UI (`conversationAgentMode`);
  the composer was locked ("El agente está respondiendo") for chats the agent never answers.
- **Media:** `/api/chat/media` now serves the downloaded bytes even when the private Blob write
  fails (was 502 → "No se pudo mostrar" for every image/audio when the cache store is missing),
  and prefers Graph `mime_type` over a generic CDN content type (octet-stream + nosniff never
  renders). New `ChatMediaBubble`: voice-note player (waveform, seek, 1×/1.5×/2×, one at a time),
  image lightbox, document card, fallback that shows the real reason + Reintentar.
- **Sending:** `chat_outbound_media_v1` default ON (`isTenantFeatureNotDisabled`); send core in
  `chat-send-media-core.ts`; "Recientes" (`GET /api/chat/recent-media`, JSON re-send by
  `sourceMessageId`); `POST /api/chat/send-guia` sends the order's Correos PDF (order must belong
  to the chat: linked message, same client or same phone).
- **Composer:** auto-grow textarea; emoji picker (in-house, Spanish search, recents); quick
  replies `/atajo` (`GET/PUT /api/chat/quick-replies`, `jsonb_set` on `chatQuickReplies` only);
  per-chat unsent text kept when switching chats.
- **Rail › Cliente** (additive optional tab in `SoftCopilotRail`): link/unlink an existing client
  (`GET/PUT /api/chat/conversations/[id]/client`, audited), stats, chat orders with
  Generar guía → Enviar guía.
- **Crear pedido drafts:** per-chat slot `betsy_autosave:chat:<id>` (debounced + on close,
  restored on reopen, "Continuar pedido · Borrador"); the chat form no longer overwrites the
  /ventas draft.
- **Route loading:** persistent `AuroraFrame` in the root layout (sidebar stays mounted);
  `loading.tsx` files render Aurora skeletons inside it instead of the pre-Aurora ones.
- Review: verifier PASS WITH NOTES; SecureDog no Critical/High (2 Medium, fixed before deploy):
  quick replies PUT needs `update_config`, audited, versioned (409 on stale tab); manual client link
  to another phone needs confirmation; guía to a non-matching phone needs confirmation and every
  send is audited; AI `ownershipOk` trusts a linked client only when its phone is the chat's;
  re-send limited to outbound photos/videos/documents (never guías); media limiter on send-guia;
  "Reenviar" and repeated "Recientes" really re-send; Enter never sends a half-typed `/atajo`;
  audio/video `preload="none"`; `/config` loading stays empty (intentional).
- Open (register): L3 default-ON scope (global env kill switch, legacy .doc/.xls/.ppt), L4 drafts
  not cleared on sign-out, pre-existing INFRA middleware matcher skips `/api/*.png` header strip,
  AI `get_shipping_status` filters guías by `order.id`; verifier notes 5 (legacy agentState vs
  NULL aiMode), 6 (Desvincular re-links on next message for a phone match), 8 (old rows cached as
  octet-stream).
- Prove: `test:chat-feedback` 27/0; site-ui 50/0, stats-ui 42/0, config-ui 30/0, pedidos-ui 22/0,
  chat-mobile 6/0; soft-ai 2, soft-ai-agent 1, security 1, chat-harden 2 failures = base; +1
  chat-harden in this worktree only (CRLF checkout of untouched chat-linked-orders.ts). tsc clean,
  eslint 0 errors, clean `next build`.

## 2026-09-28 — Crear pedido stuck on "Guardando" (branch `rafa/fix-token-health`)

- Symptom: order saved but the drawer kept spinning (and a second click could duplicate the order).
- Cause: after `POST /api/orders` the form awaited `automatic-clients/sync`, which walks every order of
  the tenant and does sequential per-customer queries (minutes on large tenants), then the hand-off.
- Fix: no per-order full sync; `update-from-order` runs in the background and refreshes that customer's
  stats (tenant-scoped aggregate by phone, trimmed too; never writes 0). One orderId per draft +
  `Idempotency-Key` + 45 s timeout; legacy POST returns the saved order for a repeated orderId; HTML
  gateway errors get a Spanish message; drawer closes as soon as the order exists (chat link after);
  synchronous double-submit guard. Tests: `order-submit-flow` (in `test:pedidos-ui`).
- Verifier: PASS WITH NOTES; notes 1, 4, 5 applied. Open (product call): the manual "Sincronizar" is
  still the slow full sync, and client rows from website/Excel/`/api/sales` orders now appear only after it.

## 2026-09-28 — Token health false "Error de token" (branch `rafa/fix-token-health`)

- Symptom: all channels showed "Error de token" after the 06:00 UTC `chat-token-health` cron; messages
  kept flowing. DB (read-only, Rafael OK): every active line `tokenStatus=error`, `lastErrorCode=100`.
- Cause: the probe signed `appsecret_proof` with the default (main app) secret; WhatsApp tokens belong to
  the WA app (sends use `purpose: 'whatsapp'`). Side effect: `agent-claim-gates` pauses AI agents unless
  status is valid/expiring, so Forge ventas stopped auto-replying.
- Fix: WA probe uses the WA secret; IG probes the linked Page (the object sends use); timeouts / 5xx /
  rate limits (incl. 80001/80002/80008, `is_transient`) keep the stored status; `lastErrorCode` =
  `code/subcode`; failures logged with the Meta message token-redacted. Tests: `token-health-probe`.
- Verifier: PASS WITH NOTES (notes 1–3 applied). Deployed to Cloudflare (dc0827bc) with Rafael's GO.
- Data: Rafael ran `scripts/reset-false-token-errors.mjs` (5 rows error/100 → valid). Next 06:00 UTC run re-checks with the fixed probe.

## 2026-09-28 — Browser walkthrough + release plan (PR #88)

- Railway preview auto-deploy enabled (Rafael); Linux build of the final code: Success.
- Walkthrough as PeterTesting on the preview (desktop + 745 px mobile): Inicio, Chats (Abiertos
  default, empty rail state), Pedidos, Crear pedido drawer, Producción (Aurora, list renders),
  Estadísticas, Config › Equipo + invite modal (email invite default, no Owner), Canales, Exportar,
  Respaldos, Ayuda. Fixes in 3dbdbde: feedback panel light scope, staff names never an email (menu,
  sidebar, Equipo), Respaldos readable error, Exportar in Spanish, "Más" sheet above the banner —
  all re-verified on the redeployed preview.
- Preview rate-limit probe (unknown email, no side effects): Railway overwrites X-Forwarded-For →
  AUTH-04 not exploitable (Notion: Won't fix).
- INFRA-03: `workers_dev` / `preview_urls` false (effective at next wrangler deploy); ops smoke on www.
- Release runbook: `docs/ops/aurora-release-plan.md` (Docker + CLOUDFLARE_API_TOKEN on the deploy
  machine, record current version, `wrangler deploy`, smoke, `wrangler rollback <id>`).

## 2026-09-28 — Final review round on `rafa/aurora-on-live` (PR #88)

- Verifier (Opus xhigh): PASS WITH NOTES → all 7 notes fixed in 1511d9c (default inbox view "Abiertos",
  thread network-error state, send-media retry dedupe, audio caption, stale-data banners on Canales /
  Producción, no double header on compact).
- SecureDog (Opus max): OK for deploy; all batch-2 findings VERIFIED fixed. New notes fixed in 3953235:
  MEDIA-08 filename/extension bypass (dormant, flag off), MEDIA-09 10 MB middleware body cap (uploads
  ≤ 9.5 MB, Content-Length required), DATA-02 sender label never an email, IPv4-mapped/canonical IPv6,
  worker strips internal identity headers. Notion register statuses updated.
- `chat_outbound_media_v1` stays OFF for every tenant until tested on a real WhatsApp line.
- Prove: `tsc --noEmit --incremental false` 0 errors outside tests; chat-harden 336/2, security 136/1
  (pre-existing baseline); site-ui 50, config-ui 30, channels-ui 10, agentes-ui 34, pedidos-ui 15,
  tenant-ui 9, backups 8, chat-mobile 6 — all green. Clean `next build` passed at e34b96e; later local
  builds hit a native webpack-worker crash (0xC0000005) that also reproduces on the previous commit
  (environment, not code). Confirm with the Linux build on Railway / the Cloudflare image.

## 2026-09-28 — Release batch 3 on `rafa/aurora-on-live` (PR #88)

- Chats: send photos / videos / audio / documents on WhatsApp (`/api/chat/send-media`, magic-byte
  validation, Meta limits) behind TenantFeatureFlag `chat_outbound_media_v1` — OFF for every tenant
  until tested on a real line. `/api/chat/capabilities` exposes the switch.
- Verifier batch-2 fixes (4d918d0): mobile owner picker, fresh accounts on inbox mount, no fake
  reconcile after a failed first load, FAB/shell registration, Upstash timeout → memory limiter,
  PATCH keeps linkedOrder/agent labels, owner-based buckets, accept-invite copy.
- A11y: labels, composer aria-label, aria-current on chat rows, mobile "Más" focus trap/return, AA
  contrast on essential metadata. Error states: Canales, Producción, Agentes, Inicio recent orders,
  chat thread. Config: 72 alert() → Aurora toasts (`ui-notify`), 24 confirm() → global
  `AuroraConfirmHost` (`auroraConfirm`).
- SecureDog batch-2 fixes (61c1831): AUTH-02/03 limiter pruning + timeout, fail-closed trusted IP
  header + IPv6 /64, INFRA-04 worker strips cf-container-target-port, DATA-01 chat send tenant
  checks, DATA-P2 archived orders, AUTH-05 assignable members + audit, shared staffDisplayName.
  Open in Notion: AUTH-04 (Railway XFF), INFRA-03 (workers_dev), AUTH-06 (latent middleware).
- Windows build note: the TypeScript incremental cache (`tsconfig.tsbuildinfo`) and `.next` get
  corrupted by crashed builds on this box (~280 bogus Prisma "not callable" errors). Prove with
  `rm -rf .next tsconfig.tsbuildinfo && NODE_OPTIONS=--max-old-space-size=8192 npx next build --no-lint`
  and `npx tsc --noEmit --incremental false`; lint separately (`npx next lint --dir src`, 0 errors).
- Prove: clean build exit 0; tsc 0 errors outside tests; security 135/1, chat-harden 327/2,
  site-ui 50/0, config-ui 30/0, agentes-ui 34/0, channels-ui 10/0 (failures = pre-existing baseline).

## 2026-09-28 — Release batch 2 on `rafa/aurora-on-live` (PR #88)

- Walkthrough fixes: chats rail "Ningún chat seleccionado" (in SoftCopilotInboxV2; SoftCopilotRail
  untouched), feedback in profile menu / Más instead of a FAB inside AuroraShell, banner "Renovar"
  contrast, greeting never shows an email.
- Security AUTH-01: rate limits key on `cf-connecting-ip` (worker sets TRUSTED_IP_HEADER); bounded
  memory store; Upstash timeout 1 s + ephemeral cache. Docs: `docs/ops/upstash-redis.md`.
- Chats: order numbers on linked chats (`chat-linked-orders.ts`, revision bump in order-link);
  owner avatar + "Asignar" picker (`GET /api/chat/assignees`, update_sales); auto-assign on the first
  delivered human reply (Rafael 2026-09-28).
- Aurora shell for /produccion, /exports, /ventas/dashboard, /backups, /super-admin
  (`AuroraClassicPage`, presentation only) and /auth/accept-invite (AuthShell). Logistics stays separate.
- Perf: one accounts request per page; first inbox load no longer races a reconcile fetch.
- Prove: tsc 0 new; build passes (`next build --no-lint`; integrated ESLint worker crashes on this
  Windows box — lint run separately, 0 errors); chat-harden 315/2, security 126/1, site-ui 48/0,
  tenant-ui 9/0, backups 8/0, chat-scale 15/0 (failures are pre-existing baseline).
- Not done: outbound media, "+" new chat (Rafael: later), bell counts endpoint, states/a11y sweep.
  Railway auto-deploy is disabled for this branch — preview still on b962456 until redeployed.

## 2026-09-27 — Release-candidate slices on `rafa/aurora-on-live` (PR #88, draft)

- **Chats `[unsupported]` / `[type]`:** display-only `src/lib/chat-message-display.ts`. Meta 131051
  "unsupported" → "Mensaje no compatible" + what to do (names the kind when `unsupported.type` exists);
  reactions, contacts, location (maps link), orders, system, IG story mention / share / reel. List
  previews map tokens to Spanish. Parser and agent input untouched. Not a Betsy bug: Meta sends no content.
- **Ctrl/⌘K:** V2 inbox had lost the legacy handler. Now focuses the visible chat search; hint shows
  ⌘K / Ctrl K; search also calls `/api/chat/conversations?q=` (debounced, add-only merge).
- **Media:** `/api/chat/media` serves Instagram attachments (pre-signed CDN URL from the stored payload,
  https Meta hosts only, no token sent), single-range 206 for iOS audio/video, cap 25 MB. Player has
  per-type fallback + Descargar; voice notes always downloadable (iPhone cannot play ogg/opus).
  Message DTO now sends a URL-free projection of `metadata.rawMessage` (Meta CDN links no longer reach
  the browser). Outbound media still unsupported (unchanged).
- **032 perf indexes (NOT applied):** ChatMessage (tenantId, orderId) partial; pg_trgm GIN on Order
  customerName/orderId/phone/product and ChatConversation peerName/peerId/lastMessagePreview. Gated
  `BETSY_V2_APPLY_FILES=032`, apply in the madrugada; apply script verifies 8 valid indexes.
- **Crear pedido:** Aurora restyle, class/markup only (`sales-form-styles.ts`), audited no logic change.
- Prod check (read-only): `GET /api/invites/accept?token=<random>` on www → 404 JSON ⇒ 030 `TenantInvite` exists.
- Prove: build passes; chat-harden 296/2, security 122/1, pedidos-ui 15/0, tenant-ui 9/0, site-ui 45/0,
  chat-mobile 6/0 (remaining failures pre-exist on a parent tip).
- Still open: Railway preview must be pointed at `rafa/aurora-on-live`; browser walkthrough; outbound media.

## 2026-09-27 — Aurora onto the live line (Claude Code, handover step 1–3)

- Branch `rafa/aurora-on-live` = `claudio/team-users-sota` (#77, live CF line, 19 commits ahead
  of the Aurora stack) + merge of `aurora/pr-j-site-rest` (#78–#87). Replaces the unfinished
  Claudio merge from 2026-09-26 (never pushed).
- Conflicts resolved by keeping both sides:
  - `dashboard/enhanced-home-content.tsx`: Aurora home + `canAccessLogistics` DeepSleep gate.
  - `chats/SoftThreadPane.tsx`: Aurora bubbles + live human-sender avatar/label; the label also
    shows in the mobile (compact) meta line; Google photos use `referrerPolicy="no-referrer"`.
  - `config/page.tsx`: Aurora server wrapper. Live's classic-form invite changes were ported to
    Aurora `InviteMemberModal` (default "Invitar por email" → `invite: true`, no OWNER by invite,
    toast on `emailSent`; "Crear con contraseña" kept) and `UsersPanel` (`User.image` avatar with
    initials fallback, `name || username`).
- Aurora nav: Producción back under Principal (`/produccion`), Más sheet picks it up on mobile.
- Tests updated for intentional changes only: `aurora-site-rest` (invite modal), `chat-inbox-v2-client`
  (Reconectar link accepts `/config?tab=social`), `aurora-nav` (Producción).
- Prove: tsc — 0 new errors (remaining are test-file typings present on the parents).
  Suites: security 122/1, site-ui 45/0, config-ui 30/0, channels-ui 10/0, agentes-ui 34/0,
  stats-ui 42/0, chat-mobile 6/0, pedidos-ui 15/0, lifecycle 8/0, chat-harden 283/2,
  soft-ai-agent 129/1. Every remaining failure also fails on a parent (live or Aurora tip):
  `runSoftAiLlmRuntime … shared assembly`, `webhook persists job…` (Vercel crons emptied for CF),
  Embedded Signup FINISH-race source assert.
- Not done here: Aurora skin for Producción / Exports / Logistics, broken-page fixes, Enviar
  feedback button overlap, browser eye-test, SecureDog review. No deploy, no SQL, no www.

## 2026-09-25 — Cloudflare Containers daytime packaging

- `Dockerfile` + `.dockerignore` for Next standalone (`prisma generate` via `npm run build`, `@sparticuz/chromium` + puppeteer runtime libs, Correos WSDL copied to both resolve paths).
- `DISABLE_CRONS=1|true` makes every `/api/cron/*` return 503 in middleware before the handler.
- Ops note: `docs/ops/cloudflare-containers-daytime.md`. No DNS, Meta, or Vercel Production changes.
- Prove: `npx tsx --test src/lib/__tests__/cron-kill-switch.test.ts`. Docker is not installed on the agent VM, so `docker build` was not run.

## 2026-09-23 — Instagram reconnect no longer 500s on SocialAccount P2002

- `upsertInstagramSocialAccount` updates the same-tenant Instagram row (active or
  inactive) and refreshes token, expiry, user, and channel identity.
- An active `(platform, accountId)` owned by another tenant — partial unique from
  `025_chat_inbox_uniques.sql`, or a legacy unique on those two columns — returns
  `InstagramSocialAccountConflictError`. Callback and complete render Spanish HTML
  409. The other tenant's row is not modified.
- Create races that hit P2002 re-read and update the same-tenant row. Unrelated
  errors still propagate.
- Prove: `src/lib/__tests__/instagram-social-account.test.ts` (in-memory delegate;
  no live DB writes). Included in `npm run test:security`.
- Out of this slice: bot paths, Soft chrome, schema/SQL, Meta Submit.

## 2026-09-22 — P4: monitor attribution in /chats (AT-WA-3, G23)

- Agent-layer delivery in `agent-turn.ts` snapshots `agentName` and `agentEmoji` onto the
  outbound `ChatMessage` metadata, next to `softAi`, `agentId`, and `turnId`.
- `softAiOutboundLabel` in `agent-inbox-projection.ts` reads that snapshot only.
  Agent layer → `<emoji> <name> envió` (emoji omitted when the snapshot is blank).
  Legacy Soft AI (`softAi` without `agentId`) and rows that have `agentId` but no stored
  name stay `IA envió`. The label never looks up the current binding.
- `SoftThreadPane` bubble footer uses the helper. Demo bubbles stay `IA envió`.
  SoftSlimNav, SoftInboxBuckets, and SoftCopilotRail are untouched.
- Out of this slice: P5 live phone proof, unlock/Probar, staff bot, Soft chrome, schema/SQL,
  Meta Submit, Vercel.
- Prove: `npm run test:soft-ai-agent` and `npm run test:chat-harden`. Screenshots wait for
  the Railway eye-test after CoS attaches this branch. Stable `dev` host:
  https://betsy-crm-production.up.railway.app
- Plan: `docs/plans/betsy-forge-wa-probar-live-fidelity-grok47-fable-2026-09-22.md` §5 P4.

## 2026-09-22 — P3: audited unlock gate (AT-P-3, AT-P-4)

- Decisions in force: **D1 off** (`strictUnlockVersion` default false; hash + agentId + model
  bound; version recorded and warned), **D2 on** (five forge-wa-v2 canaries through
  `runAgentTestTurn`), **D3** unchanged (Avanzado PATCH, no SQL).
- `AiFullUnlockRecord` accepts optional `agentId`, `agentVersion`, `model`, `canaryCount`.
  `hasAiFullUnlock` / `aiFullUnlockStatus` fail closed on hash, agent, or model mismatch.
  Resolver and pre-send gate 10 pass that context (G6).
- `mutateChatAgentLayerConfig` locks `TenantFeatureFlag` with `SELECT … FOR UPDATE`.
  Allowlist, panic remove, and unlock write go through it. Audit stays after commit (G9, P2028).
- Rebind or deactivate deletes `aiFullUnlock[accountId]` (G4). Shortcut create, update, and
  delete bump `ChatAgent.version` in the same transaction (G10). `expectedVersion` consumers
  are unchanged, so an in-flight turn fails `stale_version`.
- Replay stays read-only and accepts optional `socialAccountId`, returning `boundAgentId` (G3).
- `POST /api/chat/agents/[id]/test/unlock` (`update_config`) writes the record and audits
  `chat_agent_ai_full_unlock`. Refusals: `ACCOUNT_NOT_TENANT`, `ACCOUNT_NOT_ALLOWLISTED`,
  `ACCOUNT_NOT_WHATSAPP`, `AGENT_NOT_BOUND`, `AGENT_NOT_LIVE`, `REPLAY_FAILED`,
  `HASH_MISMATCH`, `CANARY_FAILED`, `TEST_BUDGET_BLOCKED`, `XAI_NOT_CONFIGURED`.
  Canaries ignore `flag_off` so approval does not depend on ops flags. `unlockCanaries: false`
  skips them.
- UI: Pruebas internas **Aprobar envío real** with confirm; Canales shows envío real
  desbloqueado / bloqueado / aprobación vencida. Copy says Betsy chat / agentes / Probar.
- Out of this slice: P4 monitor label, P5 live phone proof, staff bot, Soft chrome, schema/SQL,
  Meta Submit, Vercel.
- Prove: `npm run test:soft-ai-agent` and `npm run test:chat-harden`. Eye-test is Railway
  after CoS attaches the branch. Stable `dev` host: https://betsy-crm-production.up.railway.app

## 2026-09-22 — P2: Probar ↔ live runtime parity

- Shared `assembleAgentRuntimeInputs` (`agent-turn-inputs.ts`). Live tool semantics win:
  force `search_approved_knowledge` only. Probar no longer force-adds `use_shortcut` (G16).
  Canal context and customer name use the same account select (G17).
- **Live prompt change (G18):** `loadHistory` excludes the trigger message
  (`id !== triggerMessageId`) before the 24-message window, so the current inbound
  appears once as `inboundText`. Rollback is that one filter.
- Shared `decideTurnOutcome` (`agent-turn-outcome.ts`). Probar computes `wouldSend`
  after the model (`outcome === 'send'`) and returns `outcome`, `needsHuman`,
  `fallbackUsed`, `escalate`. The sandbox turn stores the real `fallbackUsed` (G20–G21).
  `historyCount` is the windowed length, max 24 (G19).
- Probar resolves the channel binding. A different or missing serving agent adds
  `not_bound_to_channel` and does not call the model (G1). When flags are off the
  binding lookup still runs, so Probar does not depend on ops flag state.
  `selectWhatsappTestChannel` no longer falls back to any WhatsApp channel (G2).
- Optional Probar inputs: `customerName`, `conversationAiMode` (`ai_active` | `human` | `paused`).
  Live-only gates are labeled "No simulado en Probar" and are not reported as passed (G22).
- Probar bubbles are `WaBubble` `{ kind: 'text', from, text, at, label? }` with an
  exhaustive switch. Text only (AT-P-2).
- Out of this slice: P3 unlock, P4 monitor label, P5 live proof, Forge agent PATCH,
  staff bot, Soft chrome, schema/SQL, Meta Submit.
- Prove: `npm run test:soft-ai-agent` and `npm run test:chat-harden`. AT-P-1, AT-P-2,
  offline half of AT-WA-2.

## 2026-09-22 — P0+P1: Soft agent Grok 4.7 allowlist + guardrails

- Decisions in force: **D1 off** (not implemented; P3), **D2 on** (not implemented; P3),
  **D3 PATCH** (Avanzado button calls the existing agent PATCH; no SQL, no Forge row write).
- P0: `DEFAULT_CHAT_AGENT_MODEL` and `FORGE_WA_V2_FIXTURE_SET_HASH` live in `agent-types.ts`.
  `FIXTURE_SET_HASH_V2` is an alias. The v2 fixture module re-exports the hash (G7).
  Locked-path test rejects `@/lib/bot`, `@/app/api/bot`, and `process.env.WHATSAPP_` on
  soft-ai, chat API, and the P0/P1 files. Literal lock: no `grok-4.6` token under
  `src/lib/soft-ai/**` except `agent-types.ts`. P2/P3 modules are covered by the
  recursive scan once they exist; missing paths are not stubbed.
- P1: allowlist `['grok-4.7', 'grok-4.6']`, default `grok-4.7`. Creation, starter
  agents, shortcut-import turn fallback, and `resolveSoftAiModel()` use the constant.
  Prisma `@default` and SQL 027 left unchanged. Prompt cache key appends `model`.
- Pricing: verified 2026-09-22 on https://docs.x.ai/developers/pricing. `grok-4.7`
  short-context is $2 input / $0.50 cached / $6 output per 1M, identical to `grok-4.6`
  (long-context ≥200k is $4 / $1 / $12 for both). Estimator keeps the shared $2 / $6
  short-context rates and still bills cached tokens at the full input rate.
  `pricingVersion` stays `xai-2026-09`.
- UI: `/config/agentes` Avanzado shows a read-only Modelo line and, for `update_config`
  when the agent is not already on the default, **Cambiar a grok-4.7** via PATCH.
- Out of this slice: P2 parity, P3 unlock, P4 monitor label, P5 live proof, staff bot,
  Soft chrome, schema/SQL.
- Prove: `npm run test:soft-ai-agent`. Staff-bot diff empty (AT-WA-4).

## 2026-09-22 — Plan: Forge WA Probar↔live fidelity + Soft agent Grok 4.7 (Fable, docs only)

- Added `docs/plans/betsy-forge-wa-probar-live-fidelity-grok47-fable-2026-09-22.md` after
  Rafael's 2026-09-21 GO (ops enable flags + this plan + later Cursor implement). Mission A:
  make `/config/agentes` Probar a faithful dry run of `executeAgentLayerTurn` (shared runtime
  input assembly, shared send/suggest/skip outcome, channel-binding check, post-model
  `wouldSend`) and add an audited `POST /test/unlock` that writes `aiFullUnlock[socialAccountId]`
  (hash + agent + model bound). Mission B: allowlist `['grok-4.7','grok-4.6']`, default 4.7,
  Forge agent migrated by audited PATCH (SQL only as gated note).
- 23 gaps with file pointers; 8 acceptance tests (AT-WA-1…4, AT-P-1…4); packs P0–P5.
- Key findings: nothing writes `aiFullUnlock` today; Probar forces `use_shortcut` while live does
  not; live history duplicates the trigger inbound; Probar `wouldSend` ignores `needsHuman`;
  rebinding keeps a stale unlock; `/chats` cannot tell agent-layer from legacy Soft AI.
- Locks: Soft chrome HOLD, staff bot HARD LOCK (empty diff), no Meta Submit, no schema/SQL in
  PRs. Implementer model lock: grok-4.7 high fast only, never grok-4.5.
- Prove: docs only — `git diff --stat` = `docs/**`. PR stays draft; no merge without Rafael GO.

## 2026-09-21 — Plan: sales-agent pipeline SoT (CoS, docs only)

- Added `docs/plans/betsy-sales-agent-pipeline-2026-09-21.md` as the source of truth
  for Rafael García’s CR store sales-agent pipeline (locked 2026-09-21 with CoS).
  Sits above Arc 2 phases: sales layer only, inventory SKU mapping, GAM via
  `getCorreosAutomatedShippingCost` (no new geography; contra entrega never
  outside GAM), payment-proof pause, order after human approve, human post-sale.
- No product code, no schema. Implementer model lock: grok-4.7 high fast only.
- Prove: docs only — `git diff --stat` = `docs/**`. PR stays draft.

## 2026-09-21 — AL2-A1 UX redo: paste-import, plain atajos, WhatsApp Probar

- Owner flow on `/config/agentes`: paste "Cargar desde mis atajos" → review checklist → one Guardar (`import/extract` does not write config; `import/apply` bumps agent version once and writes one audit). Soft LLM via `llm/client.ts` when `XAI_API_KEY` is set; heuristic mapping covers the same facts for review. Confirmation wording stays a red row. Tokens for a model call go to `testDailyTokenCap`.
- Atajos default to title, customer text, and Activo. Keys, `sys_*`, templates, kind, and delivery mode render only after Avanzado. Starter chips insert resolved Spanish or stay disabled.
- Probar is a WhatsApp thread with one Enviar. A single WA binding is pre-selected. Replay, fixtures, pass rate, and the 24 h window sit under collapsed Pruebas internas. Pánico is Detener agente; history is collapsed Cambios recientes.
- No schema, Soft chrome, or staff-bot edits.
- Prove: `src/lib/__tests__/soft-ai-shortcut-import.test.ts` and the channel case in `soft-ai-probar-sandbox.test.ts`. Preview of this branch showed the saved checklist, plain atajos, and a Probar thread for `precio con envío?` (customer bubble right, agent bubble left, Pruebas internas collapsed).

## 2026-09-21 — Plan: AL2-A1 `/config/agentes` UX redo (Fable, docs only)

- Added `docs/plans/betsy-al2-a1-ux-redo-fable-2026-09-21.md` after Rafael rejected the shipped
  Atajos / Datos de la marca / Probar screens (#64) as engineer-facing and GO'd: paste-import
  "Cargar desde mis atajos" (AI extract → review checklist → Guardar), plain atajo list with eng
  keys / `sys_*` / `{{}}` behind Avanzado, Probar as a WhatsApp bubble thread with one Enviar and
  channel auto-select, Replay / fixtures / passRate / hash under collapsed Pruebas internas.
- 12 acceptance checkboxes (AT-1…AT-12) incl. the verify bar: three Preview screenshots
  (paste→facts, plain atajo, Probar bubble for "precio con envío?") readable dark-on-white.
- Out: Soft chrome, staff bot, SINPE queue / orders / Correos, image upload beyond disabled note,
  any schema change. Implementer model lock: grok-4.7 high fast only, never grok-4.5.
- Prove: docs only — `git diff --stat` = `docs/**`. PR stays draft; no merge without Rafael GO.

## 2026-09-21 — AL2-A1 agent text layer (SQL 029 proposed, not applied)

- Gated SQL `029_chat_agent_playbooks_assets.sql` + Prisma mirror. Not applied to shared Supabase.
- Payment classifier, brand facts, editable shortcuts, Canales allowlist (empty = nobody), isolated Probar sandbox, validator v2.
- Feature flag `chat_agent_layer_v1` still off by default. No Soft chrome redesign. No staff-bot mix.
- CoS apply notes live in `docs/audits/BETSY_V2_PROD_SQL_REVIEW.md` (029 block).

## 2026-09-21 — skill: verify-betsy

- Project-local verification skill `.cursor/skills/verify-betsy/` (pstack
  create-verification-skill shape): launch/doctor/drive/evidence/cleanup,
  Playwright helpers, and five Soft feature maps (agentes contrast,
  conocimiento in-page wizard, chats, social, ventas). Logistics omitted.
  Evidence directory gitignored.
- Prove on production (`BETSY_API_URL`, read-only): doctor `READY`, then
  `drive-agentes-contrast.mjs` PASS. Sections and Probar textarea computed
  `rgb(15, 23, 42)`. Abrir wizard kept path `/config/agentes` and the
  document sentinel. Screenshots in the skill `evidence/` folder.
- Isolated QA password (`betsy-preview` / `betsyv2.isolated@betsycrm.test`)
  was not injected here; doctor without it is `AUTH_BLOCKED`. This pass used
  the existing contrast QA user. No Probar click, no seed, no merge.

## 2026-09-21 — docs: Agent Layer Arc 2 plan (Fable, plan only)

- New plan `docs/plans/betsy-agent-layer-arc2-fable-2026-09-21.md`: Phases A–D
  (payment classifier + brand facts + shortcuts + Canales + multi-turn Probar;
  images + suggestion accept; SINPE `ChatPaymentIntent` queue in `/chats` +
  staff notification outbox; post-approve order draft into `/ventas`; horario +
  reply delay). Data deltas = gated SQL `029` / `030` (proposed, not written).
- 4 read-only scouts + Sol plan-mode review folded (12 MUST, 10 SHOULD; §9).
- Status board row added. No product code, SQL, flag or Supabase change.
- Prove: `git diff --stat` = `docs/**` only.

## 2026-09-21 — HOTFIX: agentes contrast + stop reload feel

- Contrast: route `!text-slate-900 [color-scheme:light]` + FIELD/TEXTAREA/
  SELECT with solid dark values (ThemeProvider dark was washing inputs).
- Reload feel (not true document reloads): `config/loading.tsx` full-viewport
  skeleton blanked every soft nav under `/config`; conocimiento cards used
  `router.push` remounts. Fix: empty `config/loading.tsx`; open conocimiento
  **in-page** on `/config/agentes` (local panel + shared wizard module); back
  via `Link`; config hub skips remount skeleton (`mounted` starts true).
- Soft chrome / staff bot untouched. Do not merge without Rafael OK.
- Prove: screenshots Probar + sections; click wizard/back without document
  navigation; `npm run build`.

## 2026-09-21 — HOTFIX: `/config/agentes` contrast / readability

- Root cause: ThemeProvider system dark set `body` near-white `text-foreground`
  while agentes pages force light surfaces (`bg-white` / slate-50) without
  explicit control colors → light-on-white inputs, Probar textarea/result,
  selects, and wizard fields.
- Fix: route `text-slate-900 [color-scheme:light]` + shared FIELD/TEXTAREA/
  SELECT classes (`text-slate-900`, readable placeholders, solid disabled).
  Bumped meta `text-slate-400` → `slate-600`. Silent `load({ silent })` after
  mutations so edits no longer flash “Cargando…”. Config hub “Abrir Agentes”
  uses `next/link` (cheap soft-nav). Soft chrome / staff bot untouched.
- Prove: screenshots of Probar + conocimiento; `npm run build`.

## 2026-09-21 — A2 Soft Agent knowledge (028 gated, flag off)

- Additive gated SQL `028_chat_agent_knowledge_actions.sql` (NOT applied live):
  `ChatKnowledgeSource`, `ChatAgentKnowledgeSource`, plus schema-only
  `ChatAgentSuggestion` / `ChatAgentPendingAction` for A3/A4.
- Prisma mirror + manifest entry `028` (not `DEFAULT_APPLY_FILES`).
- Knowledge CRUD + approve/reject APIs; bind sources to agents; OWNER/ADMIN
  (`update_config`) for mutations; audit after commit (no nested txn audit).
- Prompt layers 2–4 as data-not-instructions; `search_approved_knowledge` tool;
  monetary claims require `search_inventory` provenance; inventory over docs.
- Deterministic safety router: payment / media / opt-out before model call.
- Spanish paste-and-approve wizard `/config/agentes/conocimiento`; agentes
  checklist cards show live status (no more Pendiente A2 stubs).
- Soft chrome HOLD; staff bot untouched. Flag `chat_agent_layer_v1` still off.
- Prove: `npm run test:soft-ai-agent` (new `soft-ai-agent-knowledge-a2.test.ts`).

## 2026-09-21 — A1.5 Soft Agent introductionNames + agentes UI

- Additive gated SQL `027b_chat_agent_introduction_names.sql` (NOT applied live).
- `ChatAgent.introductionNames` text[] (1–3 presentation names); PATCH + audit after commit.
- Prompt identity layer after immutable safety; Forge seed defaults to `['Forge']`.
- `/config/agentes` readable sections (Identidad / Voz / Herramientas / Modo / Probar / Pánico)
  + A2 knowledge checklist UI only (Precios = inventario en vivo).
- Soft chrome HOLD; staff bot untouched. Flag `chat_agent_layer_v1` still off.
- Prove: `npm run test:soft-ai-agent`.

## 2026-09-21 — HOTFIX: agentes create P2028 + empty UI polish

- Root cause: `createChatAgent` / `updateChatAgent` nested `logAuditEvent` (global
  prisma) inside interactive `$transaction` → held open past 5s under Supabase
  latency → Prisma P2028 on POST `/api/chat/agents`.
- Fix: single-write create/update; audit **after** commit. `mapChatAgentAdminError`
  surfaces SCHEMA_NOT_READY / P2028 / name P2002 in Spanish. `/config/agentes`
  empty state + disabled-while-saving + API `error` field. Soft chrome HOLD.
- Prove: `npm run test:soft-ai-agent` (new `soft-ai-agent-admin-txn.test.ts`).

## 2026-09-21 — HOTFIX: Prisma out of browser client bundle (post-A1)

- Root cause: `'use client'` `/config/agentes` imported `hasSessionPermission` from
  `auth-helpers` → `auth-options` / `billing-access` → `db` → `PrismaClient`.
  Secondary: Soft `@/lib/soft-ai` barrel re-exported `composeEffectiveBehavior`
  from `agent-resolver` (Prisma) into Soft client chunks via commons.
- Fix: client-safe `session-permissions.ts`; agentes/social use it; Soft clients
  import `agent-state` / projection directly; drop resolver from Soft barrel;
  `server-only` on auth-helpers / agent-admin / agent-resolver / agent-inbox-enrich.
- Prove: `npm run test:soft-ai-agent` + production build client-chunk grep
  (no `@prisma/client` in agentes/Soft page chunks). Soft chrome HOLD (Rail
  untouched). Staff bot untouched.

## 2026-09-21 — A1 Soft Agent Layer runtime (027 gated, flag off)

- Additive `027_chat_agents.sql` + Prisma mirror + manifest (NOT applied live).
- Soft-only `src/lib/soft-ai/llm/**`, `agent-resolver`, `agent-claim-gates`, `agent-turn`,
  wired into Phase 4 `automation-processor` (legacy path when flag off).
- Flag `chat_agent_layer_v1` default off; Forge WA allowlist only; `aiFullUnlock` empty.
- `/config/agentes` Spanish UI (Probar, panic, audit); trust labels in SoftThreadPane/list.
- Soft chrome + staff bot paths untouched. Tests: `test:soft-ai-agent`.

## 2026-09-21 — Phase 4 scale bench numbers + seed fix + render ≤100

- Fixed `scripts/chat-scale-seed.ts` message index double-count across batches
  (duplicate `ChatMessage` PK on 50k seed).
- Local Postgres seed+bench: 5 accounts / 2k conversations / 50k messages;
  list p95 ~0.7 ms; changes idle p95 ~0.12 ms; indexes used (see
  `docs/audits/chat-phase4-scale-report.md`).
- `CHAT_INBOX_V2_THREAD_RENDER_WINDOW` tightened to **100** (acceptance 4.3).
- Acceptance 4.1–4.7 marked PASS in scale report (4.3–4.7 via code/unit + seed).
- Soft chrome + bot paths still untouched; 026 remains gated (not applied live).

## 2026-09-21 — Phase 4 template cache / poll consolidate / media / windowing

- `chat-template-cache.ts`: 300s per-WABA APPROVED templates (Upstash + memory);
  wired into `/api/chat/templates` + send APPROVED gate (acceptance 4.6).
- Poll: `CHAT_INBOX_V2_POLL_MS=5000`; SoftCopilotInboxV2 single scheduler +
  `inFlight` + pause on `document.hidden`; changes piggybacks `threadTail`
  (`threadId`/`threadAfter`); revision advances via `nextRevision` +
  `hasMoreChanges` (no jump to tenant max); initial list = first page +
  “Cargar más”; reconcile tick = one list page only (≤1 req/5s idle — 4.4).
- Thread window: fetch ≤50; store cap 300; render window 200; SoftThreadPane
  `data-testid="soft-thread-message"` + media via `/api/chat/media/[id]`.
- `chat-media.ts` + GET media route: Graph resolve → 10MB-capped download →
  private Blob `chat-media/{tenant}/{messageId}`; never persist Meta CDN URLs;
  write `mediaBlobPath` columns when present (026) else metadata fallback.
- Meta parser promotes `providerMediaId` / mime / filename; dual-write stores them.
- `chat-webhook-observability.ts` structured Done logs (`socialAccountId`,
  `durationMs`, `result`). Soft chrome + bot paths untouched.

## 2026-09-21 — Phase 4 Soft AI durable ChatAutomationJob queue

- Additive gated `026_chat_automation_jobs.sql`: `ChatAutomationJob` +
  `ChatAutomationDelivery` + optional `ChatMessage` media cache columns.
- Soft-only lease queue (`FOR UPDATE SKIP LOCKED`, 45s, per-conversation order)
  copying BotInbox algorithms without importing bot modules/tables.
- Webhook enqueues job after dual-write **before** 200; `void processJobById`
  best-effort; cron `/api/cron/chat-automation` (`*/1`) is safety net.
- Manifest registers 026; kept out of `DEFAULT_APPLY_FILES` (gated like 025).
- Soft chrome + `/api/bot/**` + `src/lib/bot/**` untouched.

## 2026-09-21 — Phase 4 scale tooling (seed / bench / burst / idle assert)

- Local-only load-test scripts gated on `CHAT_SCALE_DATABASE_URL` (loopback;
  refuse supabase hosts + pooler 6543). Never use shared `DATABASE_URL`.
- `scripts/chat-scale-seed.ts`: 5 SocialAccounts / 2000 ChatConversations /
  50000 ChatMessages (one 3000-msg thread); batched inserts; `--dry-run`.
- `scripts/chat-scale-benchmark.ts`: list LIMIT 30 + changes idle p50/p95,
  EXPLAIN (ANALYZE, BUFFERS) index asserts → `docs/audits/chat-phase4-scale-report.md`.
- `scripts/chat-webhook-burst.ts` + `tests/fixtures/chat-webhook/`: 500 signed
  events / 5 accounts unit-style (HMAC + parse + in-memory store).
- `scripts/chat-idle-network-assert.ts`: ≤1 req/5s budget vs `CHAT_INBOX_V2_POLL_MS`.
- npm: `chat:scale:seed` · `chat:scale:bench` · `chat:webhook:burst` · `test:chat-scale`.
- Soft chrome SoftSlimNav / SoftInboxBuckets / SoftCopilotRail untouched; `src/lib/bot/**` untouched.
- Bench numbers left **pending local postgres** in this Cloud Agent (no Docker).

# Agent Changelog

Append-only. Newest entries at the top.

## 2026-09-21 — PR-3 channel identity (names / logos / Connect naming)

- Persist WA/IG provider identity at connect (`exchange`, IG complete/callback shared upsert).
- Lazy Graph identity refresh on `GET /api/chat/accounts` (≤1/h via `tokenLastCheckedAt`).
- `PATCH /api/chat/accounts/:id { displayName }` (`update_config`); empty → provider default.
- `ChannelLogo` + wire SoftConversationList / SoftThreadPane / account filter / `/config/social`.
- Soft AI `canalContext` line `Canal: WhatsApp · {displayName}`; fallback never blank; IG numeric-id `@handle` bug fixed.
- Soft chrome SoftSlimNav / SoftInboxBuckets / SoftCopilotRail untouched; bot paths untouched.
- One-off: `scripts/chat-account-identity-backfill.ts` (dry-run default).

# Agent Changelog

Append-only. Newest entries at the top.

## 2026-09-21 — PR-2 Bugbot follow-up (send/echo + Soft AI + OAuth)

- Verified 6/6 #44 Bugbot notes against `origin/dev` `ed598fdd`. All real.
- HIGH send/echo (live, ungated): first dual-write now stamps Meta `providerMessageId`;
  identified echo-first duplicates finalize as success. Residual: 025 unique still unapplied.
- HIGH Soft AI worker escalate writes `ChatConversation.aiMode` before flag `agentState`.
- HIGH direct OAuth: same-origin `wa_direct_oauth` listener + 36008 launcher; dialog URL
  uses Embedded Signup `config_id` + coexistence extras. Code is not exchanged without
  FINISH phone/WABA assets.
- MED aggregates: preview/`lastMessageAt` only advance on newer `(sentAt, id)`; inbound
  and outbound maxima are independent. Counts still increment.
- MED v2 list follows `nextCursor` (flag still off). MED v2 template CTA POSTs `/api/chat/send`.
- Soft chrome and `/api/bot/**` untouched. 024/025 not applied. `chat_inbox_v2` stays off.
- Prove: focused write/soft-ai/oauth/v2 tests + `npm run test:chat-harden` (132 pass).
  Lint existing warnings only. Local `npm run build` pass.

## 2026-09-21 — PR-2 Respond.io write+read v2

- Dual-write ChatConversation + ChatMessage on webhook/send/soft-ai outbound
- Meta receipts: WA statuses + IG echo/delivery/read (monotonic deliveryStatus)
- Webhook HMAC-first; invalid signatures get dedicated IP limiter
- Hardened WA direct-oauth (`update_config` + CSRF state cookie/callback)
- Conversation API + SoftCopilotInbox v2 behind `chat_inbox_v2` (default off)
- Shipped gated `025_chat_inbox_uniques.sql` (NOT applied; not in default apply)
- Soft chrome SoftSlimNav / SoftInboxBuckets / SoftCopilotRail untouched; bot paths untouched

# Agent Changelog

Append-only. Newest entries at the top.

## 2026-09-21 — Respond.io PR-1: chat inbox schema foundation (024)

- Additive SQL `supabase/migrations/024_chat_inbox_conversations.sql`:
  `ChatConversation` + `ChatConversationReadState`, SocialAccount/ChatMessage
  nullable columns, revision sequence/trigger, non-unique indexes, RLS.
  **025 uniques not shipped.** SQL **not applied** to shared Supabase.
- `schema.prisma` mirror; apply/verify scripts extended via
  `scripts/lib/betsy-v2-additive-manifest.mjs` (018–024).
- Backfill/verify scripts: `scripts/chat-inbox-backfill.ts` (dry-run default),
  `scripts/chat-inbox-verify.ts`. Pure helpers:
  `src/lib/chat-conversation-foundation.ts`.
- Offline tests in `test:chat-harden`. Ledger entry in
  `BETSY_V2_PROD_SQL_REVIEW.md` (proposed). Staff bot + Soft chrome untouched.
- Prove: `npx tsx --test src/lib/__tests__/chat-conversation-foundation.test.ts
  src/lib/__tests__/chat-inbox-schema.test.ts` + `npm run test:chat-harden` +
  `npm run test:soft-meta-wait-iron` path via chat-harden + `npm run lint` +
  `npm run build`.

## 2026-09-20 — WA ownership verify: coexistence nested-field #100 soft path

- Prod Forge coexistence `POST /api/auth/whatsapp/exchange` 403ed after token +
  claimed phone/WABA because Graph rejected nested
  `whatsapp_business_account{id}` on the phone node (`(#100) nonexisting field`).
- `verifyWhatsAppAssetsForToken` now GETs safe phone fields only, then proves
  claimed WABA via `listWhatsAppPhoneNumbersForWaba` membership. Missing nested
  WABA field is no longer an ownership hard-fail; no claimed WABA still accepts
  phone ownership when resolve returns null after #100.
- Tests: `ig-wa-connect-security.test.ts` (Forge claimed-WABA success, #100 path,
  waba_mismatch). Added file to `npm run test:security`. Staff bot `/api/bot/**`
  untouched.
- Prove: `npx tsx --test src/lib/__tests__/ig-wa-connect-security.test.ts` +
  `npm run test:security` + `npm run test:chat-harden` + `npm run build`.

## 2026-09-20 — WhatsApp coexistence Embedded Signup (Business App numbers)

- Launch extras: `featureType: whatsapp_business_app_onboarding` + `sessionInfoVersion: 3`
  via `src/lib/whatsapp-embedded-signup.ts` and `/config/social` FB.login.
- Correlate FB.login code with `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` session
  postMessage; exchange resolves phone from WABA when Meta returns waba_id only.
- `subscribed_apps` now includes `history`, `smb_app_state_sync`, `smb_message_echoes`,
  `account_update`; coexistence onboard kicks SMB contacts/history sync within 24h.
- Webhook digests SMB echoes (outbound) + history (no Soft AI); PARTNER_REMOVED
  deactivates WABA-linked SocialAccounts.
- Docs: `META_CHAT_SETUP.md` store playbook; UI hint on `/config/social`.
- Prove: `npx tsx --test src/lib/__tests__/whatsapp-coexistence.test.ts` +
  `npm run test:chat-harden` + `npm run build`.

## 2026-09-11 — F37-03 Soft human composer after Pausar / Tomar control

- SoftThreadPane: unlock input/Enviar whenever agent mode is `paused` or `human`
  (incl. Soft DEMO — removed blanket `isDemo` disable).
- SoftCopilotInbox: DEMO human send appends locally (never Meta) after pause/takeover.
- Helper `isSoftHumanComposerEnabled`. Does not regress F37-01/F37-02.
- Prove: `npm run test:soft-ai` + build. Same draft #37.

## 2026-09-11 — F37-02 Soft AI server-truth pause/takeover (blocks Meta)

- SoftCopilotInbox: await `/api/chat/soft-ai/control` success **before** committing
  UI mode (DEMO stays localStorage-only).
- Inbound hook: `resolvePersistedAgentMode` — missing agentState/key is **not**
  `ai_active`; re-read mode immediately before Meta send; fail-closed if
  paused/human/missing. Control API persists `staffControlled` on agentState.
- Prove: `npm run test:soft-ai` (+ soft-ai-server-truth) + build. Same draft #37.

## 2026-09-11 — F37-01 Soft AI config PATCH exact orch RBAC stamp

- PATCH `/api/chat/soft-ai/config`: outer `update_config` + `decideSoftAiConfigPatch`:
  - `enabled:true` requires `update_config` (SALES/MANAGER view_config-only denied)
  - `paymentAlwaysHuman:false` fail-closed OWNER/ADMIN only
- Soft AI WA outbound `appsecret_proof` uses `purpose:'whatsapp'` (tiny). TOCTOU parked.
- Prove: `npm run test:soft-ai` + build. Same draft #37.

## 2026-09-11 — F37-01 Soft AI config PATCH RBAC (SecureDog WARN)

- `PATCH /api/chat/soft-ai/config` now requires `update_config` (OWNER/ADMIN only).
  SALES/MANAGER keep `view_config` but cannot enable Soft AI or flip
  `paymentAlwaysHuman` off. Flag still defaults off. Same draft PR #37.
- Prove: `npm run test:soft-ai` (+ soft-ai-config-rbac) + build.

## 2026-09-11 — Soft Tenant AI full package (monitor + tools + DEMO)

- Tenant AI worker (`src/lib/soft-ai/`): inbound → KB/config → tools → full reply.
  Feature flag `soft_tenant_ai_v1` (default off). Soft DEMO forces on client-side.
- Tools: create/link order, order status, Correos guía (DB or honest stub), tag,
  escalate_to_human. Payment/SINPE always-human via config skeleton.
- Soft UI shift (chrome language): monitor queue “IA manejando”, tool log rail,
  Take over / Pause / Resume AI — not suggest-first.
- APIs: `/api/chat/soft-ai/{run,config,control}`; webhook hooks Soft AI when flagged
  (never staff bot / no dual-router). No prisma push.
- Soft DEMO e2e without Meta: `runSoftDemoAiPass` + localStorage agent state.
- Prove: `npm run test:soft-ai` / `test:chat-harden` + build.

## 2026-09-11 — Rafael GO Soft 9.5 + multi-connect + WA APPROVED gate

- Soft 9.5 polish inside Soft chrome: empty states, sticky Resumen IA stub,
  rail ask hint, keyboard (⌘K / Esc / ↑↓ / Enter / `/`).
- Soft demo chats: localStorage seed clearly marked DEMO + removable; never
  writes ChatMessage / tenant production chat data.
- `/config/social` multi-connect: “Agregar otra/otro” copy + confirm when
  accounts already exist; upsert vs new-id explained.
- `POST /api/chat/send` server-side APPROVED/ACTIVE re-check via Graph
  `message_templates` before WA template send (`wa-template-approval.ts`).
- Hard locks: Soft chrome language only; `/api/bot/**` + staff `WHATSAPP_*` +
  `lib/bot/whatsapp` untouched; no dual-router; no prisma push.
- Prove: `npm run test:chat-harden` (+ soft-meta-wait-iron) + build.

## 2026-09-10 — Soft Copilot Phase 1 HARDEN

- Encrypt `SocialAccount.accessToken` via `encryption.ts` on all write paths
  (link, WA exchange, IG callback/complete); decrypt on send/subscribe/templates.
  Legacy plaintext passthrough until next write.
- Webhook Meta account resolve tenant-safe (`resolveWebhookSocialAccount`):
  refuse ambiguous multi-tenant `findMany`; IG page match by encoded refreshToken only.
- RBAC: `/chats` + GET accounts/messages/templates use `update_sales` (same as send).
- Rate limit: `chatWebhookRateLimit` (IP) + `chatSendRateLimit` (tenant:user).
- Soft thread “Cargar anteriores” via `nextCursor`/`hasMore` + recipientId filter.
- WA approved-templates picker MVP behind existing Soft CTA (`/api/chat/templates`).
- No Soft restyle; `/api/bot/**` and staff `WHATSAPP_*` untouched; no prisma push.
- Prove: `npm run test:chat-harden` + build.

## 2026-09-10 — CRM WA dedicated Meta app env + Soft Copilot UI

- CRM WhatsApp connect (exchange / link / subscribe / appsecret_proof / FB SDK)
  prefers `META_WA_APP_ID`, `NEXT_PUBLIC_META_WA_APP_ID`, `META_WA_APP_SECRET`
  with fallback to `META_APP_*`. Instagram stays on `META_APP_*`.
- `/api/chat/webhook` HMAC tries META_APP_SECRET, META_WA_APP_SECRET, then
  INSTAGRAM_APP_SECRET (deduped). No dual-router; staff bot `/api/bot/**` untouched.
- Soft Copilot `/chats` + Connect Soft UI (LOCKED Figma) in same fat PR.
- Docs: staff app vs CRM Inbox WA app; Vercel env list.
- Prove: meta-wa-app-env, meta-chat-webhook HMAC, chat-soft-copilot, chat-inbox tests.

## 2026-09-10 — Soft Copilot `/chats` + Connect UI (LOCKED Figma)

- Soft Copilot shell for customer inbox `/chats`: slim nav, inbox buckets,
  WA/IG/Todos chips, cuenta filter, unread badges, sync cue, yellow Resumen IA
  stub, composer Sugerir/Usar/Descartar stubs, right rail Detalle|Copilot,
  mobile list/thread + WA 24h closed CTA + empty states.
- Connect Soft Copilot on `/config/social`: multi IG/WA cards, Conectado only
  when subscribed/`isActive`, subscribe-fail toast, staff bot explicitly out;
  `GET /api/chat/accounts?includeInactive=1` for inactive/error rows.
- AI hooks are visual/heuristic stubs only — no AI engine. Staff bot
  (`/api/bot/**`) untouched. No dual-router / shared Meta callback.
- Prove: chat-soft-copilot + chat-inbox unit tests; lint/build.

## 2026-09-10 — PR-A: WA customer inbox connect = subscribed

- Soft-fail `subscribed_apps` removed from WA OAuth exchange + manual link:
  failures return `422` with Spanish copy; `SocialAccount.isActive` only when
  subscribe succeeds (token still saved inactive for Re-suscribir).
- Manual `/api/social/link` WhatsApp path Graph-verifies via
  `verifyWhatsAppAssetsForToken` (same as exchange). Re-suscribir activates
  `isActive` on success.
- UI (`/config/social`) never claims "conectado" unless subscribe succeeded;
  Embedded Signup postMessage no longer swallows errors.
- `DOCUMENTATION.md`: staff `WHATSAPP_*` + `/api/bot/whatsapp/webhook` labeled
  staff-only; customer inbox → `/api/chat/webhook`.
- Spanish Meta 24h/CSW send errors in `humanizeChatSendError`; WA parse unit
  tests in `meta-chat-webhook.test.ts`.
- Hard lock: staff bot routes / `WHATSAPP_*` untouched.
- Prove: `npx tsx --test` ig-wa-connect-security, meta-chat-webhook,
  chat-inbox; `npm run lint`; `npm run build`.

## 2026-09-10 — /chats live poll + send JSON harden

- `/chats` short-polls `/api/chat/messages` every 4s while the tab is visible
  (`visibilityState`); pauses when hidden; merges without clearing selection;
  fingerprint skip avoids list flicker.
- Send path no longer `alert()`s raw `res.json()` failures: `parseApiJson`
  detects HTML/`<!DOCTYPE` and shows Spanish inline errors.
- `/api/chat/send` always returns JSON; safe Meta response parse; 15s Meta
  fetch timeout (avoids hanging → HTML gateway pages); IG prefers
  `{pageId}/messages` when `refreshToken` encodes `page:`; Spanish error copy.
- Prove: `npx tsx --test src/lib/__tests__/chat-inbox.test.ts`, lint/build.

## 2026-09-10 — Chat webhook: dual Meta/Instagram HMAC secrets

- `verifyMetaWebhookSignature` tries `META_APP_SECRET` then distinct
  `INSTAGRAM_APP_SECRET` with timing-safe compare; returns
  `triedMeta` / `triedInstagram` / `matchedSecret`.
- Production 401 diagnostics include which secrets were attempted (never
  secret values / raw body / full signatures). Info log when Instagram
  fallback matches.
- Prove: `npx tsx --test src/lib/__tests__/meta-chat-webhook.test.ts`,
  `npm run build`.

## 2026-09-10 — Chat webhook: page-object IG + safe signature diagnostics

- Production signature failures on `/api/chat/webhook` now log safe diagnostics
  only (`signaturePresent`, `signaturePrefix`, `bodyLen`, `contentType`, `host`);
  still return 401 (auth not weakened).
- `parseMetaChatPayload` accepts Meta `object: page` messaging (platform stays
  `instagram`); prefers IG-shaped `recipient.id`, else `entry.id`, with
  `webhookObject`/`pageId` metadata.
- Store path falls back to active Instagram `SocialAccount` whose
  `refreshToken` encodes `page:<id>` when accountId lookup misses.
- Prove: `npx tsx --test src/lib/__tests__/meta-chat-webhook.test.ts`
  `src/lib/__tests__/meta-chat-config.test.ts`, `npm run build`.

## 2026-09-10 — IG connect: pages_read_engagement + me/accounts IG fields

- Added `pages_read_engagement` to `INSTAGRAM_OAUTH_SCOPES` so Graph can return
  Page `instagram_business_account` (fixes production #100 on page GET).
- `listFacebookPages` requests
  `instagram_business_account{id,username},connected_instagram_account{id,username}`
  on `me/accounts` and BM owned/client pages; `findInstagramBusinessOnPages`
  prefers embedded IG and only falls back to per-page GET when missing.
- Docs: `META_CHAT_SETUP.md`, `DOCUMENTATION.md` permissions table.
- Prove: `npx tsx --test src/lib/__tests__/meta-chat-config.test.ts`, `npm run build`.

## 2026-09-09 — SecureDog tip on IG+WA connect (#28)

- SD-01: `ig_connect_pending` cookie is opaque JWT (pendingId + page ids only);
  page access tokens live in encrypted Redis/memory server store.
- SD-02: WA `/exchange` Graph-verifies phone/WABA ownership before upsert/subscribe.
- SD-03/04: dropped `tokenPrefix` logs; IG `auth-url` requires session.
- Prove: `npx tsx --test src/lib/__tests__/ig-wa-connect-security.test.ts`
  `src/lib/__tests__/meta-chat-config.test.ts`, `npm run build`.

## 2026-09-09 — Respond.io-like IG + WA connect (CRM inbox)

- Instagram: Login for Business `config_id` via `NEXT_PUBLIC_IG_LOGIN_CONFIG_ID`;
  Business Manager page fallbacks when `me/accounts` is empty; multi-asset picker;
  Spanish empty-pages troubleshooting; safe page-count logs (no tokens).
- WhatsApp: single primary Embedded Signup CTA; manual link collapsed; store WABA
  on `SocialAccount.refreshToken` (`waba:`) and Page id for IG (`page:`).
- meta-status / readiness canonical origin defaults to the www production host
  and prefers `NEXTAUTH_URL`. Re-enabled `/chats` route so linked accounts appear.
- Prove: `npx tsx --test src/lib/__tests__/meta-chat-config.test.ts`, `npm run build`.

## 2026-09-03 — Producción Contra entrega toggle and grid windowing

- Added a **Contra entrega** toggle next to Masivas/Guías/Facturas/Exportar.
  On: Envíos (EA) and Retiros (RA) show only `contraEntrega === true`, including
  collected COD. Off: full catalog again. Server-driven path filters in
  `/api/production/orders` (`contraEntrega=1`); legacy stream filters client-side.
- Producción no longer mounts every loaded card. `ProductionOrderWindow` paints
  40 cards first, expands on scroll/click, and remote "Cargar más" stays explicit.
  Cards are memoized; BackupPage is a dynamic chunk.
- Prove: `npm run test:pagination`, `npx tsc --noEmit`, `npm run lint`.

## 2026-08-31 — Production Meta env audit (www, not apex)

- Probed live Production (www host) without printing secrets.
  `META_APP_ID` and both verify tokens are present; Instagram OAuth `client_id`
  is 1514613536240301 (Graph name BetsyCRM). Apex `betsycrm.com` 307s to www.
- Runbook now tells Meta to use `NEXTAUTH_URL` (www), not the apex, so webhook
  GET verify does not fail on the 307. `dashboard.betsycrm.com` does not resolve.
- Production Instagram Login still requests only `instagram_manage_messages`
  until this branch is on Production.

## 2026-08-31 — Betsy Chat Meta readiness + dedicated Notion board

- Canonical Meta inbox config in `src/lib/meta-chat-config.ts` (IG OAuth scopes, public URLs, env presence checks).
- Instagram Login now requests Page scopes (`pages_show_list`, `pages_manage_metadata`, `pages_messaging`, …) so `/me/accounts` in the callback can actually find the IG Business account.
- Owner diagnostic: `GET /api/chat/meta-status` + **Estado de Meta** card on `/config/social`. No secrets returned.
- Runbook `META_CHAT_SETUP.md` uses production `betsycrm.com` URLs and the two-webhook split (CRM inbox vs staff bot).
- Implementation board lives in Notion under the Betsy project (not the general Tasks board).

## 2026-08-30 — Remove Grok enhance bar from Ventas form

- Removed "Mejorar con Grok" from Nuevo pedido. Local paste-to-fill stays.
- Preview no longer synthesizes `ai_customer_paste_v2`. The enhance API
  remains flag-gated and off. No order data rewritten.
- Follow-up: dropped leftover `setAiPasteReviewPending` in `resetForm` that
  failed the production Vercel `next build`.

## 2026-08-30 — Preview v2 for real tenants; website pickup on new orders

- Preview / local `next dev` unlocks v2 for **every tenant** so reviewers can
  see Ventas/Producción/Estadísticas on real stores. Production still never
  synthesizes flags. DB flags stay off (production remains v1 after merge).
- Website intake accepts optional `orderType: "RA"` on **new** orders only.
  Existing payloads without the field stay Envío. No historical totals rewritten.
- Prove: review-environment, website-order-map, tenant-ui, lint. Do not merge
  `origin/dev` from the agent.

## 2026-08-30 — Production candidate: tenant-scoped Preview, flags off

- Preview v2 product flags unlock only when `VERCEL_ENV` is non-production
  **and** `tenantId === BETSY_V2_TEST_TENANT_ID`. Production never unlocks.
  The shared-DB banner stays env-only (`shouldShowPreviewDataWarning`).
- Ordinary store owners on a Vercel Preview keep production flag state.
- Removed `db:push:unsafe`. Verify script `--production-release` requires
  zero enabled `TenantFeatureFlag` rows. Gated disable script sets
  `enabled=false` only (no deletes, no order rewrites).
- Fixed duplicate `date-fns` import in `MobileOrderCard` that failed Vercel
  `next build`. No Prisma schema / `lm_*` / historical order changes.
- Prove: `npx tsx --test src/lib/__tests__/review-environment.test.ts`,
  `npm run test:tenant-ui`, `npm run test:correos-credentials`,
  `npm run test:lifecycle`, `npm run lint`, `npm run build` (127 routes).
  `npm run betsyv2:verify-production`: 8 v2 tables + RLS, 0 enabled flags,
  3647 orders unchanged. Do not merge `origin/dev` from the agent.

## 2026-08-30 — Preview QA: orders form, stats cobrado, copy

- Ventas: cantón/distrito commit on blur/Enter, keep distrito when still
  valid, show all validation errors with asterisks, scroll to the first
  invalid field, mensajería is required and visible for envíos, pickup no
  longer asks for street address, product Add explains why it stays grey.
- Ventas detail reuses the Producción editor so status/fields can change
  without hunting the card. `/pedidos` redirects to `/ventas`.
- Estadísticas: Pendiente without paid evidence is not cobrado. Customer
  activity labels are Spanish. Footer is v2. Buttons say Envío/Retiro.
- Website ingest parses `₡3.000` as 3000 and rejects invalid money before
  creating an order. Pickup from websites is still not supported (CRM only).
- Feedback FAB no longer covers Ventas table actions; Comentarios lives in
  the shell/nav. Did not merge, did not touch ORDER-1788038329933.
- Prove: `npx tsx --test src/lib/__tests__/crc-money.test.ts
  src/lib/__tests__/order-payment-status.test.ts
  src/lib/__tests__/order-form-validation.test.ts`, `npm run test:tenant-ui`,
  `npm run test:bot-grok`, `npx tsc --noEmit`.

## 2026-08-29 — Preview unlock and Vercel build repair

- Preview (`VERCEL_ENV=preview`) and local `next dev` synthesize Betsy v2
  product flags in code. No TenantFeatureFlag rows are written. Production
  stays flag-gated. Billing remains observe-only on preview.
- Tenant guías claim one in-flight generate per order. 401/403 surfaces as
  “Correos rechazó las credenciales” instead of generic Fallida.
- Fixed `customFields-server.ts` Prisma `optionSet: null` typing that failed
  `next build`. Ventas hook dependency warnings addressed.
- Dual client APIs and “Sincronizar desde Ventas” remain quarantined; no knip
  mass-delete.
- Prove: `npx tsc --noEmit`, `npm run test:correos-credentials`,
  `npm run test:lifecycle`, `npm run test:bot-inbox`. Do not merge `origin/dev`.

## 2026-08-29 — Tenant Correos guías use logistics credentials

- Tenant `/api/shipping/generate-guia` authenticated with stale `CORREOS_WS_*`
  env vars (401) while logistics succeeded with `lm_carrier_configs`.
- Shared resolver prefers a complete logistics DB set and never mixes
  username/password across sources. Token cache is fingerprinted so rotations
  cannot reuse a token.
- DialogContent opts out of the missing-Description warning.
- Prove: `npm run test:correos-credentials`. Do not merge `origin/dev` yet.

## 2026-08-29 — Isolated-tenant local verification

- Tenant E2E now pins `BETSY_V2_TEST_TENANT_ID`, asserts `/api/auth/me` +
  `allTenantIds`, and creates an RA pickup, status change, and archive.
- Client backfill `--apply` writes `clientBackfillCompletedAt` and does not
  auto-enable the flag. UI Playwright covers `/auth/signin` → `/ventas` /
  `/produccion`.
- Read-only `scripts/verify-betsy-v2-additive-sql.mjs` re-checks 018–023
  catalog, RLS, and that no other tenant has v2 flags. Do not re-apply SQL.
- `/produccion` crashed in the browser because `OrderDetail` imported Prisma via
  `customFields.ts`. Server fetch moved to `customFields-server.ts`.
- Prove: `npm run test:lifecycle`, `npm run test:e2e:tenant`,
  `npm run test:bot-grok`, verify script. Stay off `origin/dev`.

## 2026-08-29 — Isolated Betsy v2 test tenant

- Did not use `peter@peter.com` (super-admin + logistics-admin, two tenants).
- Created isolated OWNER `betsyv2.isolated@betsycrm.test` /
  tenant `cmteijij70000jsoyedmtfnl1` (`betsyv2-isolated-test`).
- Not super-admin, not logistics-admin, not in `lm_tenant_links`, no Tilopay,
  no flags, 0 orders. Peter rows were not modified.

## 2026-08-29 — Betsy v2 additive SQL review (018–023)

- Pinned `codex/betsyv2-review` @ `9943fe5` (ancestor `5ea4377`). Read-only
  catalog on shared Supabase: ~3640 orders / ~7MB, no v2 objects present.
- Hardened 018–023 with the existing Prisma RLS pattern (`service_role` only)
  so new public tables are not Data-API readable via default `anon` grants.
- Gated apply script `scripts/apply-betsy-v2-additive-sql.mjs` (host confirm,
  no Prisma). Flags stay off. Isolated test tenant created separately.
- Prove: SQL static tests + apply postconditions. No `origin/dev` push.

## 2026-08-27 — Logistics archive shows terminated orders

- Tablero de Envíos Archivo listed 0 finished orders even though ~2.4k
  `lm_orders` rows have `archived_at`. `GET /api/logistics/orders?archived=true`
  flattened `{ in: managedIds }` incorrectly (`[{ in: [...] }]` instead of the
  id list), so the tenant `ANY()` prefilter failed closed and the UI treated
  errors as an empty archive. Archive now joins `lm_orders` to `"Order"`,
  unwraps managed tenant ids for SQL, sorts by `archived_at`, skips the
  live-board cutoff, and returns a real total. The panel shows
  phone/location/product/date, errors instead of a fake empty state, and
  scrolls at a usable height.
- Prove: `npm run test:logistics-archive`. No `lm_*` schema changes.

## 2026-08-24 — Payroll Sunday double-count (CR day bounds)

- Confirmed: consecutive Mon–Sun payroll weeks both included Sunday
  afternoon clock-ins (Lau + Marlenn 2026-08-16, 301 paid minutes / CRC 6 271)
  because `date AT TIME ZONE 'America/Costa_Rica'` on PG 17/UTC returns
  `timestamp without time zone` (week start at Sunday noon CR) while the
  exclusive end bound stayed at Monday 00:00 CR.
- Fix: filter with `timestamp AT TIME ZONE` (true CR midnight). Shared helper
  `src/lib/costa-rica-clock-range.ts` used by workforce payroll, time-entries,
  and finance payroll.
- Prove: `npm run test:payroll-bounds`. Consecutive weeks 10–16 and 17–23 Aug
  2026 now intersect to zero IDs. Same CR midnight bounds now used by
  finance costs, logistics reports, private delivery, and retiros KPIs so
  Sunday afternoon cannot leak into the next period anywhere we filter
  timestamptz by calendar day.

## 2026-08-19 — Site-wide load-time performance slice

- Stopped `ConfigProvider` from fetching 6 config APIs on every authenticated
  route; ventas/producción/config load only what they need, with a 5-minute
  memory cache. Tenant settings and billing banner share the same cache pattern.
- NextAuth `SessionProvider` no longer refetches on window focus.
- Logistics `/orders` GET: bounded limit, tenant-scoped lm prefilter, parallel
  enrichment, no `ALTER TABLE` on GET, dropped `productDetails`/`customFields`
  from the list payload. Dashboard search is debounced; carriers/accounting
  caps reduced; reports poll every 5 minutes when the tab is visible.
- Dashboard stats, estadísticas summary/type/status/top-customers run independent
  reads concurrently. Estadísticas no longer duplicate summary/type/status for
  the day report; order-details is paginated. Recharts is `next/dynamic`.
- Production lazy-loads Guia/Invoice/Kanban. Route `loading.tsx` files use
  skeletons. `optimizePackageImports` for lucide/date-fns/recharts/framer-motion.
  Logistics Inter via `next/font`. No schema or `lm_*` changes.

## 2026-08-18 — Finance API extra keys for DeepClean / Forge

- Bitácora (adsadder) reads `brand=all` via extra top-level keys
  (`deepclean`, `forge`) in addition to `brands[]`. Missing keys show
  "Pendiente de Betsy" instead of ₡0.
- `/costs` and `/facturacion` now emit those keys, plus `dateFrom`/`dateTo`.
- `/meta` now includes `brandSlugs`. Finance cost/facturación maxDuration 60s.

## 2026-08-18 — Finance API: DeepClean + Forge brands

- Extended `FINANCE_TENANTS` with `deepclean` (`cmln5u7k70000ld042qify2og`) and
  `forge` (`cmsrgct420000vipcp3xyqb0m`). `/meta`, `/costs`, `/facturacion`, and
  `/orders` now accept all four slugs; payroll stays global.
- Order classifier v1.1.0: DeepClean and Forge are 1:1 tenant=business (like Bloom).
  DeepSleep sub-business rules unchanged.


- 1 Dopa + 1 Stress was collapsing to one line and deducting 2 of the same SKU.
- Product strings/details now split into separate lines. Generic Parche ×2
  explodes into per-unit pickers. Allocations are stored per order/slot so
  each unit can point at a different Laura SKU.
- Unique named products can still seed a global alias. Generic labels like
  Parche never do, so mixed future orders stay independently mappable.
- Fuzzy match is unique-only (ambiguous “Pura S” stays unmapped). Confirm
  rejects Laura pickups whose mapped qty does not cover the order.

## 2026-08-14 — Laura inventory product mapping

- Retiros could warn “sin mapear · Laura” but had no way to assign a sales
  label (e.g. Parche) to a Laura SKU, so confirmation stayed blocked.
- Added `POST /api/logistics/retiros/aliases` (logistics-admin, RA-only, Laura
  namespace hardcoded). Identical maps are idempotent; remaps need `overwrite`.
- Inline SKU picker on the retiro detail and Laura confirmation wizard. Marlenn
  still confirms without mapping or stock deduction.

## 2026-08-13 — WhatsApp/Telegram bot → xAI Responses API + Grok 4.6

- Default model is `grok-4.6` (`XAI_MODEL` still overrides). Reasoning stays `low`
  so WhatsApp's 15s timeout is not blown by the 4.6 high default.
- Agent chat and order extraction now call `/v1/responses` instead of Chat
  Completions. Tools use the flat Responses function shape.
- Privacy: every request is `store:false`. Tool follow-ups replay in-memory
  `response.output` (with encrypted reasoning) plus per-`call_id`
  `function_call_output`. No `previous_response_id` (that requires 30-day
  xAI retention). `prompt_cache_key` is HMAC'd so the WhatsApp phone is not
  sent as a cache key.
- Helpers live in `src/lib/bot/xai-responses.ts`; covered by `test:bot-grok`.

## 2026-08-13 — removed-assistant account recovery

- `forgecostarica04@gmail.com` was still an active Bloom ADMIN after "delete".
  Sign-in/register reused that User row and OAuth/JWT silently reactivated the
  old tenant. Bloom orders were not modified (still 473). Bloom OWNER
  (`bloomparchescr@gmail.com`) left intact. Forge Bloom membership was
  deactivated; a new owned tenant was created and renamed to Forge.
- Auth no longer reactivates inactive memberships on Google login or JWT
  refresh. Detached Google users get a new owned tenant. Removing a user
  clears/repoints `defaultTenantId`. Re-invite reactivates the inactive row.
- Added tenant `cmsrgct420000vipcp3xyqb0m` (Forge) to the logistics
  managed-tenant allowlist and centralized leftover hardcoded copies onto
  `src/lib/logistics-managed-tenants.ts`. Finance DeepSleep/Bloom allowlist
  was not changed.

## 2026-08-11 — cybersecurity review + safe hardening

- Full evidence-led security audit (auth, tenant isolation, Tilopay/billing,
  logistics, secrets/deps). PR description is the authoritative report.
- **Fixed (safe hardening):** invoice + other tenant models added to
  `TENANT_MODELS`; Tilopay webhook fail-closed + HMAC-only (no presence-only
  accept); callback no longer mutates plans; `/api/tilopay/auth` disabled;
  subscription cron always requires `CRON_SECRET`; invoice PDF HTML escape +
  session tenant; export `no-store` + CSV formula neutralization; backup Blob
  fails closed on public store; integration test 404 in prod; integration log
  PII redaction; logistics managed-tenant allowlist enforcement; OAuth/JWT reject
  inactive users; invite password strength; registration omits IDs; dep bumps
  `next@15.5.23`, `next-auth@4.24.15`, `@auth/core@0.41.3`, `axios@1.19.0`.
- **Documented only (product/risk):** membership auto-reactivation, ADMIN→OWNER
  role assignment, export/API-key/bulk RBAC tightening, OAuth account linking,
  WhatsApp OAuth state, CSP unsafe-inline, Tilopay HMAC algorithm confirmation
  with provider if production used presence-only hashes.

## 2026-08-03 — workforce clock reliability hardening

- Read-only production forensic check: one Lau employee, one valid open entry, no
  duplicate open entries, and `lm_time_entries_one_open_per_employee` is installed.
  The final code regeneration was followed by a successful clock-in six seconds later.
- Root cause confirmed: the older blank-clock-out row was voided (twice), so it was not
  a live open entry; the UI incorrectly displayed the contradictory `Open` / `Voided`
  state. Five code rotations in four minutes also invalidated the prior codes in sequence.
- Centralized time-entry state precedence (`voided` > `completed` > `open`); added an
  explicit audited Restore operation, blocked edits of voided rows, prevented restoring
  an open-shaped void when another live open entry exists, and made repeat Void a no-op.
- Serialized punch/admin mutations by locking the employee row. Clock-out uses guarded
  predicates plus the expected entry id; retries replay the original state without
  changing timestamps or duplicating audits.
- Worker UI binds punch actions to the validated code, clears stale identity state when
  the input changes, consumes the punch response directly, and uses Costa Rica display
  time. Lookup now distinguishes invalid credentials from operational 503 failures.
- Code rotation and audit are atomic and optimistic-versioned; the UI is single-flight.
  Added a production warning and deployment documentation for a stable
  `EMPLOYEE_CODE_SECRET` compatibility rollout.
- Split shared-IP lookup/punch limits (60/120 per 15 minutes) and removed the third
  post-punch lookup. Unignored the workforce schema migration so the critical partial
  unique index can be source-controlled.
- Prove: focused ESLint pass; workforce state, code, and datetime tests pass. Next debug
  build compiles the workforce changes, then fails on the pre-existing
  `@vercel/blob` `get` / `BlobAccessType` imports in `src/lib/backups/blob-store.ts`.

## 2026-07-31 — personnel time-clock timezone corrections (branch `cursor/fix-personnel-time-clock-472f`)

- Root cause: Time Clock admin corrections sent bare `datetime-local` strings; UTC server
  interpreted them as UTC, shifting Costa Rica wall times by 6 hours on save/reload.
- Added browser-safe `src/lib/workforce-datetime.ts` (CR display, datetime-local ↔ ISO).
- API `parseClockTimestamp` now requires explicit timezone; empty clock-out clears/reopens.
- PATCH void/correct + audit are atomic; punch in/out + audit likewise.
- Workforce UI: CR-formatted inputs/display, ISO submit, save guard, stale week fetch ignore,
  Next week advances from selected week; coverage actuals use CR slot bounds.
- Prove: `npm run test:workforce-datetime`, lint, build.

## 2026-07-30 — orphan purge (human OK: delete all except explicitly used)

- Deleted orphan routes: `/landing`, `/deployment`.
- Deleted orphan libs/templates: `correosAutomation.ts`, `auth.ts`, `instagram-oauth.ts`, `dom-protection.ts`, `integration-snippet.ts`, `bot/index.ts`.
- Deleted 8 legacy setup-wizard steps; produccion orphan pair; UI leftovers listed in Phase 0.
- Removed `@types/bcryptjs`; kept `sharp` and `/home`.
- Cleaned `/landing` refs in middleware, SubscriptionBanner, FeedbackWidget, DOCUMENTATION.
- Prove: lint pass, test:backups 8/8, test:bot-grok pass, build pass, knip unused files 0.

## 2026-07-30 — logistics mobile layout (branch `cursor/logistics-mobile-layout-cb22`)

- Fixed logistics shell on ≤768px: column flex + `100dvh`, main content no longer clipped by horizontal overflow.
- Replaced crowded horizontal mobile nav with compact header + accessible drawer (`LogisticsMobileNav`).
- Made Tablero de Envíos stack “Sin Asignar” above Kanban boards; swipeable columns; archive/verify forms wrap on narrow screens.
- Dashboard stats use 2 columns on mobile; loading shell no longer forces full viewport height inside main.

## 2026-07-30 — kickoff (branch `cursor/codebase-slim-agent-os-1e77`)

- Upgraded `.cursor/skills/executor-advisor-loop/SKILL.md` to Sol-orchestrated multi-agent loop (`gpt-5.6-sol-high`); parent dispatches parallel read-only scouts; serial deletes; safety gates.
- Added `.cursor/commands/codebase-audit.md`.
- Created `docs/audits/` ledgers (Phase 0, Phase 1, safety gates, this changelog).
- Added `knip` + `npm run audit:dead` (non-blocking).
- Removed stale `package.json` scripts pointing at missing files.
- Deleted `src/app/test-phase2`, `src/app/sentry-example-page`, `src/app/api/sentry-example-api`.
- Seeded quarantine: home/landing dup, deployment, external APIs, Tilopay/invoice/billing TODOs.
- Prove: `npm run lint` (pass, pre-existing warnings), `npm run test:backups` (8/8),
  `npm run test:bot-grok` (pass), `npm run audit:dead` (inventory only),
  `npm run build` (pass with `OPENAI_API_KEY` placeholder — import-time OpenAI client in
  WhatsApp webhook is a pre-existing env requirement at build collect time).
# 2026-08-26 — Betsy v2 Slice 1: security and safety

- Replaced first-membership tenant selection across billing, Tilopay, audit, and
  shared API tenant resolution with the active tenant selected by the session.
- Added missing Ventas dashboard RBAC; removed legacy MASTER-only UI gates from
  regular-tenant Clients, Inventory, and Shipping while retaining OWNER→MASTER
  authentication compatibility.
- Disabled destructive frequent-data seeding in production; invoice email and
  storage usage now report honest unavailable/unmeasured states.
- Restricted integration CORS to exact allowlisted origins and redacted request
  bodies, customer identity, addresses, API keys, and free-form metadata from logs.
- Retired direct client-side paid activation. Hosted checkout prices are server
  selected, provider correlation is persisted before redirect, webhook matching is
  fail-closed, and only verified payment events activate paid entitlements. FREE
  downgrade and cancellation are OWNER-only; cancellation must be provider-confirmed.
- Added an audited super-admin Enterprise offline-contract activation endpoint.
- Added `lm_retiro_order_allocations` to required backup coverage and its round-trip
  fixture without changing Logistics behavior.
- Prove: `npm run test:security` 14/14; `npm run test:backups` 8/8;
  `npm run test:bot-grok` pass; lint pass with existing warnings; TypeScript pass;
  production build pass; compiled server smoke returns 200 for `/` and sign-in,
  401 for unauthenticated `/api/auth/me`, and redirects protected Ventas to sign-in.

# 2026-08-27 — Betsy v2 Slice 2: DB-backed billing access

- Added a fresh-database ACTIVE/GRACE/RESTRICTED evaluator with staged
  observe/warn/enforce controls, exact seven-day windows, explicit approval, and a
  database global kill switch. The additive feature-flag SQL is source-controlled but
  was not executed; missing schema fails safe to observe-only.
- Applied the write guard through shared API auth and audited custom adapters,
  including imports, CE confirmation, status changes, invoice/guía operations, bot
  tools, social/config changes, and tenant-scoped user mutations. Removed stale JWT
  billing redirects and added a static route coverage suite.
- Kept OWNER checkout/create-plan-repeat reachable while restricted. Direct paid plan
  writes remain retired; provider retries cannot extend a stored grace window; the
  expiry cron starts/preserves grace and never changes the plan to FREE.
- Made FREE and paid orders unlimited across Ventas, website, import, bot, usage API,
  and billing UI. Website intake remains open with unique order idempotency, layered
  rate limits, and restricted-backlog marking. Routine observe/integration logs do not
  include order or customer content.
- Prove: security/coverage 68/68; `tsc --noEmit`; lint pass with existing warnings;
  production build pass; compiled local server smoke pass. No remote push, SQL,
  shared-database mutation, provider message, or charge.

# 2026-08-27 — Betsy v2 Slice 3: canonical order lifecycle

- Added a single tenant-gated, serializable lifecycle for all non-bot write adapters:
  Ventas, website, Excel, order update, production status, CE confirmation, and tenant
  guía generation. Activation is all-on/all-off and requires an acknowledged client
  backfill marker; bots stay legacy until Slice 5.
- Added nullable Order→Client linkage, normalized phone/email identity, provisional
  clients, a no-auto-merge conflict queue, durable adapter idempotency, and exact
  inventory allocation deltas. All schema is additive SQL and was not executed.
- Added a tenant-scoped client-link dry-run/apply package. Apply is double-gated by an
  exact tenant environment value and remains subject to separate approval.
- Corrected invoices to treat `Order.total` as gross and IVA-inclusive, versioned new
  calculations while leaving old rows still, and replaced fake email success with
  provider-confirmed Resend state.
- Consolidated regular-tenant guía APIs into the shared bounded generator, persisted
  delivery type and manual guía numbers, and removed the duplicate UI `Enviado` write.
- Prove: lifecycle 8/8; security/write coverage 69/69; TypeScript and lint pass (only
  existing warnings); production build and compiled unauthenticated smoke pass. No
  remote push, SQL, shared-database mutation, provider message, SOAP call, or charge.

# 2026-08-27 — Betsy v2 Slice 4: server-driven Producción and Clients

- Added dedicated, tenant-gated Producción metadata/list/summary APIs with signed,
  filter-bound keyset cursors and server-side search/type/date/courier/priority/status
  filtering. The legacy Ventas stream remains unchanged.
- Replaced Kanban drag-and-drop and silent first-100/20 slicing with independent
  per-column pages, `Sin configurar`, explicit status moves, idempotency, and stale-write
  compare-and-set protection.
- Added tenant-specific terminal-status classification SQL and a dry-run-first mapping
  tool. Unknown/unclassified work stays visible; 30-day terminal retention requires a
  complete, explicitly approved tenant mapping.
- Upgraded Clients in place with server pagination, filtered KPIs/facets/export, lazy
  `clientId`-only history, and a hard backfill-readiness gate.
- Tenant-keyed the configuration cache and rejected late responses after tenant
  switches without reopening the already scoped config request fan-out.
- Added a local Playwright production-build harness and explicit opt-in tenant suite.
- Prove: pagination contracts 8/8; security 69/69; lifecycle 8/8; backups 8/8; bot Grok,
  TypeScript, lint (existing warnings), production build (125 pages), and Playwright
  smoke 3/3 pass. Additive SQL was not run; no database/provider writes or remote push.

# 2026-08-27 — Betsy v2 Slice 5: durable bot inbox

- Added a Postgres-backed, persist-before-200 inbox for enabled WhatsApp and Telegram
  tenants. Batched Meta messages persist atomically. Claims use provider-ID
  deduplication, leases, per-conversation ordering, bounded retries, hard time budgets,
  a protected recovery cron, and terminal payload cleanup; no permanent server process
  is assumed.
- Added durable per-chunk/document outbound claims. Confirmed provider deliveries skip
  on retry; unresolved provider acceptance becomes a terminal reconciliation case
  instead of sending duplicate text or PDFs. Redis history claim+append is atomic and
  both user and assistant turns are operation-keyed.
- Kept bot writes all-on/all-off with the canonical lifecycle. The bot is enabled only
  when inbox, bot-lifecycle, and Slice 3 readiness flags all agree, and billing is read
  from the database immediately before every write.
- Replaced unlinked-session `MANAGER` authority with `BOT_OPERATOR`. Existing sessions
  are grandfather-safe without a destructive backfill; new unlinked sessions consume
  seats, observe/warn reports actual overage, and enforce blocks only new over-limit
  connections. Bot and dashboard membership create/reactivation use the same tenant
  lock.
- Added an explicitly confirmed, provider-idempotent factura tool with versioned
  IVA-included calculations and honest Resend state. Removed message, transcription,
  chat-ID, media-URL, and extracted-customer-content logs from the bot path.
- Added a stable per-order Correos side-effect claim for queued bot guías. Ambiguous
  provider results stop for reconciliation rather than retrying into a duplicate;
  queued manual guías are directed to Producción instead of the legacy direct writer.
- Corrected tenant feature-flag reads to use the schema's tenant-ID scope rather than a
  stale literal `tenant`, which otherwise made Slice 2–5 tenant flags impossible to
  activate.
- Prove: inbox 8/8; lifecycle 8/8; security 69/69; pagination 8/8; backups 8/8; bot
  Grok, TypeScript, lint (existing warnings), production build (125 pages), and
  Playwright smoke 3/3 pass. Additive SQL was not run; no database/provider writes or
  remote push.

# 2026-08-28 — Betsy v2 Slice 6: soft-delete and restore

- Added nullable Order archive metadata and an off-by-default tenant flag. Direct and
  bulk regular-tenant deletes retain the original row when enabled, while top-level
  active-order reads and legacy mutations reject archived rows.
- Bound every archive version to its exact audit event in the same serializable
  transaction. Restore requires OWNER, current DB billing access, the matching audit
  event, an exact `deletedAt` compare-and-set, and the 30-day window.
- Restore only unsets `deletedAt` on the retained Order and writes an atomic audit row.
  It never reconstructs from audit JSON and never replays invoice, guía, payment, or
  inventory side effects. Historical hard-deletes remain non-restorable.
- Added OWNER restore controls to Auditoría, fail-closed API coverage, the additive SQL
  package, and active-row filtering for the regular finance-cost raw query. Logistics
  behavior remains outside this slice.
- Prove: archive 6/6; security 70/70; lifecycle 8/8; pagination 8/8; inbox 8/8; backups
  8/8; bot Grok, TypeScript, lint (existing warnings), production build (125 pages),
  and Playwright smoke 3/3 pass. Additive SQL was not run; no database/provider writes
  or remote push.

# 2026-08-29 — Betsy v2 Slice 7: tenant setup, AI paste, and revenue observation

- Kept the existing customer paste heuristic as the immediate local parser and added an
  explicit, off-by-default Grok suggestion layer. Only customer fields leave the app;
  output is strict, non-writing, bounded, rate-limited, stale-text protected, and must be
  reviewed before Ventas can submit.
- Added additive tenant-persisted setup progress with optimistic revisions, optional
  skips, dismissal, restart-without-delete, safe regular-tenant return links, and legacy
  fallback when the flag/table is absent. Fixed Config's stale deep-link tab allowlist.
- Added one consolidated, bounded v2 statistics overview and observation UI separating
  booked gross, collected revenue, confirmed COD, and pending COD while leaving existing
  numbers and endpoints unchanged off-flag.
- Scoped visual cleanup to regular-tenant setup, Ventas AI review, and statistics cards;
  no Logistics file was changed.
- Prove: tenant UI 7/7; security 71/71; lifecycle 8/8; pagination 8/8; inbox 8/8;
  archive 6/6; backups 8/8; bot Grok; TypeScript; lint (existing warnings); production
  build (126 pages); Playwright smoke 3/3. No SQL, shared-data/provider write, remote push,
  or deployment.

# 2026-08-29 — Betsy v2 integrated release verification

- Fetched and locally merged `origin/dev` at `610f77c` after all seven slice commits.
  Preserved upstream performance, finance, payroll, and Logistics archive fixes while
  retaining v2 DB-backed billing display, tenant-keyed configuration, bounded statistics,
  and server Producción contracts.
- Fixed the Producción lazy-dialog merge import and enabled Next's isolated webpack
  build worker after the Windows in-process compiler terminated natively without a JS
  error. The clean production build then completed all 126 routes.
- Updated Playwright to serve the actual standalone artifact, including its static and
  public assets and local env, rather than relying on `next start` compatibility.
- Prove: TypeScript; lint (existing warnings); production build (126 routes); standalone
  Playwright 3/3; security 71/71; lifecycle 8/8; pagination 8/8; inbox 8/8; archive 6/6;
  tenant UI 7/7; backups 8/8; bot Grok; upstream payroll/finance; read-only Logistics
  archive regression. No SQL, shared-data/provider write, remote push, or deployment.

# 2026-09-21 — Betsy Agent Layer plan (A0, docs only)

- Added `docs/plans/betsy-agent-layer-fable-2026-09-21.md`: Fable 5.1 phased plan (A0–A5)
  to make Soft `/chats` agent-driven (Respond.io-style AI Agents) per Rafael GO 2026-09-21 CR
  — SocialAccount → ChatAgent binding with tenant default fallback (conversation override
  later), Forge WhatsApp sales agent pilot (`cmhsibjue0004js04gie724nx`), Grok 4.6 default
  model only (Rafael reconfirmed: no dual-model router in v1; cheap/hybrid is a one-line
  later-cost-control footnote, not a phase or acceptance requirement). Sol
  (`gpt-5.6-sol-high`) plan-mode review folded in (§9).
- Verified in code and recorded as gaps: `runSoftAiTurn` is a regex heuristic (no LLM);
  Soft direct Graph sender skips the WA 24 h window check; `ChatAutomationJob.payload` is
  nulled on completion (usage needs its own `ChatAgentTurn` table); history is filtered by
  metadata peer, not `conversationId`.
- Refreshed `docs/status/betsy-chats-respondio-2026-09-20.md` to tip `bd70517` (Phases 1–5
  LIVE; P4/P5 DONE) with a NEXT pointer to the Agent Layer plan; added a follow-on pointer
  in the Respond.io parity plan header.
- Prove: docs only — no product TypeScript, SQL, UI, flag, or Supabase change. Soft chrome,
  `src/lib/bot/**`, `src/app/api/bot/**` untouched (`git diff --stat` = `docs/**`).

# 2026-09-21 — Betsy Agent Layer plan amendment (Rafael GO; PR #53 ready)

- Rafael GO 2026-09-21 CR: folded ALL CoS + Advisor suggestions into
  `docs/plans/betsy-agent-layer-fable-2026-09-21.md`; §8 is now "decided" (18 items),
  no longer open. Locked defaults written in: Probar + panic pause + IA trust badges as
  A1 musts; `ChatAgentTurn.outputText` retention 90 days (metrics may stay longer);
  new agents default `operationMode=ai_suggest` until explicit upgrade; Forge WA
  allowlist id `cmuahn5y90001l504y6kksiek`; Grok 4.6 only; Soft HOLD; staff HARD LOCK.
- Advisor musts 1–8 written as A1 blockers: §2.5 pre-send gate table (human already
  replied → skip; per-conversation single-flight via partial unique index on
  `ChatAutomationJob(conversationId) WHERE status='processing'`; token health; 24 h
  window; `aiFullUnlock` hard gate), §2.7 operator surfaces (`/config/agentes` Spanish
  config + Probar + panic controls + Historial audit; inbox trust labels in data
  components only), §2.8 PII redaction + 90-day purge cron, §2.9 Forge fixture set and
  dark-run unlock; A1 acceptance tests 1.11–1.22.
- Should-adds written into A2–A5 (knowledge as data-not-instructions, media/comprobante
  → escalate, paste-and-approve wizard, plain-Spanish pending-action row, usage panel
  outcome mix, per-account subcap, extra injection fixtures, quiet hours, typing
  indicator, prompt Restaurar, stop-words, eval pack); same-person WA+IG identity parked
  in §7 roadmap. Added §3.5 fallback (fixes a dangling reference) and §9.1 traceability
  table. Status board NEXT updated. PR #53 marked ready for squash-merge; A1 next.
- Prove: docs only — `git diff --stat` = `docs/**`; no SQL, Prisma, or app code. Sol
  verification not run (Rafael: not required); Executor self-check of § refs and links.

# 2026-09-26 — Aurora PR-I: Estadísticas STAT-01 + Agentes detail (Conocimiento tab)

- `/estadisticas` now renders in `AuroraShell` (no classic top/bottom nav). New read-only,
  tenant-scoped `GET /api/estadisticas/aurora-summary?period=` (`view_statistics`); every
  number comes from Order / ChatConversation / SocialAccount / ChatAgentTurn queries or the
  existing `status-breakdown` endpoint. Chat→pedido, per-line Pedidos/Ventas and "Con
  intención de compra" have no data source and render "—" / "Sin datos". No brands.
- Agent detail lives in `/config?tab=agentes&agente=<id|slug>&seccion=<key>`; Conocimiento is a
  tab (completeness cards, inline Pegar → Revisar → Aprobar bound to the open agent, real
  Fuentes table). Crear agente = draft form → existing `POST /api/chat/agents`. Publicar
  cambios only flushes saves; it never touches `status`, so the runtime stays OFF.
- CoS fixes: no "Telegram" in the Plan list; mobile bottom nav stays visible under the global
  banner (`--app-top-offset`); Config panel clears the settings FAB; one cream canvas token;
  `/inicio` → `/dashboard` (307).
- Prove: `npm run test:stats-ui`, `test:agentes-ui`, `test:config-ui`; no schema / SQL / runtime files touched.

# 2026-09-26 — Aurora PR-J: rest of site (Pedidos detail/crear, modals, shell menus, auth/onboarding/help)

- **Pedidos:** detail drawer (`/ventas?pedido=`), Crear pedido drawer (`?nuevo=1`) around the existing
  `EnhancedSalesForm`, Canal column = the specific line (order → `ChatMessage.orderId` → `SocialAccount`,
  read-only `GET /api/orders/lines`), line filter. No schema change.
- **Chats → pedido (X2):** "Crear pedido" in a chat opens the same drawer; on success
  `POST /api/chat/order-link` sets `ChatMessage.orderId` (tenant-scoped, `update_sales`, idempotent,
  conditional `updateMany(orderId: null)`). Estadísticas Chat→pedido and per-line Pedidos/Ventas now read it.
- **Modals over existing flows:** Conectar línea (coexistence copy), Reconectar / Reparar, Desvincular, Invitar
  persona (`POST/PUT /api/users`), Aurora confirm dialogs. Embedded Signup / IG callbacks untouched.
- **Shell:** bell with derived alerts, profile menu, name-only tenant block, one `AuroraPageHeader`. No search
  field (no real search backend).
- **Auth (X1):** `safeReturnPath()` open-redirect guard on signin; middleware keeps the query in `callbackUrl`.
  Auth screens, onboarding wizard and Ayuda restyled to Aurora; logic untouched.
- **Global:** `tailwind.config.ts` `darkMode` is now a custom variant that never applies `dark:` inside `.aurora-light`.
- Prove: `npm run test:site-ui`, `test:security`, `test:pedidos-ui`, `test:stats-ui`, `test:config-ui`; no SQL / Prisma / runtime files touched.
