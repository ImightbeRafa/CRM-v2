# Agent Changelog

Append-only. Newest entries at the top.

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
