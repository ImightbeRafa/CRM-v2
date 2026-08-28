# Betsy v2 local release ledger

This ledger records the seven locally verified slices on `codex/betsyv2-local`.
No slice branch or integration branch is pushed. Database SQL and real-tenant
backfills require separate approval and are never applied by Prisma schema commands.

## Slice 1 — Security and safety

- **Local branch:** `codex/betsyv2-s1-security`
- **Schema dependency:** none.
- **Database writes used for verification:** none.
- **Verification:** security 14/14; backups 8/8; bot Grok pass; lint pass with
  pre-existing warnings; `tsc --noEmit` pass; production build pass; unauthenticated
  production-server smoke pass.
- **Known limitations:** real Tilopay calls, email delivery, and authenticated
  test-tenant workflows were not exercised because external charges/messages and
  shared-database writes are excluded from automated safety checks. Invoice email
  deliberately returns `email_not_sent` until Slice 3 adds real Resend state.
- **Rollback:** revert the Slice 1 commit. No database rollback is required.

## Slice 2 — Billing observe, warn, and enforce

- **Local branch:** `codex/betsyv2-s2-billing`.
- **Schema dependency:** additive `TenantFeatureFlag` table packaged in
  `supabase/migrations/018_betsy_v2_feature_flags.sql`. The SQL was **not**
  executed. A missing table deliberately means observe-only and cannot lock a tenant.
- **Database writes used for verification:** none. No flags, subscription rows,
  orders, clients, or backlog markers were changed.
- **Behavior:** every covered regular-tenant business mutation evaluates billing
  from current database state. JWT billing claims and page redirects are not
  authoritative. OWNER payment and provider webhook paths remain reachable;
  Logistics and system/provider endpoints are outside the regular-tenant guard and
  no super-admin/logistics-admin bypass exists on regular-tenant business APIs.
- **Rollout controls:** tenant flag plus a global enforcement switch; exact seven-day
  observe and warn windows; explicit approval timestamp; global switch off or missing
  returns all tenants to observe-only without deployment. Website intake is the only
  business-write exception and has idempotency, Upstash/per-instance attempt limiting,
  a durable successful-write cap, and restricted-backlog marking.
- **Verification:** security/coverage 68/68; `tsc --noEmit` pass; lint pass with
  pre-existing warnings; production build pass on Next/SWC 15.5.23; compiled server
  smoke: `/` 200, sign-in 200, unauthenticated billing access 401, and Ventas 307 to
  sign-in. The local dependency directory had stale Next/SWC 15.5.16 despite the
  lockfile requiring 15.5.23; `npm install` synchronized it without changing the lockfile.
- **Known limitations:** provider payment/failure callbacks, authenticated role flows,
  and test-tenant writes were not exercised because external charges and shared-DB
  mutation are excluded. Enforcement cannot be activated until the additive SQL is
  separately approved and applied. Email remains honest-unavailable until Slice 3.
- **Rollback:** turn off the global enforcement flag first, then revert the Slice 2
  commit if code rollback is needed. The additive table may remain; no down migration
  is required, and old code ignores it.

## Slice 3 — Canonical lifecycle and Clients linkage

- **Local branch:** `codex/betsyv2-s3-lifecycle`.
- **Schema dependency:** additive `Order.clientId`/lifecycle version, normalized and
  provisional Client identity, conflict queue, lifecycle idempotency ledger, exact
  inventory allocations, and versioned invoice/email state packaged in
  `supabase/migrations/019_betsy_v2_order_lifecycle.sql`. The SQL was **not** executed.
- **Database writes used for verification:** none. No dry-run script was pointed at the
  shared database because the additive schema is not approved/applied, and no test
  tenant identifier was guessed.
- **Activation:** one tenant flag (`order_lifecycle_v2`) controls Ventas, website,
  Excel, order update, production status, CE confirmation, and tenant guía writes as a
  complete set. The flag also requires `config.clientBackfillCompletedAt`; a bare flag
  cannot activate a legacy tenant. Missing flag/schema remains legacy/off. Bots remain
  on the old order lifecycle until Slice 5.
- **Behavior:** v2 create/update runs client resolution, order mutation, exact-match
  inventory deltas, statistics refresh, conflicts, and idempotency in a serializable
  transaction. Phone wins over email, identity disagreement creates a provisional
  client plus review conflict, and no records are auto-merged. Inventory never uses a
  fuzzy first match and repeated operations cannot decrement twice.
