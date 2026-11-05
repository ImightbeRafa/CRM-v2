# Full codebase review — 2026-10-24

**Branch:** `claudio/full-review-2026-10-24` (from `claudio/wave-2026-10-22` @ `d32a112`, the production line)
**Scope:** security (auth/session, all `src/app/api/**` routes, webhooks, media, SSRF, raw SQL, client env, CSP, deps), dead code, performance.
**Method:**
- Four parallel read-only review passes (auth/admin routes, data routes, webhooks/integrations, performance).
- Each finding re-traced in the code before it went into this file. The High ones were also re-read by hand.
- Ran `npm audit --omit=dev` and `knip`; checked every knip "unused file" with grep.
- No database was touched, and no `prisma db push` / `prisma migrate` was run.

**Confidence:** H = path traced end to end; M = code is clear but real-world reach depends on deployment or data.
**Status:** `FIXED` (on this branch) · `PARTIAL` · `OPEN` (left for Rafael; needs design or a product decision) · `REPORT-ONLY` (staff bot: off-limits).

Earlier "document only" items re-checked:
- **Fixed since:** H3 (membership auto-reactivation), H4 (ADMIN → OWNER), M7 (WhatsApp OAuth state), M9 (integration CORS).
- **Still partly open:** H5 → AUTH-01 / AUTH-04; M6 → AUTH-06; M8 (CSP) → INFRA-03.

---

## Summary table (most severe first)

| Sev | ID | Title | Status |
|-----|----|-------|--------|
| High | DATA-01 | Real customer PII committed to git (`orders.xlsx`, `prisma/dev.db`) | PARTIAL (removed from tip; history purge open) |
| High | INT-01 | Manual Instagram link has no ownership proof, so a business can capture another business's DMs | FIXED |
| High | AUTH-01 | Any member (VIEWER included) can mint or revoke business-wide integration API keys | FIXED (permission); revoke-on-removal OPEN |
| High | DATA-02 | Logistics routes skip the managed-tenant allowlist: cross-tenant COD PII reads and `Order.status` writes by id | OPEN |
| Medium | AUTH-02 | Write routes with no role check (`POST /api/orders`, `/api/sales`, invoices); PRODUCTION can read sales PII | OPEN |
| Medium | AUTH-03 | `/api/logistics/carriers` GET returned the Correos WS password in plaintext | FIXED |
| Medium | AUTH-04 | VIEWER can bulk-export orders, sales and clients (`view_sales` instead of `export_sales`) | OPEN |
| Medium | AUTH-05 | SALES can overwrite inventory prices, costs and stock via Excel import | OPEN |
| Medium | AUTH-06 | Pre-registered email: attacker's password survives the victim's email verification and Google sign-in | OPEN |
| Medium | INFRA-01 | Meta / WhatsApp / Telegram webhooks accept unsigned requests when `NODE_ENV !== 'production'` | OPEN (staff-bot parts REPORT-ONLY) |
| Medium | INFRA-02 | `npm audit`: 14 high / 5 moderate in the prod dependency tree | OPEN |
| Medium | INFRA-03 | CSP still allows `'unsafe-inline'` and `'unsafe-eval'` for scripts (old M8) | OPEN |
| Medium | DB-01 | `getTenantPrisma` extension gaps: count/aggregate/groupBy with no `where`, createMany, `data.tenant`, about 30 models not listed | OPEN (latent) |
| Medium | DATA-03 | Dev-only `orders/fix-tenant` can move other tenants' orders; dev servers use the shared prod DB | OPEN |
| Low-Med | INT-02 | WhatsApp Embedded Signup returns the long-lived business token to the browser | OPEN |
| Low-Med | AUTH-07 | Any member can overwrite the business phone (`send-phone-otp`) | OPEN |
| Low | AUTH-08 | `/api/auth/*` routes skip the 60-second revocation re-check (up to 5 minutes stale) | OPEN |
| Low | DATA-04 | Logistics `generate-bulk` falls back to an order-number lookup across tenants | OPEN |
| Low | DATA-05 | Label and report PDFs were sent without `Cache-Control: no-store` | FIXED |
| Low | DATA-06 | Bulk-update audit lookup reads other tenants' names (global prisma) | OPEN |
| Low | DATA-07 | A product field can `connect` another tenant's option set | OPEN |
| Low | INFRA-04 | Four cron routes compare `CRON_SECRET` with `===` instead of `requireCronBearer` | OPEN |
| Low | INFRA-05 | `next.config.js` allowed an unused third-party image host through `/_next/image` | FIXED |
| Low | INT-03 | Meta `signed_request` has no `issued_at` freshness check (replay) | OPEN |
| Low | INT-04 | `integration/guia/generate` has no batch cap and no per-key rate limit | OPEN |
| Low | INT-05 | Staff-bot `telegram/set-webhook` reuses the webhook secret, falls back to NEXTAUTH_SECRET, and skips auth in dev | REPORT-ONLY |
| Info | INFO-01..06 | Error-message leak, invite oracle, `requireAdmin` MASTER bug, fail-open revocation, PII in logs, unlisted deps | OPEN / PARTIAL |
| Perf | PERF-01..09 | See the performance section | PERF-03 PARTIAL, others OPEN |

