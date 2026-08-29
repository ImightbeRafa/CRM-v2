# Betsy v2 additive SQL — production review

Date: 2026-08-29
Review SHA: `9943fe5` (`codex/betsyv2-review`, ancestor `5ea4377`)
Validation branch: `cursor/betsyv2-prod-validation-3015`
Database: shared Supabase `db.bmolvybsqzkeswkomgzw.supabase.co` (Postgres 17.6)
Prisma migrate / `db push`: **not used**

## Verdict

**SAFE TO APPLY as additive expand-only DDL** after RLS hardening. Do **not**
enable any v2 feature flag. Do **not** push `origin/dev` from this review.
Authenticated tenant writes still need an explicit password and a pinned tenant
ID because `peter@peter.com` is a privileged, multi-tenant account.

## Catalog preflight (read-only)

| Relation | Exact rows | Total size |
|---|---|---|
| `Order` | 3640 | ~7 MB |
| `Client` | 2036 | ~1.5 MB |
| `Invoice` | 13 | 112 kB |
| `BotSession` | 18 | 96 kB |
| `Tenant` | 24 | 96 kB |

No v2 columns or v2 tables existed before apply. There is no
`supabase_migrations` schema; these files are applied manually.

Existing Prisma tables already have RLS enabled with a `service_role_bypass`
policy. Default ACLs grant `anon` / `authenticated` full DML on new public
tables, so **new tables without RLS would be Data-API readable**. 018–023 now
enable RLS and the same `service_role` policy on every new table. The Next.js
app uses table-owner `postgres`, which bypasses RLS.

Indexes stay inside each file's `BEGIN/COMMIT` with `lock_timeout=3s` and
`statement_timeout=30s`. Concurrent indexes are unnecessary at this size; a
lock wait longer than 3s aborts and rolls the file back.

## Dedicated test tenant (`peter@peter.com`)

User exists, active, has a password, email not verified.

| Flag | Value |
|---|---|
| `isSuperAdmin` | **true** |
| `isLogisticsAdmin` | **true** |

| Tenant | ID | Orders | Notes |
|---|---|---|---|
| PeterTesting (`peter`) | `cmh44aerw0006vijg0640vfl0` | 1 | FREE, `subscriptionStatus=expired`, has a Tilopay subscription id, linked in `lm_tenant_links` |
| Peter Test Company | `cmh7b02500000vizge80ekjmk` | 150 | FREE, no Tilopay, not in logistics links |

Sol's isolation gate does **not** fully pass: the account is super-admin,
logistics-admin, and owns two tenants. It can still be the designated test login
**if** every mutation asserts `BETSY_V2_TEST_TENANT_ID` and no flags are
enabled for any other tenant. Prefer PeterTesting (`cmh44aerw0006vijg0640vfl0`)
for writes because it has almost no operational data.

This environment does **not** have `BETSY_V2_TEST_PASSWORD`, so authenticated
Playwright / API writes were not run here.

## Apply command

```bash
BETSY_V2_APPLY_MIGRATIONS=1 \
BETSY_V2_APPLY_CONFIRM_HOST=db.bmolvybsqzkeswkomgzw.supabase.co \
node scripts/apply-betsy-v2-additive-sql.mjs
```

Rollback is flag-first (nothing is turned on). Do not DROP the new columns or
tables as an emergency rollback; old production code ignores them.

## Local Cloud Agent for the same branch

1. New Cloud Agent on `imightberafa/crm-v2`.
2. Base branch **`codex/betsyv2-review`** (SHA `9943fe5`) or this validation
   branch after it is pushed.
3. Confirm `git rev-parse HEAD` is `9943fe5` or a descendant that only adds
   the RLS/apply-script commits.
4. Put secrets in Cloud secrets, never the prompt: `NEXTAUTH_SECRET`,
   `NEXTAUTH_URL`, `RESEND_API_KEY`, `BETSY_V2_TEST_EMAIL=peter@peter.com`,
   `BETSY_V2_TEST_PASSWORD`, `BETSY_V2_TEST_TENANT_ID=cmh44aerw0006vijg0640vfl0`.
5. Instruct the agent:
   - no `prisma migrate` / `db push` / `--accept-data-loss`
   - no provider calls (xAI, Resend, Meta, Telegram, Tilopay, Correos)
   - no writes outside the pinned tenant
   - no push to `origin/dev`
   - do not enable v2 flags unless the user explicitly asks
6. If it needs code changes, branch as `cursor/<name>-<run-suffix>` from the
   review SHA. Keep any PR base set to `dev` and draft.
