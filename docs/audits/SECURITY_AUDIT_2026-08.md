# Security Audit Report — CRM-v2

**Date:** 2026-08-11  
**Branch:** `cursor/security-audit-hardening-4cdc`  
**Scope:** Authentication/authorization, secrets, injection, API/route security, CRM PII/tenant/exports/webhooks, dependencies, misconfigurations  
**Method:** Evidence-led route-to-data review with parallel domain scouts; only high-confidence issues reported

---

## Executive summary

This audit found several **Critical/High** issues that were exploitable from authenticated or public surfaces: cross-tenant invoice listing via a missing tenant-isolation model, Tilopay webhook/callback entitlement forgery, merchant Tilopay token exposure, and inactive-user session gaps. Safe hardening for those defects (plus export/cache/PII hygiene and patched auth/Next/axios) is included on this branch.

**Solid areas (brief):** Middleware strips spoofable `x-user-*` / `x-tenant-id` headers; Finance API fail-closed + `timingSafeEqual`; Instagram OAuth state cookie; production Meta/Telegram webhook HMAC; order IDOR generally tenant-scoped when `getTenantPrisma` is used for listed models; no committed `.env` in git history; bcrypt cost 12.

**Deploy note:** Ensure `TILOPAY_WEBHOOK_SECRET` and `CRON_SECRET` are set in every environment. Tilopay must send either `x-tilopay-secret` matching the secret or `hash-tilopay` = HMAC-SHA256(raw body, secret). Presence-only `hash-tilopay` is no longer accepted.

---

## Findings table

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| C1 | Critical | Invoice missing from `TENANT_MODELS` → cross-tenant PII list | **Fixed** |
| C2 | Critical | Tilopay webhook accepts arbitrary `hash-tilopay` / fail-open | **Fixed** |
| C3 | Critical | Unauthenticated Tilopay callback upgrades tenant plans | **Fixed** |
| H1 | High | `/api/tilopay/auth` returns merchant access token | **Fixed** |
| H2 | High | Inactive users can OAuth / keep JWT until refresh | **Fixed** |
| H3 | High | Deactivated memberships auto-reactivated on OAuth/JWT | Document only |
| H4 | High | ADMIN can assign OWNER role | Document only |
| H5 | High | Export/API-key/bulk permission gaps (VIEWER/SALES) | Document only |
| H6 | High | Invoice PDF HTML injection | **Fixed** |
| H7 | High | Backup Blob silent public fallback | **Fixed** |
| H8 | High | Confirmed dependency CVEs (`next-auth`, `next`, `axios`) | **Fixed** (patched) |
| M1 | Medium | Subscription cron auth only in `production` | **Fixed** |
| M2 | Medium | Credentials login lacked rate limit | **Fixed** |
| M3 | Medium | Logistics managed-tenant allowlist bypass | **Fixed** |
| M4 | Medium | CSV formula injection / missing `Cache-Control` on PII exports | **Fixed** |
| M5 | Medium | Integration logs store full PII bodies | **Fixed** |
| M6 | Medium | Google OAuth links to unverified password accounts | Document only |
| M7 | Medium | WhatsApp OAuth missing CSRF state | Document only |
| M8 | Medium | CSP allows `unsafe-inline` / `unsafe-eval` | Document only |
| M9 | Medium | `/api/integration` CORS reflects any Origin | Document only |
| L1 | Low | Invite password strength weaker than register | **Fixed** |
| L2 | Low | Registration response leaked `userId`/`tenantId` | **Fixed** |
| L3 | Low | Integration test endpoint unauthenticated | **Fixed** (prod 404) |
| I1 | Info | Runtime `lm_*` tables without RLS | Document only |
| I2 | Info | Billing finalize fake transactions under PgBouncer | Document only |

---

## Detailed findings

### C1 — Invoice missing from tenant auto-filter (Critical) — FIXED

**Files:** `src/lib/prisma-tenant.ts`, `src/app/api/invoices/route.ts`  
**Evidence:** `Invoice` has required `tenantId` in schema but was absent from `TENANT_MODELS`. `getTenantPrisma(tenantId).invoice.findMany()` therefore returned **all tenants’ invoices** (customer names, emails, phones, addresses, cédulas).  
**Impact:** Authenticated cross-tenant CRM/billing PII disclosure.  
**Fix applied:** Added `invoice`, `billingTransaction`, `usageLog`, `webhookLog`, `apiKey`, `feedbackTicket`, `botSession` to `TENANT_MODELS`; removed phantom non-schema model names.

### C2 — Tilopay webhook authenticity broken (Critical) — FIXED

**Files:** `src/lib/tilopay.ts`, `src/app/api/tilopay/webhook/route.ts`, `webhook-repeat/route.ts`  
**Evidence:** Missing secret → `return true`; any non-empty `hash-tilopay` → `return true`; main webhook verified before reading body so HMAC never ran.  
**Impact:** Forge payment/subscribe events → free plan upgrades.  
**Fix applied:** Fail-closed without secret; remove presence-only acceptance; constant-time compare; pass raw body into HMAC verifier on both webhook routes.

### C3 — Callback mutates entitlements without auth (Critical) — FIXED