No Critical issue was found. Checks that came back clean: SQL injection in raw SQL (all `$n`-bound), Tilopay webhook authenticity, media tenant scoping, and SSRF guards.

---

## Security findings

### DATA-01 — High — Real customer PII committed to the repository — PARTIAL
- **Where:** `orders.xlsx` (repo root) and `prisma/dev.db`, both added in `efa9e65` (2026-08-29) even though `.gitignore:58` and `:107` exclude them.
- **Evidence:** counted only, no values printed.
  - `orders.xlsx` has sheets EA and RA with about 690 filled rows. Columns: Cliente, Teléfono, Correo, Provincia/Cantón/Distrito, Dirección; 687 rows have phone numbers.
  - `prisma/dev.db` is SQLite with 456 `Order` rows (customerName, phone, email, address) and one `User` row with a password hash.
- **Impact:**
  - Everyone with repo access (collaborators, CI, cloud agents, forks) holds this customer data.
  - If the repo is ever made public, this is a data-protection breach (Costa Rica Ley 8968).
  - The hash is a credential-cracking target if it matches a real password.
- **Fixed here:** `git rm` on both files. No code reads them; `scripts/import-orders-from-xlsx.js` takes the path as an argument.
- **Left for Rafael:**
  1. Purge both files from history (`git filter-repo --path orders.xlsx --path prisma/dev.db --invert-paths`), then force-push every branch and ask collaborators to re-clone.
  2. Rotate the password whose hash is in `dev.db` if it was ever real.
  3. Check that no fork or copy exists.
- **Confidence:** H.

### INT-01 — High — Instagram "manual link" lets one business capture another's DMs — FIXED
- **Where:** `src/app/api/social/link/route.ts`, the non-WhatsApp branch (old lines 173–210).
- **Evidence:** WhatsApp links are verified with Graph (`verifyWhatsAppAssetsForToken`). The `instagram` branch stored the client's `accountId` and `refreshToken` with `isActive: true` and no proof of ownership.
- **How webhooks route:** `resolveWebhookSocialAccount` (`src/lib/chat-webhook-account.ts`) matches `(platform, accountId)`, otherwise `refreshToken = 'page:<id>'`. `resolveInstagramAccountId` (`meta-chat.ts:396`) falls back to the Page id for `object: page` events.
- **Exploit:**
  1. Any self-registered OWNER links `{platform:'instagram', accountId:'<victim Page id>'}`. Page ids are public.
  2. The victim's customers' DMs then land in the attacker's inbox.
  3. Variants: a `page:` refreshToken makes the match ambiguous, so the message is dropped (DoS); squatting the victim's IG id before they connect blocks their OAuth connect.
