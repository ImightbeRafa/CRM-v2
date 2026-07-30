# AGENTS.md

## Cursor Cloud specific instructions

Betsy CRM is a single Next.js 15 app (App Router, TypeScript, Prisma + PostgreSQL,
NextAuth). It is not a monorepo — one dev server serves the whole product
(sales/`ventas`, production, statistics, logistics, billing, AI bot webhooks, etc.).
Standard commands live in `package.json` and `DOCUMENTATION.md`; notes below only
cover non-obvious setup/run gotchas.

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
  logistics/workforce tables (24 of them: `lm_orders`, `lm_order_events`,
  `lm_ce_payments`, `lm_billing_weeks`, `lm_employees`, `lm_time_entries`, `lm_work_days`,
  etc.) are created by raw SQL in `supabase/migrations/` and are **NOT part of the Prisma
  schema**. `prisma db push` makes the DB match `schema.prisma` exactly, so it will try to
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
- All other integrations (Tilopay, Telegram/WhatsApp/Meta, OpenAI/xAI, Upstash Redis,
  Vercel Blob, Correos SOAP) are optional; features degrade gracefully when unset
  (Upstash has an in-memory fallback).

### Auth / testing
- Email verification is non-blocking: you can `POST /api/auth/register` and immediately
  log in. Passwords need 8+ chars with upper, lower, and a number.
- Core end-to-end smoke test: register (or log in), then create an order in `/ventas`
  (the "Retiro (RA)" / pickup option needs the fewest fields).

### Stale scripts
- Many `package.json` scripts (`setup`, `verify`, `test:flow`, `create:test-user`, etc.)
  point at `scripts/*.js` files that do not exist (only `import-orders-from-xlsx.js` and
  `restore-from-backup.js` are present) — those npm scripts will fail. `DOCUMENTATION.md`
  also references an `env-template-local.txt` that is not in the repo.