- **Backfill:** `npm run betsyv2:clients:backfill -- --tenant=<id>` is read-only by
  default. Apply requires both `--apply` and an exact matching
  `BETSY_V2_BACKFILL_APPROVED_TENANT`; real-tenant use remains separately approved.
- **Invoices and guías:** new invoices store v2 gross/IVA-included arithmetic while
  historical v1 rows/PDFs remain unchanged. Resend now records sending/sent/failed and
  returns provider-confirmed success only. Tenant guía routes share one bounded,
  concurrency-limited generator; delivery type and manual numbers persist, and only
  the server writes `Enviado`.
- **Verification:** lifecycle 8/8; security/write coverage 69/69; `tsc --noEmit` pass;
  lint pass with pre-existing warnings; production build pass (125 pages); compiled
  server smoke: `/` and sign-in 200, Ventas redirects to sign-in, billing access 401,
  website POST without API key 401, and manual guía POST without session 401.
- **Known limitations:** no shared-database schema or test-tenant mutation, Resend
  delivery, Correos SOAP request, authenticated adapter workflow, or real backfill was
  exercised. Those tests require the separately approved SQL and designated tenant /
  provider accounts. The old lifecycle remains active for every current tenant.
- **Rollback:** disable `order_lifecycle_v2` first, then revert the Slice 3 commit if
  needed. Additive columns/tables remain compatible with old code; no down migration is
  part of rollback.

## Slice 4 — Server-driven Producción and Clients

- **Local branch:** `codex/betsyv2-s4-server-pagination`.
- **Schema dependency:** additive tenant status-classification table and supporting
  Order/Client indexes packaged in `supabase/migrations/020_betsy_v2_server_pagination.sql`.
  The SQL was **not** executed. `schema.prisma` remains synchronized and only
  `prisma generate` ran.
- **Database writes used for verification:** none. The status-mapping package was not
  pointed at the shared database, no feature flags were changed, and the authenticated
  tenant Playwright suite was not run without an explicitly authorized test tenant.
- **Producción:** the v2 flag selects dedicated cursor-paginated, server-filtered list,
  summary, and per-column Kanban APIs. The legacy Ventas stream contract is unchanged.
  Kanban no longer drags partially loaded cards; each configured column plus
  `Sin configurar` loads independently and uses an explicit status action with
  expected-status/updated-time compare-and-set protection.
- **Terminal mapping:** classification is tenant-specific, exact, and read-only by
  default. Apply requires a complete mapping file plus an exact approved tenant value.
  Unknown statuses fail open and remain visible; open-plus-30-terminal-day filtering
  cannot activate until an approved mapping revision is recorded for that tenant.
- **Clients:** the existing management screen upgrades in place behind
  `clients_server_v2`, requires the lifecycle client-backfill marker, paginates and
  filters on the server, computes full filtered KPIs, and loads history strictly through
  `Order.clientId`. Filtered exports have explicit size limits instead of silent
  truncation.
- **Tenant switching:** configuration resource cache keys now include tenant ID and
  late responses from a previous tenant are ignored. The already path-scoped config
  loading remains path-scoped; this slice does not reintroduce the old six-request fan-out.
- **Playwright:** added a local production-build harness. The safe unauthenticated suite
  passed 3/3 (public render, protected-page redirects, and fail-closed new APIs/status
  mutation). The tenant suite requires explicit credentials and
  `BETSY_V2_TEST_WRITES_AUTHORIZED=1`; it cannot silently target a real tenant.
- **Verification:** pagination/query/security contracts 8/8; security/write coverage
  69/69; lifecycle 8/8; backups 8/8; bot Grok pass; TypeScript pass; lint pass with
  pre-existing warnings; production build pass (125 pages); compiled Playwright smoke
  3/3. No provider messages, charges, SQL, remote push, or shared-database mutation.
- **Known limitations:** authenticated pagination, client-history, stale-write, export,
  and status-mapping workflows require the separately approved additive SQL and a
  designated test tenant. Both v2 feature flags default off, so current tenants retain
  the legacy read paths after deployment until explicitly enabled.
- **Rollback:** disable `production_server_v2` and `clients_server_v2` first. Revert the
  Slice 4 commit only if a code rollback is needed. Additive indexes/table may remain;
  old code ignores them and no down migration is part of rollback.

## Slice 5 — Durable WhatsApp and Telegram inbox

