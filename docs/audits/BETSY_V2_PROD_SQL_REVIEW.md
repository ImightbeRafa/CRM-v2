# Betsy v2 additive SQL — production review

Date: 2026-08-29
Review SHA: `9943fe5` (`codex/betsyv2-review`, ancestor `5ea4377`)
Validation branch: `cursor/betsyv2-prod-validation-3015`
Database: shared Supabase `db.bmolvybsqzkeswkomgzw.supabase.co` (Postgres 17.6)
Prisma migrate / `db push`: **not used**

## Verdict

**SAFE TO APPLY as additive expand-only DDL** after RLS hardening. Do **not**
enable any v2 feature flag. Do **not** push `origin/dev` from this review.
Authenticated writes use a new isolated tenant, not `peter@peter.com`.

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

## Dedicated test tenant (isolated, not Peter)

`peter@peter.com` was rejected: super-admin, logistics-admin, two memberships.
A new isolated account was created on the shared database for v2 testing only.

| Field | Value |
|---|---|
| Email | `betsyv2.isolated@betsycrm.test` |
| User ID | `cmteijik70001jsoy2coxg806` |
| Tenant ID | `cmteijij70000jsoyedmtfnl1` |
| Slug | `betsyv2-isolated-test` |
| Role | OWNER (single membership) |
| `isSuperAdmin` | false |
| `isLogisticsAdmin` | false |
| Tilopay | none |
| `lm_tenant_links` | none |
| Orders / clients | 0 / 0 |
| v2 flags | none |

Password is not stored in git. Use `BETSY_V2_TEST_EMAIL` / `BETSY_V2_TEST_PASSWORD` /
`BETSY_V2_TEST_TENANT_ID=cmteijij70000jsoyedmtfnl1`. `peter@peter.com` was not
modified.

Login proof (local Next 15.5.23): credentials callback 200;
`/api/auth/me` returns OWNER on tenant `cmteijij70000jsoyedmtfnl1`;
session `allTenantIds` is only that tenant; `/api/production/metadata`
returns `enabled: false`.

## Apply command

```bash
BETSY_V2_APPLY_MIGRATIONS=1 \
BETSY_V2_APPLY_CONFIRM_HOST=db.bmolvybsqzkeswkomgzw.supabase.co \
node scripts/apply-betsy-v2-additive-sql.mjs
```

## Apply result (2026-08-29, this Cloud Agent)

Applied one file at a time via `DIRECT_URL` port 5432. Prisma was not used.

| File | Duration | Result |
|---|---|---|
| 018 | 634ms | ok |
| 019 | 1037ms | ok |
| 020 | 307ms | ok (PG truncated unique index name to 63 chars) |
| 021 | 166ms | ok |
| 022 | 97ms | ok |
| 023 | 61ms | ok |

Postconditions:

- 8 new tables exist, RLS on, one `service_role` policy each
- All new Order/Client/Invoice/BotSession columns exist
- `Order` still 3640, `Client` still 2036, invoices still 13
- New tables are empty; `TenantFeatureFlag` has 0 rows (nothing enabled)
- No invalid indexes
- Existing PeterTesting order still `clientId=null`, `lifecycleVersion=1`, `deletedAt=null`

Prisma Client can read the new models. Current production code on `dev` ignores
them while flags are off.

Rollback is flag-first (nothing is turned on). Do not DROP the new columns or
tables as an emergency rollback; old production code ignores them.

## Local Cloud Agent for the same branch

1. New Cloud Agent on `imightberafa/crm-v2`.
2. Base branch **`codex/betsyv2-review`** (SHA `9943fe5`) or this validation
   branch after it is pushed.
3. Confirm `git rev-parse HEAD` is `9943fe5` or a descendant that only adds
   the RLS/apply-script commits.
4. Put secrets in Cloud secrets, never the prompt: `NEXTAUTH_SECRET`,
   `NEXTAUTH_URL`, `RESEND_API_KEY`,
   `BETSY_V2_TEST_EMAIL=betsyv2.isolated@betsycrm.test`,
   `BETSY_V2_TEST_PASSWORD`,
   `BETSY_V2_TEST_TENANT_ID=cmteijij70000jsoyedmtfnl1`.
5. Instruct the agent:
   - no `prisma migrate` / `db push` / `--accept-data-loss`
   - no provider calls (xAI, Resend, Meta, Telegram, Tilopay, Correos)
   - no writes outside the pinned tenant
   - no push to `origin/dev`
   - do not enable v2 flags unless the user explicitly asks
6. If it needs code changes, branch as `cursor/<name>-<run-suffix>` from the
   review SHA. Keep any PR base set to `dev` and draft.