- **Fix applied:** the route accepts `platform: 'whatsapp'` only. The only UI caller (`config/social/page.tsx:637`) already sends `whatsapp`; Instagram connects through OAuth (`/api/auth/instagram/*`), which proves ownership.
- **Follow-up for Rafael:** run a read-only check for `SocialAccount` rows with `platform='instagram'` that the OAuth flow did not create, e.g. a null `accessToken` or a `refreshToken` not written by OAuth.
- **Confidence:** H on the code path; M on how often `page`-source events occur.

### AUTH-01 — High — Any member can create or revoke integration API keys — FIXED (permission) / OPEN (lifecycle)
- **Where:** `src/app/api/config/api-keys/route.ts` (GET, POST) and `api-keys/[id]/route.ts` (DELETE) used `authenticateAPI` only.
- **Impact:**
  - A VIEWER or PRODUCTION member could mint a `bts_…` key.
  - That key can create orders and paid Correos guías through `/api/integration/*`, has no expiry, and keeps working after the member is removed.
  - Any member could also revoke the owner's keys.
- **Fix applied:** `authenticateAPIWithPermission(req, 'update_config')`, so only OWNER and ADMIN. The UI (`IntegrationsPanel`) already handles a non-OK response.
- **Open:** store `createdByUserId` and revoke or flag keys when that membership ends; consider an expiry.
- **Confidence:** H.

### DATA-02 — High — Logistics routes skip the managed-tenant allowlist — OPEN
- **Where:**
  - `src/app/api/logistics/contra-entrega/route.ts:46-91` (GET) and `:144` (POST).
  - `logistics/sync-crm-status/route.ts:31` and `logistics/bulk-patch/route.ts:44,121`, which call `src/lib/logistics-crm-sync.ts:56`: `db.order.updateMany({ where: { id: { in: ids } } })` with no tenant filter.
  - `logistics/correos-costs/route.ts:22`.
  - Also: `billing-weeks` (+ revert), `orders/terminate`, `orders/return-to-pending`, `guias/download/[id]`, `guias/download-bulk`, `guias/generate-bulk`, `order-events`, `retiros/*`.
  - Only 8 of the 27 logistics route groups reference `MANAGED_TENANT_IDS` / `resolveManagedTenantFilter`.
- **Evidence:** contra-entrega does `FROM "Order" o LEFT JOIN lm_orders … WHERE (lm.is_contra_entrega OR o."contraEntrega")`. Its optional `tenantId` param is never checked against the allowlist, so it returns customerName, phone, total and province of COD orders for every tenant.
- **Who can reach it:** a logistics operator (`guardLogisticsApi` = platform logistics admin + DeepSleep membership). These are internal staff, so this is not reachable by an ordinary tenant user. Per the review rules, a multi-tenant write by id with no tenant filter is High.
- **Impact:** an operator account (or a stolen operator session) can read PII of, and change CRM order statuses for, tenants outside the 9 managed brands.
- **Fix (needs a coordinated pass):**
  - Add `o."tenantId" = ANY($n::text[])` bound to `MANAGED_TENANT_IDS` in each logistics query.
  - Pass every `tenantId` param through `resolveManagedTenantFilter`.
  - Add `tenantId: { in: MANAGED_TENANT_IDS }` to `syncLogisticsStatusToCrmOrders`.
  - Left open because it changes many raw-SQL logistics queries on `lm_*` tables that are not in Prisma, and operator workflows must be re-tested.
- **Confidence:** H.

### AUTH-02 — Medium — Write and PII-read routes with no role check — OPEN
- **Where:**
  - `src/app/api/orders/route.ts:276` (POST) and `src/app/api/sales/route.ts:43` (POST).
  - `src/app/api/invoices/generate/route.ts:13` and `invoices/bulk-generate/route.ts:14`: `authenticateAPI` only.
  - `rbac.apiPermissions` (e.g. `'POST /api/orders': 'create_sales'`) is never enforced; `canAccessAPI` is called only from tests.
  - Read side: PRODUCTION (no `view_sales`) can read `GET /api/orders`, `/api/sales`, `/api/invoices` and `invoices/[id]/pdf`. The `estadisticas` summary, revenue, order-details, type-breakdown and status-breakdown routes have no `view_statistics` check.
