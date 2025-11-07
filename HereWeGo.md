# HereWeGo — Betsy CRM Current Status and Improvement Plan

Last updated: 2025-11-07
Owner: Engineering

## Executive Summary
Betsy CRM is a multi-tenant Next.js 14 app with JWT-based auth (NextAuth), Prisma/Postgres, and a growing billing layer (Tilopay). The codebase already enforces tenant isolation at the DB layer and via middleware, and uses a modern UI stack (Tailwind + shadcn/ui). The most impactful improvements now are:
- Security hardening (secrets, headers, input validation, rate limiting, and log hygiene).
- Performance optimizations (bundle size, image optimization, caching, and reducing runtime work).
- Product-level UX and monetization (setup, team management, billing center, plan entitlements, usage-based limits, and a tighter onboarding). 

This document details current status and proposes a phased plan with quick wins and big rocks to lift speed, security, and customer value.

---

## Current Status (from repository audit)
- Stack
  - Next.js 14 (App Router), React 18, TypeScript 5, Tailwind 3, shadcn/ui, lucide-react.
  - Authentication: NextAuth (Credentials + Google). JWT sessions; middleware checks on API and app routes.
  - Database: Prisma 6 + PostgreSQL. Models updated for multi-tenancy with `tenantId` and indexes.
  - Payments: Stripe removed; Tilopay used for purchase flow. One-time payments mark subscriptions active for 30 days.
  - Deployment: Vercel (region sfo1). Cron for backups. Vercel functions limited to 30s by config.

- Multi-tenancy
  - DB schema includes `Tenant`, `Membership`, and many `tenantId`-scoped models with indexes.
  - Middleware reads JWT token to route users (setup vs app), adds `x-tenant-id`, and enforces basic billing/trial gating.
  - Prisma global extension in `src/lib/db.ts` enforces tenant scoping for a subset of models.
  - `src/lib/prisma-tenant.ts` provides a tenant-scoped Prisma via `$extends` and audit logging helpers.

- Authentication & Authorization
  - Credentials login uses bcrypt (with a temporary fallback for legacy plaintext).
  - OAuth (Google) provisions a tenant/membership when needed, reactivates memberships if found.
  - JWT embeds `currentTenant` with plan/status/trial dates for fast gating.
  - RBAC defined in `src/lib/rbac.ts` with role-permissions and helpers.

- API & Features
  - Rich API surface under `src/app/api/*` including orders, config, invoices, exports, statistics, billing, backups, and webhooks.
  - Tilopay webhook processes payments, updates tenant plan/status, and writes audit/billing logs.
  - Config settings endpoint and `TenantSettingsContext` provide currency/locale per tenant.

- UI/UX
  - App router structure for dashboard, ventas (sales), produccion, estadisticas, config, landing/home, setup flows.
  - Tailwind safelist and shadcn/ui tokens configured. Skeleton loading and basic mobile assets present.

- Observability & Ops
  - Console-based logging throughout (including middleware and webhooks), audit logs in DB for mutating operations.
  - Instrumentation stub present. No Sentry/OTel yet.

---

## Strengths Worth Preserving
- Tenant isolation at middleware and Prisma layers reduces cross-tenant data leaks.
- RBAC is explicit with permission mapping for roles and routes.
- Prisma schema has appropriate tenant-scoped unique constraints and indexes.
- JWT tokens pre-pack `currentTenant` to avoid DB hits in middleware.
- Deployment ready for Vercel with cron and function timeouts configured.

---

## Gaps, Risks, and Constraints
- Security
  - Secrets hygiene: Fallback `NEXTAUTH_SECRET` defaults to a dev value; must be enforced via env.
  - Webhook verification logs the expected/provided secret values to console (risk of credential leakage).
  - Input validation: Zod schemas exist but are not applied consistently in route handlers.
  - Rate limiting: In-memory limiter exists but is not used and won’t persist across serverless instances.
  - Headers: Good HSTS/XFO/XCTO/Referrer-Policy, but missing Content Security Policy and Permissions-Policy.
  - Legacy password support (plaintext compare path) should be removed after migration.

