# Betsy v2 local release ledger

This ledger records the seven locally verified slices on `codex/betsyv2-local`.
No slice branch or integration branch is pushed. Database SQL and real-tenant
backfills require separate approval and are never applied by Prisma schema commands.

## Slice 1 — Security and safety

- **Local branch:** `codex/betsyv2-s1-security`
- **Schema dependency:** none.
- **Database writes used for verification:** none.
- **Verification:** security 14/14; backups 8/8; bot Grok pass; lint pass with
  pre-existing warnings; `tsc --noEmit` pass; production build pass; unauthenticated
  production-server smoke pass.
- **Known limitations:** real Tilopay calls, email delivery, and authenticated
  test-tenant workflows were not exercised because external charges/messages and
  shared-database writes are excluded from automated safety checks. Invoice email
  deliberately returns `email_not_sent` until Slice 3 adds real Resend state.
- **Rollback:** revert the Slice 1 commit. No database rollback is required.

## Slice 2 — Billing observe, warn, and enforce

- **Local branch:** `codex/betsyv2-s2-billing`.
- **Schema dependency:** additive `TenantFeatureFlag` table packaged in
  `supabase/migrations/018_betsy_v2_feature_flags.sql`. The SQL was **not**
  executed. A missing table deliberately means observe-only and cannot lock a tenant.
- **Database writes used for verification:** none. No flags, subscription rows,
  orders, clients, or backlog markers were changed.
- **Behavior:** every covered regular-tenant business mutation evaluates billing
  from current database state. JWT billing claims and page redirects are not
  authoritative. OWNER payment and provider webhook paths remain reachable;
  Logistics and system/provider endpoints are outside the regular-tenant guard and
  no super-admin/logistics-admin bypass exists on regular-tenant business APIs.
- **Rollout controls:** tenant flag plus a global enforcement switch; exact seven-day
  observe and warn windows; explicit approval timestamp; global switch off or missing
  returns all tenants to observe-only without deployment. Website intake is the only
  business-write exception and has idempotency, Upstash/per-instance attempt limiting,
  a durable successful-write cap, and restricted-backlog marking.
- **Verification:** security/coverage 68/68; `tsc --noEmit` pass; lint pass with
  pre-existing warnings; production build pass on Next/SWC 15.5.23; compiled server
  smoke: `/` 200, sign-in 200, unauthenticated billing access 401, and Ventas 307 to
  sign-in. The local dependency directory had stale Next/SWC 15.5.16 despite the
  lockfile requiring 15.5.23; `npm install` synchronized it without changing the lockfile.
- **Known limitations:** provider payment/failure callbacks, authenticated role flows,
  and test-tenant writes were not exercised because external charges and shared-DB
  mutation are excluded. Enforcement cannot be activated until the additive SQL is
  separately approved and applied. Email remains honest-unavailable until Slice 3.
- **Rollback:** turn off the global enforcement flag first, then revert the Slice 2
  commit if code rollback is needed. The additive table may remain; no down migration
  is required, and old code ignores it.