- **Fix:** `authenticateAPIWithPermission` with `create_sales`, `view_sales` or `view_statistics`. Left open because the staff bot, website integration and production screens may rely on these routes; the role matrix needs Rafael's sign-off.
- **Confidence:** H.

### AUTH-03 — Medium — Correos WS password returned by `/api/logistics/carriers` — FIXED
- **Where:** the GET did `SELECT id, carrier, key, value … FROM lm_carrier_configs`. `correos-config` stores `correos_ws_password` in that table and masks it in its own GET.
- **Fix applied:**
  - Values whose key matches `password|secret|token` are returned as `••••••••`, plus `Cache-Control: private, no-store`.
  - No UI calls this GET. POST/DELETE are unchanged.
- **Confidence:** H.

### AUTH-04 — Medium — VIEWER can bulk-export orders, sales and clients — OPEN
- **Where:** `src/app/api/exports/{sales,orders,clients}/route.ts` check `view_sales`, which VIEWER has. The `export_sales` permission exists but is unused. `exports/database` was already fixed (it requires `export_tenant_data`).
- **Fix:** require `export_sales`. This is a product decision on whether VIEWER should export.
- **Confidence:** H.

### AUTH-05 — Medium — SALES can overwrite the inventory catalog via import — OPEN
- **Where:** `src/app/api/import/excel/route.ts:285` requires only `create_sales`. `importInventory` (`:222-258`) upserts `sellingPrice`, `unitCost` and `currentStock`. The direct inventory routes require `update_config`.
- **Fix:** also require `update_config` when `importType` is inventory or products.
- **Confidence:** H.

### AUTH-06 — Medium — Pre-registration account persistence (rest of M6 / AUTH-08) — OPEN
- **Where:**
  - `auth-options.ts:367` drops the password and revokes sessions on first Google sign-in only when `!dbUser.emailVerified`.
  - `src/app/api/auth/verify-email/route.ts:150` sets `emailVerified` without bumping `sessionVersion` or clearing a password that was set before verification.
- **Exploit:**
  1. The attacker registers `victim@…` with their own password.
  2. The victim clicks the verification email.
  3. The victim later uses Google.
  4. The attacker's password and session still work.
- **Fix (needs design):** on verification of an account whose password predates proof of the mailbox, clear the password or bump `sessionVersion`, and require a reset.
- **Confidence:** M (needs the victim to click the link).

### INFRA-01 — Medium — Webhooks accept unsigned payloads outside production — OPEN
- **Where:**
  - `src/app/api/chat/webhook/route.ts:312-333`: an invalid signature returns 401 only `if (NODE_ENV === 'production')`, otherwise processing continues.
  - Staff bot (report-only): `src/app/api/bot/whatsapp/webhook/route.ts:151-165` and `bot/telegram/webhook/route.ts:120-125`.
- **Impact:** per AGENTS.md, dev and cloud-agent servers run against the shared production Supabase. A dev server reachable from outside (tunnel or port-forward) would accept a forged `whatsapp_business_account` payload. That inserts messages into any business's inbox and queues Soft AI replies sent with that business's real Meta token.
- **Fix:** reject invalid signatures in every environment unless an explicit `ALLOW_UNSIGNED_WEBHOOKS=1` is set and the DB host is loopback. Left open because this touches the WhatsApp chat webhook; the staff-bot routes are off-limits.
- **Confidence:** H on the code; exposure depends on how dev servers are run.

### INFRA-02 — Medium — Dependency advisories (`npm audit --omit=dev`) — OPEN
19 advisories: 14 high, 5 moderate.