- **Local branch:** `codex/betsyv2-s5-bot-inbox`.
- **Schema dependency:** additive durable inbox and outbound-delivery claims,
  bot-session seat metadata, and bot invoice idempotency key packaged in
  `supabase/migrations/021_betsy_v2_bot_inbox.sql`.
  The SQL was **not** executed. Existing bot rows are not rewritten: a null seat policy
  is interpreted as grandfathered, and the new code writes explicit policies only when
  a session is created or reconnected. `schema.prisma` is synchronized and only
  `prisma generate` ran.
- **Database/provider writes used for verification:** none. No feature flag, bot
  session, inbox message, invoice, order, client, inventory, or subscription row was
  changed; no Meta, Telegram, Resend, Tilopay, or Correos call was made.
- **Inbox behavior:** authenticated provider messages for an enabled tenant are stored
  before the webhook returns 200. Persistence failure returns 503. Provider IDs are
  durably unique, and every message in a batched Meta envelope is stored atomically
  before acknowledgement. Claims use leases plus `FOR UPDATE SKIP LOCKED`, and older
  messages in the same conversation block later claims. A protected Vercel cron is the
  recovery authority; post-response processing only reduces latency. Delivery and
  transient AI failures remain retryable, retries are bounded, and terminal/completed
  payloads are cleared, with old metadata purged after 30 days. A provider operation
  key atomically deduplicates both user and assistant history across retries. Each
  outbound text chunk and PDF is durably claimed before provider delivery; confirmed
  chunks are skipped on retry, while an unresolved provider result stops as an
  owner-reconciliation case rather than risking a duplicate customer message.
- **Activation:** `bot_inbox_v2` and `bot_lifecycle_v2` are separate tenant flags and
  both default off. Queued writes also require the complete Slice 3 lifecycle readiness
  marker. Enabling the inbox alone can exercise delivery/retry reliability but cannot
  write business data through the old lifecycle. The claimant checks the tenant-scoped
  inbox flag before every claim, so disabling it is an immediate stop control.
- **Billing, roles, and seats:** billing is re-read from the database immediately before
  each bot write. Unlinked sessions use `BOT_OPERATOR`, not `MANAGER`. Existing null/
  grandfathered sessions remain active and excluded from enforcement; new unlinked
  sessions are counted. Observe/warn records and exposes actual overage while enforce
  blocks only a new counted connection that would exceed the plan. Bot and dashboard
  member creation/reactivation and bot admission share one tenant lock, so they cannot
  race to claim the final seat.
- **Factura:** the bot tool requires an explicit current-message invoice request,
  confirmation, a durable provider operation key, and separate email intent. Invoice
  creation and Resend use stable idempotency keys; responses distinguish not requested,
  provider-confirmed sent, and failed delivery. Existing invoice PDFs remain unchanged.
- **Guías:** queued automatic Correos work uses the canonical bot lifecycle and a stable
  per-order external claim. Correos has no idempotency key, so an ambiguous timeout or
  crash stops for owner reconciliation instead of risking a second provider guía.
  Queued manual guía generation is intentionally directed to Producción; the legacy
  direct/manual path is never used by the v2 inbox.
- **PII handling:** routine logs contain hashed conversation references and counts, not
  message bodies, phones/chat IDs, transcription text, media URLs, customer fields, or
  access-code content. Raw authenticated payload is retained only while the durable
  message needs processing/retry and is cleared on completion or terminal failure.
- **Verification:** inbox contracts 8/8; lifecycle 8/8; security/write coverage 69/69;
  pagination contracts 8/8; backups 8/8; bot Grok pass; TypeScript pass; lint pass with
  pre-existing warnings; production build pass (125 pages); compiled Playwright smoke
  3/3, including fail-closed cron/provider checks. No remote push or shared-database
  mutation occurred.
- **Known limitations:** authenticated queue, provider-delivery, serverless-restart,
  seat-enforcement, and factura workflows require approved additive SQL, designated
  test accounts, and explicit tenant flags. An ambiguous Correos claim requires manual
  reconciliation before any new attempt. An outbound row left in `sending` or marked
  `ambiguous` also requires reconciliation; the system intentionally accepts a possible
  missing response rather than blindly duplicating a provider-accepted text or PDF.
- **Rollback:** disable `bot_lifecycle_v2` first, then `bot_inbox_v2`. Revert the Slice 5
  commit only if code rollback is required. The additive columns/table can remain and
  old code ignores them; no down migration is part of rollback.
