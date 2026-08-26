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
