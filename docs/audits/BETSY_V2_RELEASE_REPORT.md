# Betsy v2 Local Release Report

Date: 2026-08-29

## Production candidate (2026-08-30)

Branch: `cursor/order-qa-feedback-fixes-6cf1` (v2 + QA + production-cut).
Target: `origin/dev`. **Do not merge until Vercel is green and a human
approves.** The agent does not push or merge `origin/dev`.

- Additive SQL **018–023 is already applied** on shared Supabase. Do not
  re-apply. Do not `prisma db push` / `prisma migrate`.
- First production deploy: **all `TenantFeatureFlag.enabled` rows off**.
  Production never synthesizes v2 flags.
- Vercel Preview and local `next dev` unlock v2 for **every tenant** so
  reviewers can use real stores. Writes hit the shared DB. The amber
  banner warns. Do not enable DB flags for real tenants.
- Website intake accepts optional `orderType: "RA"` on new orders.
  Historical totals are not rewritten. No `lm_*` changes.

The 2026-08-29 local report below is historical (it recorded SQL as
unexecuted before apply). Catalog truth is
`docs/audits/BETSY_V2_PROD_SQL_REVIEW.md` plus
`npm run betsyv2:verify-sql`.

## Release contents

The seven independently verified slice commits remain intact in order:

| Slice | Commit | Safe default |
|---|---|---|
| 1 — security and safety | `779fbd2` | Hardening active; no paid-tenant lockout change |
| 2 — billing access | `9485f38` | Observe-only; database kill switch available |
| 3 — canonical lifecycle | `e041465` | Tenant lifecycle flag off |
| 4 — server Producción and Clients | `dfc7103` | Read-path flags off |
| 5 — durable bot inbox | `ec2f2cd` | Inbox and bot lifecycle flags off |
| 6 — soft-delete/restore | `c5c0b9d` | Archive flag off |
| 7 — AI paste/setup/statistics/UI | `d8db1be` | All three UI flags off |

Latest `origin/dev` at `610f77c` was fetched and merged locally after Slice 7. The
merge preserves its performance, finance, payroll, and Logistics archive fixes. The
overlaps in subscription display, tenant config caching, statistics, and Producción
were resolved in favor of the v2 safety contracts while retaining upstream query and
lazy-loading improvements.

No slice branch, tag, integration branch, or merge commit has been pushed. Local
`dev` has not been moved.

## Database and provider state

- No Prisma migration, `db push`, additive SQL, destructive seed, or backfill ran.
- The shared Supabase schema and ordinary tenant rows were not changed.
- Migration packages `018` through `023` remain review-only and unexecuted.
- `schema.prisma` matches the proposed additive shape; only `prisma generate` ran.
- No xAI, Resend, Meta, Telegram, Tilopay, or Correos test message, charge, or label
  was sent.
- A latest-upstream Logistics archive regression was verified with read-only database
  access. It made no mutation and its output is not retained in this report.

Additive SQL must be approved separately. Real-tenant client linking, terminal-status
classification, and bot grandfathering remain dry-run/read-only until their own
approval.

## Flags and rollout controls

All absent tenant flags resolve to off. The first deployment therefore leaves ordinary
tenants on their current paths.

| Flag | Controls | First-deploy state |
|---|---|---|
| `billing_access` | observe/warn/enforce and kill switch | observe only |
| `order_lifecycle_v2` | all non-bot order adapters as one set | off |
| `production_server_v2` | server Producción queries | off |
| `clients_server_v2` | paginated Clients/history | off |
| `bot_inbox_v2` | durable provider inbox | off |
| `bot_lifecycle_v2` | canonical bot writes | off |
| `soft_delete_restore_v2` | archive/restore | off |
| `ai_customer_paste_v2` | optional Grok suggestion | off |
| `setup_guide_v2` | tenant-persisted setup | off |
| `statistics_revenue_v2` | dual revenue observation | off |

Bot lifecycle cannot activate unless the inbox and Slice 3 lifecycle readiness agree.
Clients history requires its approved client-link backfill marker. Terminal-window
filtering requires a complete approved tenant mapping. These dependencies fail closed.

## Final local verification

- TypeScript: pass.
- ESLint: pass with the repository's existing non-blocking hook/image warnings.
- Production build: pass, 126 routes, using Next's isolated webpack build worker to
  avoid the Windows in-process compiler access violation.
- Standalone production artifact: served locally with copied static/public assets.
- Playwright smoke: 3/3 pass against that standalone artifact.
- Security/membership/write coverage: 71/71 pass.
- Lifecycle: 8/8 pass.
- Server pagination: 8/8 pass.
- Durable inbox: 8/8 pass.
- Archive/restore: 6/6 pass.
- Tenant UI: 7/7 pass.
- Backup contracts: 8/8 pass.
- Bot Grok helper: pass.
- Upstream payroll bounds, finance classifier, finance tenant, and read-only Logistics
  archive regressions: pass.

The automated suite suppresses provider side effects. Authenticated feature-flagged
workflows still require approved additive SQL and the explicitly designated test tenant;
they were not faked against an ordinary tenant.

## Rollout and rollback

1. Review the local commit history and this report.
2. Review and approve additive SQL separately; verify backup coverage before execution.
3. After final code approval, fast-forward local `dev` to this tested integration history
   and push `dev` once, producing one Vercel build.
4. Keep all v2 flags off in the first deployment.
5. Enable the dedicated test tenant first, in dependency order, and run authenticated
   production smoke checks with designated provider accounts only.
6. Expand tenant-by-tenant after clean observation.

The first rollback is always the affected database flag. Billing has an independent
observe-only kill switch. If a code rollback is needed, revert the relevant slice commit
and deploy once; additive nullable columns/tables remain because old code ignores them.
No rollback depends on a destructive down migration.

## Remaining approval gates

- Human review and execution approval for SQL `018`–`023`.
- Exact dedicated test-tenant ID and authorization for its controlled writes.
- Separate approval for each real-tenant client, status, and bot-session backfill.
- Explicit approval to move local `dev` and perform the single remote push.
