# Auth and tenancy

Sources: `src/middleware.ts`, `src/lib/auth-options.ts`, `src/lib/auth-helpers.ts`, `src/lib/rbac.ts`, `src/lib/logistics-auth.ts`, `src/lib/finance-auth.ts`, `src/lib/prisma-tenant.ts`, `prisma/schema.prisma`.

## Session model

NextAuth JWT strategy. Session carries:

| Field | Meaning |
|-------|---------|
| `tenantId` | Active CRM tenant |
| `role` | Legacy `MASTER` / `REGULAR` |
| `membershipRole` / `currentTenant.role` | `MemberRole` |
| `isSuperAdmin` | `User.isSuperAdmin` |
| `isLogisticsAdmin` | `User.isLogisticsAdmin` — **not** a membership role |
| `currentTenant` | plan, trial, subscription status |

Middleware **deletes** incoming `x-user-id`, `x-user-role`, `x-tenant-id`, `x-user-email`, then sets them from the JWT. Never trust those headers from the client.

`NEXTAUTH_SECRET` unset → middleware rejects authenticated traffic.

## Auth axes (independent)

| Axis | Gate | Typical consumer |
|------|------|------------------|
| Signed-in user | NextAuth JWT | CRM pages/APIs |
| Membership role | `MemberRole` + `src/lib/rbac.ts` | CRM modules |
| Super-admin | `User.isSuperAdmin` (+ optional `SUPER_ADMIN_EMAILS`) | `/super-admin` |
| Logistics admin | `User.isLogisticsAdmin` | `/logistics`, `/api/logistics` |
| Worker code | HMAC-SHA256(`EMPLOYEE_CODE_SECRET`) | `/work-clock` |
| Finance key | `FINANCE_API_KEY` (≥24 chars) | `/api/finance` (middleware-public) |
| Integration key | Prisma `ApiKey` | `/api/integration` (CORS + middleware-public) |
| Webhooks | platform secrets | Tilopay, Telegram, WhatsApp, Meta, Instagram deletion |
| Cron | `CRON_SECRET` | `/api/cron/*` (middleware-public) |

Documenting only RBAC is wrong. Logistics, finance, workers, and webhooks do not use `MemberRole`.

## Membership RBAC

`prisma` enum `MemberRole` and `src/lib/rbac.ts`:

| Role | Sales | Production | Stats | Config | Users | Billing / tenant |
|------|-------|------------|-------|--------|-------|------------------|
| OWNER | full | full | full | full | full | yes |
| ADMIN | full | full | full | full | full | no |
| MANAGER | create/update/export (no delete) | yes | yes | read | no | no |
| SALES | create/update (no delete/export) | no | no | read (fields) | no | no |
| PRODUCTION | no | update | no | no | no | no |
| VIEWER | read | read | read | no | no | no |

Pages (`requirePermission` / `getSessionWithTenant`): `/ventas`, `/produccion`, `/estadisticas`, `/config`, `/setup-wizard`, `/exports`, `/backups`.

Middleware does **not** call `canAccessRoute`. It enforces: login, inactive user, logistics flag, chats redirect, trial/subscription → `/config?tab=billing`.

Many CRM APIs use `authenticateAPI` only (tenant + user id). `apiPermissions` in `rbac.ts` is **not** automatically applied. `authenticateAPIWithPermission` is used on some export routes. Do not assume API handlers match page RBAC.

Legacy mapping: JWT `MASTER` → OWNER; `REGULAR` without membership → treated as OWNER during setup (`auth-helpers.ts`).

## Logistics gate

Checked **before** tenant validation in middleware:

```
pathname /logistics or /api/logistics/*
  → token.isLogisticsAdmin === true
  else API 403 / redirect /dashboard
```

Layout double-checks `requireLogisticsAdmin()`. APIs also call `guardLogisticsApi()` (trusts `x-user-id` if middleware already ran).

Logistics admins can use the CRM UI as themselves if they also have a membership; the flag does not grant every SaaS tenant.

Seeded emails in `supabase/migrations/002_logistics_manager.sql` (`deepsleepp.cr@gmail.com`, `peter@peter.com`) are historical. Runtime gate is the Prisma boolean.

## Super-admin

`src/lib/super-admin-helpers.ts`. Bypasses tenant isolation for monitoring. Treat as break-glass. Optional email allowlist `SUPER_ADMIN_EMAILS` **and** db flag.

`TENANT_MODELS` in `src/lib/prisma-tenant.ts` auto-injects `tenantId`. Missing a model from that list caused cross-tenant reads historically (Invoice/billing were added later). Nullable-tenant models (`changelogEntry`, `integrationLog`) are **excluded** on purpose.

Use `getTenantPrisma(tenantId)` / ALS context. Raw `prisma` + missing `where.tenantId` is a tenancy leak. Bypass helpers: `withoutTenantIsolation`, `prismaRaw`.

## Public routes (middleware skip)

Listed in `PUBLIC_ROUTES` in `src/middleware.ts`. Important: `/api/finance`, `/api/cron`, `/api/integration`, bot/chat/Tilopay webhooks, `/work-clock`, `/docs`, legal pages, `/monitoring`.

**Handler must enforce auth** on those prefixes. A new route under a public prefix is world-reachable until the handler guards it.

## Worker clock

Public pages/APIs. Codes hashed with `EMPLOYEE_CODE_SECRET` (fallback `NEXTAUTH_SECRET`). Rotating the secret without reissuing codes locks every worker out. Rate limits: `src/lib/rate-limit.ts`.

## Finance API

`guardFinanceApi` in `src/lib/finance-auth.ts`. Fail-closed if no key. Supports `FINANCE_API_KEY_PREVIOUS` for rotation. Header `x-api-key` or `Authorization: Bearer`. Rate-limited. Never accept a client-supplied tenant id unless it is on `FINANCE_TENANTS`.

## Email / registration

Verification is **non-blocking** — register then log in. Passwords: 8+ chars, upper, lower, number.

`src/lib/email.ts` constructs `new Resend(process.env.RESEND_API_KEY)` at import time. Empty key → `/api/auth/register` 500. Cloud `.env` needs a non-empty placeholder.

`User.active` default is false in schema; JWT refresh can mark inactive. Do not reactivate inactive memberships on Google login (see `src/lib/membership-lifecycle.ts` and changelog 2026-08-13).

## Trial / subscription

Provisioning sets a **7-day** trial (`src/lib/tenant-provisioning.ts`). Middleware may mention a 15-day fallback if `trialEndsAt` is missing — do not “fix” that without an explicit product decision.

`checkSubscriptionStatus` in `src/lib/plan-enforcement.ts` currently hardcodes `active` in places; real enforcement is middleware JWT `currentTenant` + Tilopay webhooks. FREE plan soft-caps ~100 orders/month.