**Files:** `src/app/api/tilopay/callback/route.ts`  
**Evidence:** Public POST/GET parsed `orderNumber` as `{tenantId}-{plan}-…` and ran `prisma.tenant.update` to activate paid plans.  
**Impact:** Free plan upgrades for any known tenant id.  
**Fix applied:** Callback is UX redirect only; entitlements only via verified webhooks.

### H1 — Merchant Tilopay token API (High) — FIXED

**Files:** `src/app/api/tilopay/auth/route.ts`  
**Evidence:** Returned `{ token: access_token }` to any logged-in user; unused by app code.  
**Fix applied:** Endpoint returns 403; tokens stay server-side in `src/lib/tilopay.ts`.

### H2 — Inactive user OAuth / JWT (High) — FIXED

**Files:** `src/lib/auth-options.ts`, `src/middleware.ts`  
**Evidence:** Credentials rejected `active: false`; OAuth still `return true`; JWT refresh never cleared sessions; middleware only checked JWT presence.  
**Fix applied:** OAuth rejects inactive users; JWT sync clears session + sets `error: inactive_user`; middleware rejects inactive/cleared tokens.

### H3 — Membership auto-reactivation (High) — DOCUMENT ONLY

**Files:** `src/lib/auth-options.ts` (OAuth + JWT paths)  
**Evidence:** Soft-delete sets `membership.isActive=false`; next OAuth/JWT path reactivates if `defaultTenantId` matches.  
**Recommended fix:** Never auto-reactivate; require explicit invite/admin reactivation. Product confirmation needed (invite-first-login flow may depend on this).

### H4 — ADMIN can assign OWNER (High) — DOCUMENT ONLY

**Files:** `src/app/api/users/route.ts`, `src/lib/rbac.ts`  
**Recommended fix:** Role hierarchy — cannot assign ≥ own role; only OWNER assigns OWNER; protect last OWNER.

### H5 — Export / API keys / bulk RBAC (High) — DOCUMENT ONLY

**Evidence:** Exports use `view_sales` (VIEWER has it) instead of `export_sales`; database export uses `view_config` (SALES); API keys use auth-only; bulk delete uses `view_config`.  
**Recommended fix:** Require `export_sales` / `manage_tenant` / `update_config` / `delete_sales` as appropriate. Product decision on role matrix.

### H6 — Invoice PDF HTML injection (High) — FIXED

**Files:** `src/app/api/invoices/[id]/pdf/route.ts`  
**Fix applied:** `escapeHtml` on all interpolated fields; disable page JS; use session tenant id; `Cache-Control: private, no-store`.

### H7 — Backup public Blob fallback (High) — FIXED

**Files:** `src/lib/backups/blob-store.ts`  
**Fix applied:** Abort on public-only store unless explicit `BACKUP_BLOB_ACCESS=public`.

### H8 — Dependency CVEs (High) — FIXED

**Bumped:** `next-auth@4.24.15`, `@auth/core@0.41.3`, `next@15.5.23`, `axios@1.19.0`.  
**Residual:** transitive highs (`brace-expansion`, Sentry/OTel, `sharp` major) — track separately.

### M1–M5, L1–L3 — FIXED

Subscription cron always requires Bearer `CRON_SECRET` (timing-safe); credentials per-email rate limit; logistics `tenantId` must be in managed allowlist; CSV formula neutralization + `no-store` on exports; integration log PII redaction; invite password strength; registration omits IDs; integration test 404 in production; audit export always scopes `tenantId`.

### Document-only medium/info

- **M6** OAuth account takeover via pre-registering victim email — refuse merge into `emailVerified: null` password accounts.  
- **M7** WhatsApp OAuth — mirror Instagram httpOnly state cookie.  
- **M8** CSP — migrate to nonces; drop `unsafe-eval`.  
- **M9** Integration CORS — allowlist origins or server-to-server only.  
- **I1** Runtime-created `lm_*` without RLS — move DDL to migrations + enable RLS.  
- **I2** Billing weeks `BEGIN`/`COMMIT` via pooler — use `prisma.$transaction`.

---

## Prioritized remediation plan

1. **Deploy this PR** after confirming `TILOPAY_WEBHOOK_SECRET` + `CRON_SECRET` in prod/preview; smoke Tilopay with shared-secret or real HMAC.  
2. **Product decisions (next sprint):** stop membership auto-reactivation; role hierarchy for OWNER; tighten export/API-key/bulk permissions.  
3. **OAuth linking + WhatsApp CSRF state.**  
4. **CSP hardening + integration CORS allowlist.**  
5. **Logistics:** `$transaction` for billing finalize; RLS for runtime `lm_*` tables.  
6. **Deps:** residual transitive advisories / `sharp` major when compatible.

---

## Test evidence

- `npx tsx --test src/lib/__tests__/security-hardening.test.ts` — pass  
- `npm run test:backups` — pass  
- `npm run test:bot-grok` — pass  
- `npm run lint` — no new errors (pre-existing hook warnings only)  
- `npm run build` — success (with placeholder `OPENAI_API_KEY` for page collection)  
- Manual: Tilopay verify fail-closed / presence-only rejected / shared-secret accepted

---

## Areas reviewed as solid

Middleware header stripping; Finance API auth; Instagram OAuth CSRF; production Meta/Telegram webhook HMAC; bcrypt-only credentials; forgot/reset anti-enumeration + rate limits; super-admin live DB checks; no `.env` in git history; no hardcoded cloud API keys in `src/`.
