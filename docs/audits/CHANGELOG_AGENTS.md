# Agent Changelog

Append-only. Newest entries at the top.

## 2026-08-14 — mixed retiro lines map independently

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
