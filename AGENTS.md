# AGENTS.md

## Cursor Cloud specific instructions

Betsy CRM is a single Next.js 15 app (App Router, TypeScript, Prisma + PostgreSQL,
NextAuth). It is not a monorepo — one dev server serves the whole product
(sales/`ventas`, production, statistics, logistics, billing, AI bot webhooks, etc.).
Standard commands live in `package.json` and `DOCUMENTATION.md`; notes below only
cover non-obvious setup/run gotchas.

### Two surfaces (read this first)

This repo is **one deployment, two products**:

| Surface | Audience | Data | Tree |
|---------|----------|------|------|
| **Betsy CRM** | Paying tenant members | Prisma (`schema.prisma`) | `/ventas`, `/produccion`, `/estadisticas`, `/config`, `/api/orders`, bots, Tilopay |
| **HolaMA logistics** | `User.isLogisticsAdmin` + warehouse workers | Raw SQL `lm_*` (**not** in Prisma) | `/logistics`, `/work-clock`, `/api/logistics`, `/api/finance` |

They share Prisma `Order` rows. Logistics overlays `lm_orders.crm_order_id = Order.id` (cuid, not `Order.orderId`). No database FK.

**Canonical architecture for agents:** [`docs/kb/README.md`](docs/kb/README.md)
(boundaries, auth, data ownership, order flow, route map, integrations, test runbook).
Generated inventories: `docs/kb/generated/` (`npm run kb:generate` / `npm run kb:check`).

**Doc precedence:** `AGENTS.md` hard stops → `docs/kb/` → `docs/audits/` → `DOCUMENTATION.md` (legacy, often stale) → customer MDX under `src/content/`. Code wins over all of them.

When you add/remove App Router pages, API `route.ts` files, Prisma models, or `lm_*` tables, regenerate the KB inventories and update the matching curated file if behavior changed.

### Agent OS & audits
- Skill: `.cursor/skills/executor-advisor-loop/SKILL.md` (Sol-orchestrated Executor/Advisor;
  Sol model `gpt-5.6-sol-high`; parent session dispatches parallel read-only scouts).
- Command: `.cursor/commands/codebase-audit.md` for Phase 0/1 slim & structure audits.
- Living ledgers (update after every slice): [`docs/audits/`](docs/audits/README.md)
  — Phase 0 dead code, Phase 1 WIP, safety gates, agent changelog.
- Dead-code inventory: `npm run audit:dead` (knip, non-blocking). Do not mass-delete
  from knip alone; follow `docs/audits/SAFETY_GATES.md`.

### Services

| Service | Run command | Notes |
|---------|-------------|-------|
| Next.js app (the whole product) | `npm run dev` (port 3000) | Lint: `npm run lint`. Build: `npm run build` (runs `prisma generate` then `next build`). |

### Database (important, non-obvious)
- `DATABASE_URL` and `DIRECT_URL` are **injected Cloud Agent secrets** pointing at a
  **shared Supabase** instance. Real environment variables take precedence over `.env`,
  so the app/Prisma use Supabase regardless of what `.env` says. The schema is already
  applied there.
- **Do NOT run `prisma db push` / `prisma migrate` against this DB.** The `lm_*`
  logistics/workforce tables (25 of them: `lm_orders`, `lm_order_events`,
  `lm_ce_payments`, `lm_billing_weeks`, `lm_employees`, `lm_time_entries`, `lm_work_days`,
  `lm_retiro_order_allocations`, etc.) are created by raw SQL in `supabase/migrations/`
  and/or runtime `CREATE TABLE` and are **NOT part of the Prisma schema**. `prisma db push` makes the DB match `schema.prisma` exactly, so it will try to
  **DROP every `lm_*` table** — this already caused a full logistics data loss once.
  `npm run db:push` runs `scripts/safe-db-push.mjs`, which refuses Supabase hosts,
  pooler port 6543, non-loopback URLs, and any database that already has `lm_%`
  tables (break-glass: `ALLOW_LM_DROP=1` on disposable DBs only). Never pass
  `--accept-data-loss`.
- **Backups:** private Vercel Blob logical dumps (`src/lib/backups/`) cover all
  `public` tables including `lm_*`. Full cron 02:00 UTC, hot cron 14:00 UTC.
  Restore via `scripts/restore-from-backup.ts` against `RESTORE_DATABASE_URL`
  (loopback by default). Run `npm run test:backups` and
  `npm run test:backup-roundtrip` (local Postgres) to prove usefulness.
  Do not depend on paid Supabase PITR.
- No local PostgreSQL is required; do not point the app at a local DB (it would be
  overridden by the injected secret anyway).

### Required env (created by the update script into `.env` if missing; `.env` is gitignored)
- `NEXTAUTH_SECRET` — required; middleware (`src/middleware.ts`) rejects all
  authenticated requests when it is unset.
- `RESEND_API_KEY` — must be a non-empty placeholder; `src/lib/email.ts` calls
  `new Resend(process.env.RESEND_API_KEY)` at import time and throws on an empty value,
  which 500s the `/api/auth/register` route. Email sending is otherwise non-blocking in dev.
- `NEXTAUTH_URL=http://localhost:3000`.
- `EMPLOYEE_CODE_SECRET` — stable HMAC key for worker clock codes. Existing deployments
  that previously used the fallback must initially set it to the current
  `NEXTAUTH_SECRET` value; choosing a different value immediately invalidates all issued
  employee codes. Do not rotate it without an explicit code reissue plan.
- All other integrations (Tilopay, Telegram/WhatsApp/Meta, OpenAI/xAI, Upstash Redis,
  Vercel Blob, Correos SOAP) are optional; features degrade gracefully when unset
  (Upstash has an in-memory fallback).

### Auth / testing
- Email verification is non-blocking: you can `POST /api/auth/register` and immediately
  log in. Passwords need 8+ chars with upper, lower, and a number.
- Core end-to-end smoke test: register (or log in), then create an order in `/ventas`
  (the "Retiro (RA)" / pickup option needs the fewest fields).

### Scripts
- Viable scripts: `dev`, `build`, `start`, `lint`, `db:*`, `backup:*`, `test:backups`,
  `test:backup-roundtrip`, `test:bot-grok`, `audit:dead`, `kb:generate`, `kb:check`.
- Stale scripts that pointed at missing `scripts/*.js` files were removed in the
  Phase 0 kickoff (see `docs/audits/PHASE0_DEAD_CODE.md`).
- `DOCUMENTATION.md` may still reference missing files (e.g. `env-template-local.txt`);
  agent-maintained architecture truth lives under [`docs/kb/`](docs/kb/README.md);
  audit ledgers live under `docs/audits/`.
