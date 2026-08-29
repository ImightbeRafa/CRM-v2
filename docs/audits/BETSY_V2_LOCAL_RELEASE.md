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

## Slice 6 — Soft-delete and conflict-safe restore

- **Local branch:** `codex/betsyv2-s6-soft-delete`.
- **Schema dependency:** nullable Order archive fields (`deletedAt`, `deletedBy`,
  `deleteReason`, and `archiveMetadata`) plus an active-row index are packaged in
  `supabase/migrations/022_betsy_v2_order_archive.sql`. The SQL was **not** executed.
  `schema.prisma` is synchronized and only `prisma generate` ran.
- **Database/provider writes used for verification:** none. No order, invoice, guía,
  payment, inventory, audit, flag, subscription, or logistics row was changed, and no
  external provider was called.
- **Activation and compatibility:** `soft_delete_restore_v2` defaults off per tenant.
  Existing delete behavior remains active while it is off. When enabled after the SQL
  is approved, direct and bulk regular-tenant order deletes archive the retained row;
  active Prisma reads and legacy mutations exclude archived orders. Explicit raw SQL
  remains caller-reviewed, and the regular finance-cost query includes the active-row
  predicate. Logistics behavior was not redesigned.
- **Restore contract:** restore is OWNER-only, rechecks current database billing access,
  and is available for exactly 30 days. The caller must supply the current `deletedAt`
  version, and the retained row is bound to the exact archive audit ID created in the
  same serializable transaction. Restore clears only `deletedAt` on that row and writes
  a new audit event atomically; it never rebuilds from audit JSON and never creates or
  updates invoices, guías, payments, inventory allocations, or other side effects.
- **Verification:** archive contracts 6/6; security/write coverage 70/70; lifecycle 8/8;
  pagination 8/8; durable inbox 8/8; backups 8/8; bot Grok pass; TypeScript pass; lint
  pass with pre-existing warnings; local production build pass (125 pages); compiled
  Playwright smoke 3/3, including unauthenticated restore fail-closed. No remote push,
  SQL execution, shared-database mutation, provider message, or charge occurred.
- **Known limitations:** an authenticated archive/restore workflow cannot be exercised
  until the additive SQL is separately approved and applied and a designated test
  tenant is explicitly authorized. Historical hard-deleted orders and pre-v2 audit
  rows remain intentionally non-restorable. A restore does not reverse or replay the
  original order's business side effects.
- **Rollback:** disable `soft_delete_restore_v2` first. Revert the Slice 6 commit only if
  a code rollback is required. The nullable columns/index may remain for backward
  compatibility; no down migration is part of rollback.

## Slice 7 — AI paste, setup, statistics, and regular-tenant UI

- **Local branch:** `codex/betsyv2-s7-tenant-ui`.
- **Schema dependency:** dedicated tenant setup-progress state is packaged in additive
  `supabase/migrations/023_betsy_v2_tenant_ui.sql`. The SQL was **not** executed.
  `schema.prisma` is synchronized and only `prisma generate` ran. Code deployed before
  the table and all three missing/off flags fall back to existing behavior.
- **Database/provider writes used for verification:** none. No setup progress, tenant
  flag, order, client, subscription, configuration, or Logistics row was changed. No
  xAI/Resend/Meta/Telegram/Tilopay/Correos request was made.
- **Customer paste:** the existing heuristic parser remains the immediate zero-network
  first layer. `ai_customer_paste_v2` only exposes an explicit Grok action. The request
  is limited to eight customer fields, uses strict JSON, `store:false`, zero retries,
  a hard timeout, and tenant/user rate limiting. It has no order/lifecycle/database
  write dependency. Changed fields are individually reviewable, and Ventas refuses to
  submit until the suggestion is applied or discarded.
- **Setup:** `setup_guide_v2` stores tenant-wide progress with an optimistic revision,
  supports visit/complete/optional skip/dismiss/restart, and never deletes real config.
  Return targets are limited to regular-tenant pages; Logistics and external targets
  are rejected. Dashboard dismissal is server-persisted when enabled, while legacy
  localStorage remains the off-path fallback. Config now honors the actual tab IDs in
  deep links, including inventory, clients, and shipping configuration.
- **Statistics:** `statistics_revenue_v2` selects one bounded, cached overview read in
  place of the legacy multi-endpoint client fan-out. Existing date/status semantics and
  booked totals remain still. Observation shows booked gross, non-COD booked, confirmed
  COD, pending COD, and collected revenue side by side. Because the current Order model
  has no collection timestamp, confirmed COD is explicitly attributed to its sale date.
  Legacy endpoints and UI remain unchanged while the flag is off.
- **Visual scope:** the visual pass is limited to regular-tenant setup, Ventas AI review,
  and statistics reconciliation cards, uses the existing theme tokens, and does not
  alter global styling or any Logistics page/API/role/billing behavior.
- **Verification:** tenant-UI contracts 7/7; security/write coverage 71/71; lifecycle
  8/8; pagination 8/8; durable inbox 8/8; archive 6/6; backups 8/8; bot Grok pass;
  TypeScript pass; lint pass with pre-existing warnings; local production build pass
  (126 pages); compiled Playwright smoke 3/3 including new unauthenticated endpoints.
  No remote push, SQL execution, shared-database mutation, provider message, or charge.
- **Known limitations:** authenticated AI, setup persistence, statistics reconciliation,
  and visual workflows require the separately approved additive SQL, a designated test
  tenant, and explicit tenant flags. Automated tests intentionally suppress real xAI and
  other provider calls. Statistics refuse ranges over 366 days or over 25,000 orders;
  detail payload is capped at 1,000 while aggregate totals remain complete.
- **Rollback:** disable `ai_customer_paste_v2`, `setup_guide_v2`, and
  `statistics_revenue_v2`. Revert the Slice 7 commit only if code rollback is required.
  The additive setup table may remain; old code ignores it and no down migration is part
  of rollback.

## Integrated release verification

- Latest `origin/dev` at `610f77c` was merged locally after Slice 7. Upstream performance,
  finance, payroll, and Logistics archive changes were retained; resolved overlaps keep
  v2 billing, tenant-cache, statistics, and Producción safety contracts.
- Final merged checks pass: TypeScript; lint with existing warnings; production build
  for 126 routes; standalone Playwright 3/3; all Betsy contract suites; backups; bot Grok;
  and upstream payroll/finance/Logistics archive regressions.
- The complete evidence, flags, SQL state, rollout order, and remaining approvals are in
  [BETSY_V2_RELEASE_REPORT.md](./BETSY_V2_RELEASE_REPORT.md).
- No SQL, real-tenant mutation, provider side effect, remote push, or deployment occurred.
