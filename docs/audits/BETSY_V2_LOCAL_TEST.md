# Local Betsy v2 check (isolated tenant)

Use branch `cursor/betsyv2-prod-validation-3015`. Additive SQL 018–023 is
already applied on shared Supabase. Do not run Prisma migrate / `db push`.

## Secrets (do not commit)

```
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=<same as Cloud / Vercel>
RESEND_API_KEY=<any non-empty placeholder>
EMPLOYEE_CODE_SECRET=<set to current NEXTAUTH_SECRET unless you have a dedicated key>
OPENAI_API_KEY=<any non-empty placeholder; next build instantiates OpenAI at import>
BETSY_V2_TEST_EMAIL=betsyv2.isolated@betsycrm.test
BETSY_V2_TEST_PASSWORD=<the isolated tenant password>
BETSY_V2_TEST_TENANT_ID=cmteijij70000jsoyedmtfnl1
BETSY_V2_TEST_WRITES_AUTHORIZED=1
```

Put the same values in `.env.local` for Playwright (`e2e/start-standalone.mjs`
loads that file). `.env.local` is gitignored.

Sign-in URL is **`/auth/signin`**, not `/login`. `/login` does not exist; middleware
sends unauthenticated visitors to `/auth/signin?callbackUrl=/login`, which looks
like a failed login. Keep `NEXTAUTH_URL` on the same host you open in the browser
(`http://localhost:3000` vs `http://127.0.0.1:3000` will not share cookies).
Standalone Playwright uses port **3106** and needs
`NEXTAUTH_URL=http://127.0.0.1:3106` for that process.

## Preview vs production unlock

**Vercel Preview and local `next dev`:** v2 is ON for every tenant so you can
review Ventas/Producción/Estadísticas with real stores. Writes still go to
the shared production database. The amber banner is the warning. Do not
run destructive tests on real customer data.

**Production (`VERCEL_ENV=production`):** never synthesizes flags. Ordinary
stores stay on `TenantFeatureFlag.enabled` (first deploy: all off).

Do not enable v2 flags in the database for real tenants — that would turn
v2 on in production after merge. Preview env unlock is enough.

First production deploy: `npm run betsyv2:verify-production` must report
zero enabled flags. If isolated-tenant flags were left on from local
testing, run gated `scripts/disable-betsy-v2-flags.mjs` (sets `enabled=false`
only; does not delete rows or rewrite orders).

Do not run `npm run build` while `npm run dev` is serving: the production `.next`
output overwrites unhashed `main-app.js`, the browser then 404s client JS, and
the sign-in form native-submits without hydrating. Restart `npm run dev` after a
build if you need the UI.

## Commands

```bash
git checkout cursor/betsyv2-prod-validation-3015
npm ci
npx prisma generate
npm run lint
npx tsc --noEmit
npm run test:security
npm run test:lifecycle
npm run test:pagination
npm run test:bot-inbox
npm run test:archive
npm run test:tenant-ui
npm run test:backups
npm run test:bot-grok
npm run test:payroll-bounds
npm run test:logistics-archive
npm run build
npm run test:e2e
BETSY_V2_TEST_WRITES_AUTHORIZED=1 npm run test:e2e:tenant
node --env-file=.env.local scripts/verify-betsy-v2-additive-sql.mjs
npm run dev
```

UI against the already-running `npm run dev` server (port 3000):

```bash
PLAYWRIGHT_PORT=3000 BETSY_V2_UI_ORIGIN=http://localhost:3000 \
  BETSY_V2_TEST_WRITES_AUTHORIZED=1 npm run test:e2e:tenant
```

Log in as `betsyv2.isolated@betsycrm.test`. Stay on tenant
`betsyv2-isolated-test`. Do not enable flags for any other tenant.

## Migrations — already applied; review notes

**018–023 are done on production.** Applied 2026-08-29 via
`scripts/apply-betsy-v2-additive-sql.mjs` (DIRECT_URL, host confirm, no Prisma).
Do not re-apply. Follow-up DDL must be a new `024_*` file.

| File | What it added | Status |
|---|---|---|
| 018 | `TenantFeatureFlag` + indexes | applied |
| 019 | lifecycle tables/columns (`clientId`, `lifecycleVersion`, identity, ops, inventory) | applied |
| 020 | `TenantOrderStatusClassification` + pagination indexes | applied |
| 021 | bot inbox tables + `BotSession.seatPolicy` / invoice source key | applied |
| 022 | `Order.deletedAt` + `archiveMetadata` | applied |
| 023 | `TenantSetupProgress` | applied |

Hardening that landed before apply: RLS + `service_role_bypass` on every new
table (match existing Prisma tables). Indexes stayed in-transaction with
`lock_timeout=3s` because `Order` is ~3640 rows / ~7MB.

### What to review (do not “fix” by re-running 018–023)

1. **No `supabase_migrations` ledger.** These files are not recorded by
   `supabase db push` / Prisma migrate. The apply script plus
   `docs/audits/BETSY_V2_PROD_SQL_REVIEW.md` are the record. Do not invent a
   ledger row for already-applied SQL.
2. **PG truncated one unique index name** to 63 characters:
   `TenantOrderStatusClassification_tenantId_normalizedStatusValue_key`.
   Record as-is. Recreating it under a shorter name would duplicate the index.
3. **019 FKs are not composite tenant-aware.** App code must keep tenant scope
   on lifecycle writes. Do not add cross-tenant FKs as a drive-by.
4. **Apply-script verify is a subset** (tables/RLS + a few columns). It does not
   assert every column/index. Catalog SQL in this Cloud Agent run is the
   fuller check.
5. **Flags stay off in the database for real tenants.** First production
   deploy requires zero enabled `TenantFeatureFlag` rows
   (`npm run betsyv2:verify-production`). Preview/local synthesize v2 in code
   for every tenant without writing flag rows. Production stays v1 until a
   later flag rollout. Other-tenant `Order` rows stay `lifecycleVersion` 1
   until someone uses Preview/v2 adapters on them.
6. **Never `prisma db push` / `prisma migrate`.** That would try to drop `lm_*`
   logistics tables. `npm run db:push` is gated; do not pass
   `--accept-data-loss`.

Rollback is **flag-first**. Do not DROP the new columns/tables as an emergency
rollback; current `dev` production code ignores them while flags are off.

Full apply evidence: `docs/audits/BETSY_V2_PROD_SQL_REVIEW.md`.