| Package | Path | Reachability | Suggested fix |
|---|---|---|---|
| `zod` <4.6.6 (GHSA-mrhx-c7xc-m3w5, memory exhaustion on oversized constrained collections) | direct `zod@3.23.8` | Request validation; a large array body can exhaust memory. Medium | Cap body size before parsing; plan the zod v4 upgrade (breaking) |
| `ip-address` ≤10.7.3, `basic-ftp` ≤6.2.0, `extract-zip` | `puppeteer(-core)` → `@puppeteer/browsers` → proxy-agent / extract-zip | Only used when downloading browsers or going through a PAC/SOCKS proxy; not on a request path. Low | Bump `puppeteer` / `puppeteer-core` once fixed versions exist, or add `overrides` |
| `postcss` ≤8.5.22 | `overrides.postcss = 8.5.14` in `package.json` pins a vulnerable version | Build time only. Low | Raise the override to the latest 8.5.x |
| `brace-expansion`, `source-map-js` | build tooling | Build time. Low | `npm audit fix` (non-breaking) in a lockfile-only PR |
| `uuid` <11.1.1 | `exceljs`, `svix` (via `resend`) | Buffer-API only, which these callers don't use. Low | Wait for upstream; the app's own `uuid` import was removed here |

Not changed on this branch: lockfile changes need their own build-and-test cycle.

### INFRA-03 — Medium — CSP allows `'unsafe-inline'` and `'unsafe-eval'` (old M8) — OPEN
- **Where:** `next.config.js` `script-src`.
- **Impact:** any HTML injection becomes script execution. INT-02 makes this worse, because a business token sits in JS memory.
- **Fix:** nonce-based CSP via middleware (Next 15 supports it), then drop `unsafe-eval`. Tilopay, Facebook SDK and Turnstile need testing.
- **Confidence:** H.

### DB-01 — Medium (latent) — `getTenantPrisma` extension gaps — OPEN
- **Where:** `src/lib/prisma-tenant.ts`.
  - **No-`where` calls:** `count`, `aggregate` and `groupBy` fall into `default:` (`:235`), which adds the tenant filter only `if (modifiedArgs.where)`.
  - **`createMany`:** no tenantId is injected.
  - **`create` / `upsert`:** injection is skipped when `data.tenant` is set (`:199`).
  - **Context override:** the AsyncLocalStorage tenant overrides the explicit argument (`:149`); a mismatch is only logged.
  - **Missing models (about 30):** ChatConversation, ChatAgent*, Crm*, SupportTicket, TenantInvite, WorkspaceNotification, ActivityEvent and others are not in `TENANT_MODELS`.
- **Current state:** no exploitable caller today; every checked caller passes an explicit tenantId.
- **Fix:** always inject the filter in the default branch; map `createMany` rows; reject a foreign `data.tenant`; make the explicit tenantId win or throw; add the missing models. Needs a test sweep.
- **Confidence:** H (latent).

### DATA-03 — Medium (dev) / Low (prod) — `orders/fix-tenant` moves orders across tenants — OPEN
- **Where:** `src/app/api/orders/fix-tenant/route.ts:72-104` runs `prismaRaw.order.findMany/updateMany({ where: { orderId: { in } } })` with no source-tenant filter. It is only guarded by `NODE_ENV === 'production'`.
- **Why it matters:** dev servers point at the shared prod DB.
- **Fix:** delete this route and `orders/debug`. Product-facing API, so it needs Rafael's OK per SAFETY_GATES.
- **Confidence:** H.

### INT-02 — Low-Medium — WhatsApp business token sent to the browser — OPEN
- **Where:** `src/app/api/auth/whatsapp/exchange/route.ts:337-343` returns `accessToken: businessToken`. `config/social/page.tsx:256-259` keeps it in memory and posts it back.
- **Fix (needs design):** keep it server-side in an encrypted pending record bound to tenant and user (as `instagram-pending-connect.ts` does) and return only an opaque id.

### AUTH-07 — Low-Medium — Any member can change the business phone — OPEN
- **Where:** `src/app/api/auth/send-phone-otp/route.ts:89-96` writes `tenant.phone` for any session, and the OTP goes to the caller's own email.
- **Fix:** require `update_config`; persist the phone only after the OTP succeeds.

### AUTH-08 — Low — `/api/auth/*` skips the revocation fast path — OPEN
- **Where:** `/api/auth` is public in `middleware.ts:18`, so `authenticateAPI` falls back to `getServerSession` (`auth-helpers.ts:160`) without `sessionStillValid`.
- **Effect:** a removed member can still use OAuth-connect routes for up to 5 minutes.
- **Fix:** call `sessionStillValid` in the fallback branch.

