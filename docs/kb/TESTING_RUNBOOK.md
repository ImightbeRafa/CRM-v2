# Testing runbook (agents)

Never prove documentation or features by mutating the **shared Supabase** schema. `DATABASE_URL` in Cloud is an injected secret.

## Safe by default

```bash
npm run lint
npm run kb:check          # generated docs/kb/generated vs App Router + schema
npm run test:backups      # backup unit + lm_* coverage
npm run test:bot-grok
npm run test:workforce-datetime
npm run test:workforce-code
npm run test:workforce-state
npm run audit:dead        # knip, non-blocking
```

Domain unit tests also live under `src/lib/__tests__/` (finance classifier, retiros, membership, security). Run with `npx tsx --test <file>` when you touch those modules.

```bash
npm run build             # prisma generate && next build — use after slices that can break types
```

## Forbidden on shared DB

```bash
prisma db push
prisma migrate …
npm run db:push:unsafe
# anything with --accept-data-loss
```

`npm run db:push` is guarded (`scripts/safe-db-push.mjs`) and still must not be pointed at Supabase. Break-glass `ALLOW_LM_DROP=1` is for disposable local DBs only.

Backup restore: `RESTORE_DATABASE_URL` must be loopback. `npm run test:backup-roundtrip` needs local Postgres.

## CRM smoke (Cloud)

1. `POST /api/auth/register` (password 8+ upper/lower/number) or sign in. Email verify is non-blocking.
2. Open `/ventas`, create **Retiro (RA)** (fewest fields).
3. Confirm the row exists for that tenant only (`Order.tenantId`).

`RESEND_API_KEY` must be a non-empty placeholder or register 500s.

## Logistics smoke (needs `isLogisticsAdmin`)

1. Sign in as a logistics admin (flag on `User`, not a membership role).
2. `/logistics` loads; non-admin is redirected to `/dashboard`.
3. `/logistics/carriers` lists managed-tenant orders since 2026-02-22.
4. Do **not** terminate/bill real weeks or confirm Laura stock on shared data unless the task says so.

Worker clock: `/work-clock` is public; use a test employee code only if one was issued for this environment. Do not rotate `EMPLOYEE_CODE_SECRET`.

## Finance smoke

Handler returns 503 if `FINANCE_API_KEY` is unset. With a key: `GET /api/finance/v1/meta` then `brand=all` on facturación/costs. Confirm DeepClean/Forge top-level keys exist. Do not POST — API is read-only.

## KB correctness (this documentation)

After route / Prisma / `lm_*` DDL changes:

```bash
npm run kb:generate
npm run kb:check
```

Manually re-trace in code (no DB writes required):

1. `/ventas` → `POST /api/orders` → Prisma `Order`
2. Logistics GET join + overlay upsert
3. Retiro confirm → stock/handoff (`src/lib/retiro-stock.ts`)
4. Workforce punch → `decideWorkforcePunch`
5. Finance allowlist + classifier
6. Bot webhook still public in `src/middleware.ts`

Auth docs vs code: `PUBLIC_ROUTES`, membership `rolePermissions`, `isLogisticsAdmin` early return, `guardFinanceApi`.

## Evidence for PRs

- Commands actually run (lint/build/tests) with exit 0
- `kb:check` clean
- No new `prisma db push` against Supabase in the transcript
- If UI was tested, say which user/role and that shared logistics data was not finalized