- Multi-tenancy consistency
  - Two tenant isolation strategies: global extension in `db.ts` and on-demand in `prisma-tenant.ts`.
  - The top-level `$extends` in `prisma-tenant.ts` is not assigned to a client (likely no effect). Unify to avoid drift.
  - Global isolation list in `db.ts` excludes some tenant models (e.g., membership and others defined in `prisma-tenant.ts`).

- Performance
  - Images set to `unoptimized: true` in Next config; likely higher bandwidth and layout shift.
  - Bundle analyzer integrated but no checked-in actions from analysis; heavy libs (e.g., recharts, puppeteer, xlsx) should be dynamically loaded or isolated.
  - Excessive console logging in middleware and webhooks adds overhead and potential PII leakage.

- UX & Product
  - Trial/plan enforcement is basic; usage quotas exist in schema (`UsageLog`) but not enforced.
  - Setup wizard optional; onboarding flows could be streamlined and more guided.
  - Team management (invites, role assignment) UI can be made more prominent and self-service.
  - Billing center (plan management, invoices, payment method) needs a consolidated experience.

- Observability
  - No Sentry/OTel; logs are not structured, and correlation (`requestId`) is not consistently propagated.

---

## Speed and Performance Plan
- Quick Wins
  - Reduce logging in middleware/webhooks to essential info only; remove PII and secrets.
  - Enable Next/Image optimization with proper remote patterns; measure largest endpoints and critical pages.
  - Dynamic import heavy charts/tables and only load on demand (e.g., estadisticas, exports, xlsx, recharts).
  - Cache GET route handlers with `revalidate` where safe (e.g., config, read-only stats).
  - Use RSC for data fetching where applicable to reduce client JS and waterfal.

- Medium Rocks
  - Re-enable TypeScript and ESLint at build (currently ignored) and fix highest-priority issues to reduce runtime errors.
  - Add route-level streaming for dashboards; ensure skeletons and optimistic updates where beneficial.
  - Profile bundle with `ANALYZE=true`; split vendor bundles; convert frequently used utility modules to ESM tree-shakable patterns.

- Big Rocks
  - Adopt image CDN (Vercel Image Optimization) across sales/production views; add responsive sizes.
  - Introduce edge caching for read-heavy endpoints and CDN caching for static assets.

KPIs: Time-to-Interactive, LCP, CLS, API p95 latency, JS shipped per route, total image kb per page.

---

## Security Hardening Plan
- Immediate (Critical)
  - Enforce `NEXTAUTH_SECRET` presence; fail fast if missing in non-dev.
  - Remove any logging of shared secrets and token values from webhooks and auth flows.
  - Remove plaintext password fallback; complete one-time migration to bcrypt-only.

- Near-Term
  - Add a strict Content Security Policy and Permissions-Policy via Next headers.
  - Introduce distributed rate limiting (e.g., Upstash or Vercel KV) for:
    - Auth endpoints (login/register).
    - Payment webhooks and payment link creation.
    - Bulk APIs and exports.
  - Apply Zod input validation on all mutating route handlers (central wrapper + consistent error responses).
  - Standardize error handling to avoid leaking internals (use existing error classes consistently).

- Medium-Term
  - CSRF protection for cookie-authenticated POST endpoints that are browser-accessible (or HMAC signed requests).
  - Secrets management review (Vercel envs); audit logs must never include secrets/PII.

---

## Reliability and Observability
- Introduce Sentry for frontend and API route handlers (with DSN by env).
- Add OpenTelemetry (basic traces for critical flows: login, order create, webhook processing).
- Structure logs as JSON with `requestId`, `tenantId`, `userId`, `route`, `action` fields.
- Expand `/api/ping` to include DB connectivity and version info for readiness checks.

---

## Multi-tenancy and Data Layer Plan
- Unify tenant isolation approach
  - Choose a single canonical approach (recommend `getTenantPrisma(tenantId)` for route handlers) and ensure global extension lists all tenant-scoped models or remove it to avoid double mutation.
  - Fix the no-op `$extends` in `prisma-tenant.ts` (top-level call without assignment) by removing or wiring correctly.

- Enforcement and Guardrails
  - Ensure all route handlers call a central `authenticateAPI`/`authenticateAPIWithPermission` and set tenant context.
  - Validate all `findMany` calls respect tenant context; fail fast on missing context.