### DATA-04 — Low — Cross-tenant order-number fallback in logistics `generate-bulk` — OPEN
- **Where:** `logistics/guias/generate-bulk/route.ts:104-108` uses `{ orderId: { in } }` with no tenant. Order numbers repeat across tenants, so the wrong customer's address can be updated (`:163`).
- **Fix:** require the internal `id`, or key on `(tenantId, orderId)` within the managed tenants.

### DATA-05 — Low — PII PDFs without `no-store` — FIXED
`PII_NO_STORE_HEADERS` added to:
- `shipping/guias/download/[id]`
- `logistics/guias/download/[id]`
- `logistics/guias/download-bulk`
- `logistics/reports/pdf`

### DATA-06 — Low — Bulk-update audit reads other tenants' names — OPEN
- **Where:** `src/lib/bulkOperations.ts:600-625`: global `prisma` lookup by `id in ids` with no tenant; `result.success = ids.length` ignores the real count.
- **Fix:** add `tenantId` to each lookup and use `updateMany().count`.

### DATA-07 — Low — Field ↔ foreign option-set connect — OPEN
- **Where:** `src/app/api/config/fields/route.ts:74,133` do `optionSet: { connect: { id } }` without checking ownership.
- **Fix:** `findFirst({ id, tenantId })` before connecting.

### INFRA-04 — Low — Non-constant-time cron bearer compare — OPEN
- **Where:** `cron/chat-automation/route.ts:20`, `cron/bot-inbox/route.ts:15`, `cron/logistics-report/route.ts:12`, `cron/logistics-finalize/route.ts:31`. All fail closed when the secret is unset.
- **Fix:** use `requireCronBearer` (`src/lib/ops/cron-auth.ts`).

### INFRA-05 — Low — Unused remote image host — FIXED
- **Where:** `laplacelab.xyz` was in `images.remotePatterns` with no reference in code. That made `/_next/image` an open optimizer for that host.
- **Fix applied:** removed.

### INT-03 — Low — `signed_request` replay — OPEN
- **Where:** `src/lib/meta-signed-request.ts:17-42` never checks `issued_at`.
- **Fix:** reject requests older than about 1 hour.

### INT-04 — Low — Integration guía batch has no cap — OPEN
- **Where:** `src/app/api/integration/guia/generate/route.ts:30`.
- **Fix:** cap at about 50 ids and reuse the `orders/create` per-key limiter.

### INT-05 — Low — Staff-bot `telegram/set-webhook` admin auth — REPORT-ONLY
- **Where:** `src/app/api/bot/telegram/set-webhook/route.ts:21-36`.
- **Issues:** the secret falls back to `NEXTAUTH_SECRET` and reuses `TELEGRAM_WEBHOOK_SECRET` (which Telegram sends on every call); it accepts any `webhookUrl`; auth is skipped when `NODE_ENV=development`. A logged-in session is still required.

### Info
- **INFO-01:** `api/auth/register/route.ts:301` returns the raw `error.message` (Prisma internals).
- **INFO-02:** register's `inviteLinkRequired` reply reveals whether an email has a pending invite.
- **INFO-03:** `requireAdmin` (`src/lib/apiAuth.ts:8`) compares the role to `'MASTER'`, which middleware never emits, so `GET /api/audit/export` always returns 401. It fails closed, but it is a functional bug.
- **INFO-04:** `sessionStillValid` fails open on DB errors. This is intentional and noted.
- **INFO-05:** `src/lib/email.ts` logs recipient addresses (`console.log` of the email), which puts PII in the logs.
- **INFO-06:** `jszip` is imported by `src/lib/xlsx-guard.ts` but is only a transitive dependency (via exceljs); add it to `dependencies`. `uuid` was fixed here.
- **INFO-07:** `NEXT_PUBLIC_TILOPAY_API_KEY` is forwarded to the container env (`cf-container-worker.ts:304`). No client code reads it today, so it isn't bundled, but the `NEXT_PUBLIC_` name invites someone to use it client-side. Rename it.