- Usage & Quotas
  - Implement server-side quota checks using `UsageLog` for FREE/BASIC/PRO plans (orders/month, users, API calls).
  - Emit usage increments on key actions; expose usage in Billing Center.

---

## Product, UX, and New Components
- Onboarding & Setup
  - Streamlined setup wizard: business info, product fields presets, first pipeline, test order, invite team, choose plan.
  - Guided success checklist on dashboard with progress tracking.

- Team & Access
  - Team Management page: invite by email, roles (OWNER/ADMIN/MANAGER/SALES/PRODUCTION/VIEWER), pending invites, resend.
  - Tenant Switcher component (for users with multiple memberships) in the global nav.

- Billing Center
  - Centralize plan management, invoices, payment method, next renewal, and usage.
  - Implement recurring billing via Tilopay Repeat (schema fields already exist) or Stripe if strategy changes.

- Sales & Production Enhancements
  - Board views with fast filters, saved views, and shareable links per team.
  - Mobile-first quick actions; offline-safe forms with client-side validation and retries.

- Config & Admin
  - Product Option Sets and dynamic Product Fields manager (already present—optimize UX and add presets).
  - Webhook Logs viewer (exists) with filtering by level/source/time; add replay and export.
  - Localization/i18n: extend Tenant Settings to switch language and currency across UI.

- Data Import/Export
  - Import Wizard with mapping previews, error rows, and undo for clients/orders.
  - Scheduled exports to email or blob for reports.

---

## Monetization: Plans and Entitlements (proposal)
- FREE
  - 1 user, 100 orders/month, basic sales + production, standard reports, branding required.
- BASIC
  - Up to 5 users, 1,000 orders/month, advanced reports, webhook logs, CSV/XLSX exports, priority support.
- PRO
  - Up to 25 users, unlimited orders, API access, custom fields/option sets, automation hooks, SSO readiness.
- ENTERPRISE
  - Unlimited, custom domains, SSO/SAML, dedicated support, data residency options.

Gate via middleware and server checks; surface clear upsell in-app when limits reached.

---

## Phased Roadmap
- Phase 0 (Week 1) — Critical Security & Hygiene
  - Enforce `NEXTAUTH_SECRET`; remove secret logging; remove plaintext password fallback.
  - Add CSP and Permissions-Policy; reduce logs and PII exposure; standardize error responses.
  - Fix `prisma-tenant.ts` top-level `$extends`; unify tenant isolation behavior.

- Phase 1 (Weeks 2–3) — Performance & Stability
  - Re-enable TypeScript/ESLint build checks; address high-severity issues.
  - Turn on Next/Image optimization; dynamic import heavy libs; cache safe GETs.
  - Add structured logging with `requestId` and `tenantId`; add Sentry for error capture.

- Phase 2 (Weeks 4–6) — UX and Monetization Foundations
  - Billing Center, Team Management, Tenant Switcher, improved Setup Wizard.
  - Distributed rate limiting and Zod validation applied across POST/PUT/DELETE.
  - Implement usage quotas and plan entitlements server-side; upsell flows.

- Phase 3 (Ongoing) — Growth & Integrations
  - Recurring billing (Tilopay Repeat), integration marketplace, API docs & keys.
  - Advanced analytics dashboards; automation and webhooks UX.

Success metrics: Crash-free sessions > 99.9%, p95 API < 500ms, LCP < 2.5s on P50 routes, trial conversion +20%, churn -15%.

---

## Action Register (initial)
- Security
  - Remove secret logging and enforce required envs.
  - Add CSP and Permissions-Policy headers.
  - Adopt distributed rate limiting for auth/webhooks.
  - Apply Zod validation to all mutating routes.
- Data & Tenancy
  - Unify Prisma tenant isolation and audit coverage.
  - Implement usage quotas; expose in Billing Center.
- Performance
  - Enable image optimization; dynamic imports; cache read endpoints.
  - Re-enable TS/ESLint checks and fix priority issues.
- Product & UX
  - Build Billing Center, Team Management, Tenant Switcher, enhanced Setup Wizard.
  - Improve sales/production boards and mobile flows.

---

## Notes
- Live site alignment: finalize messaging/positioning and landing flow alignment after a quick stakeholder review of betsycrm.com (blocked from automated fetch in this environment). 
- All recommendations above are designed to work with the existing stack and deployment model.