### Checked and solid (brief)
- **Middleware:** strips spoofable headers; the HMAC-signed internal auth context is length-prefixed and checked in constant time.
- **Sessions:** 60-second revocation cache; tenant switching re-checks membership.
- **Login:** atomic lockout before bcrypt; reset tokens are hashed, single-use and bump `sessionVersion`.
- **Invites and open redirects:** invites use a timing-safe compare and require an email match; `safeReturnPath` covers sign-in redirects.
- **Meta webhook:** HMAC over the raw body with `timingSafeEqual`, fails closed in prod, dedup unique index, invalid-signature rate limit.
- **Tilopay:** webhooks fail closed with constant-time compare, check server-side amounts and dedupe transactions; the callback never changes plans.
- **Cron:** all routes fail closed without `CRON_SECRET`.
- **Media:** tenant-scoped; IG CDN host allowlist with redirect re-check; 25 MB cap; sandbox CSP; private bucket.
- **Uploads:** magic-byte sniffing and tenant-prefixed paths.
- **SSRF:** Agent Studio crawl does DNS pinning, private-range blocking, redirect re-validation and a port allowlist.
- **Tokens:** AES-GCM at rest; DTOs strip them.
- **Integration keys:** SHA-256 hashed and rate-limited.
- **MCP/support:** hashed bearer, Origin check, per-ticket HMAC.
- **Raw SQL:** every `$queryRawUnsafe` / `$executeRawUnsafe` in logistics, finance and work-clock uses `$n` binds, and only server-built fragments are interpolated. Insights and statistics `Prisma.sql` carry `tenantId` on every joined table.
- **AI agent:** cannot create orders or confirm payments; payment data comes from settings via `[[DATOS_PAGO]]`.

---

## Performance findings

Context: a single Cloudflare container (standard-2; the second instance is standby), Prisma pool of 6, and about 4k orders. The biggest real costs are payload size and polling against a small pool, not slow queries.

| ID | Impact | Where | Finding | Fix | Status |
|---|---|---|---|---|---|
| PERF-01 | High | `src/app/hooks/useSalesStream.ts:91` → `api/orders/route.ts:134` (`take: 5000`) | Ventas/PedidosBoard, SalesDashboard and DailyStats fetch the tenant's whole order list, with `productDetails` and `customFields`, every 30–60s. That is 4 DB queries per poll on a pool of 6, and several hundred KB to MB of JSON per tab. | Server pagination (`limit/page` or the existing cursor `/api/production/orders`); push search and status to the server; drop `productDetails` from the list; 60s+ interval or a cheap `max(updatedAt)` probe first. KPIs from `summarizePedidos` need a server endpoint. | OPEN (needs design) |
| PERF-02 | Med-High | `api/chat/conversations/changes/route.ts:138-150` | Six enrichment queries run in sequence on the 5s inbox poll / SSE path. The list route already runs them in parallel (`conversations/route.ts:139-155`). | Copy the `Promise.all` + merge pattern; run `loadStages` in parallel too. Saves about 5 round-trips per poll. | OPEN (chat route; verify each enricher is independent) |
| PERF-03 | Medium | `ShippingGuia.pdfData` loaded by `findFirst` with no select/omit | Existence checks pull the PDF bytes. | `select`/`omit`. | PARTIAL: fixed `shipping/guias/manual`. `lib/shipping/guia-service.ts:207` does use `pdfData` (re-serves the existing PDF), so no change there. `lib/bot/*` is staff bot (report-only). |
| PERF-04 | Medium | `api/invoices/[id]/pdf/route.ts`, `api/logistics/reports/pdf/route.ts` | A new Chromium per request with no concurrency cap (about 200–300 MB each) on the container that also serves webhooks. | Process-wide semaphore (1–2) plus timeout; `waitUntil: 'load'`; longer term render with `pdf-lib`. | OPEN |
| PERF-05 | Medium (grows) | `src/lib/statistics-dates.ts:110-128`; `api/estadisticas/revenue/route.ts:50` | The stats filter `OR`s over the string `saleDate` (`LIKE '%T%'`), so no index can be used; revenue has no `take`. | Add a materialized `statsDate` column plus `(tenantId, deletedAt, statsDate)` index via `supabase/migrations` SQL (never `db push`); add a `take` cap meanwhile. | OPEN |
| PERF-06 | Low-Med | `src/app/layout.tsx:77` | Meta Pixel (`fbevents.js`) loads on every CRM screen. | Mount only on `/home` and auth pages, or `lazyOnload`. Confirm with marketing. | OPEN |
| PERF-07 | Low | `src/app/layout.tsx:80-90` | The full authenticated provider stack and FeedbackWidget ship on public pages. | `next/dynamic` FeedbackWidget, or an `(app)` route group. | OPEN |
| PERF-08 | Low | `api/sales/stream/route.ts:13` (`take:1000`, all columns), `api/sales/route.ts:25` | No callers found in `src/`, but reachable and heavy. | Confirm no external caller, then delete (product-facing API, so quarantine). | OPEN |
| PERF-09 | Low | `src/lib/db.ts:14`; `useProductionServer.ts:106` | The pool defaults to `connection_limit=1` in prod when the env var is unset. Production polling runs `count()` on every poll. | Default to 5–6; return the count on the first page only. | OPEN |

---

## Dead code (knip 6.29, `npm run audit:dead`)
- **Counts:** 27 unused files, 689 unused exports, 1 "unused" dependency.
- **Removed this pass (zero references across src, scripts, tests, e2e, docs and config):**
  - `src/lib/sentry-scrub.ts`
  - `src/app/components/LogoutButton.tsx`
- **Not removed:**
  - **Read by source-assertion tests:** AppShell, MobileBottomNav, ThemeToggle, HomeButtom, home/LandingPage + SimpleAuthModal + SimplePricingSection, SoftCopilotInboxLegacy (rollback copy), SoftCopilotRail, SoftInboxBuckets, SoftSlimNav. Deleting them means editing tests, which is Rafael's call.
  - **WIP or product decisions:** WhatsNewDrawer (the only caller of `/api/changelog`), useBetsyState (designer hook from 2026-10-22).
  - **Operator scripts:** `scripts/agent-pack/*`.
  - **False positive:** `unpdf` is a dynamic import.
- Full ledger: `PHASE0_DEAD_CODE.md`.

---

## Proof (this branch)
Baseline was taken on `d32a112` before any change, with `DATABASE_URL`/`DIRECT_URL` unset for tests.

| Check | Baseline | After changes |
|---|---|---|
| `npx tsc --noEmit` | pass | pass |
| `npm run lint` | pass | pass |
| `npm run build` (`NODE_ENV=production`, unroutable DB URL) | — | pass (136/136 static pages). With the sandbox's `NODE_ENV=development` it fails on the `/404` prerender (`<Html>` import), an environment artifact |
| `test:security` | 373/373 | 373/373 |
| `test:backups` | 21/21 | same |
| `test:ops` | 48/48 | same |
| `test:soft-ai` | 1533/1533 | same |
| `test:chat-harden` | 781 pass / **1 fail** (pre-existing: `chat-inbox-live.test.ts`, "Promise resolution is still pending", event-loop teardown) | same |
| `test:site-ui` | 83 pass / **1 fail** (pre-existing: aurora-no-native-dialogs on `src/app/config/agentes/page.tsx`, also logged in CHANGELOG) | same |
| `test:meta-attribution` | 40 pass / **1 fail** (pre-existing: expects `"*/5 * * * *": ["/api/cron/bot-inbox", "/api/cron/meta-attribution"]` in `cf-container-worker.ts`; the cron list has since grown) | same |
| Other suites (agentes-ui, config-ui, pedidos-ui, lifecycle, order-display, pagination, insights, stats-ui, channels-ui, support, chat-feedback) | all pass | all pass |

`test:bot-grok` is listed in AGENTS.md and SAFETY_GATES.md, but there is no such script in `package.json`, so it was not run. Update the docs or restore the script.
