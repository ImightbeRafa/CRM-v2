# Phase 1 — Structure & WIP

Organize unfinished work so Phase 2 can finish items deliberately. Seeded at kickoff; agents update as discovery continues.

## Workstreams

### W1 — Landing / marketing dedupe
- **Status:** DONE (orphan purge)
- **Resolution:** Kept `/home`; deleted `/landing` tree and stale refs

### W2 — Deployment dashboard
- **Status:** DONE (removed)
- **Resolution:** Deleted broken `/deployment` UI (APIs never existed)

### W3 — Tilopay hardening
- **Status:** WIP (TODOs in code)
- **Notes:** Token caching incomplete; webhook verification permissive/incomplete
- **Phase:** Finish in Phase 2 (billing-sensitive — careful)

### W4 — Invoice email
- **Status:** DONE (Betsy v2 Slice 3)
- **Path:** `src/app/api/invoices/[id]/email/route.ts`
- **Resolution:** Provider-confirmed Resend state; failed/unconfigured delivery returns
  an honest non-success result.

### W5 — Billing storage display
- **Status:** DONE (Betsy v2 Slice 1)
- **Resolution:** Removed the fake `0 MB` measurement and reports unavailable honestly.

### W6 — Oversized modules (structure only, no behavior change)
- **Status:** Structure candidate
- **Paths:** `src/lib/bot/ai-agent.ts`, `src/lib/bot/ai-tools.ts`, `src/app/config/page.tsx`, logistics accounting/carriers/reports pages
- **Phase:** Phase 1 split/ownership map; Phase 2 only if needed for a fix

### W7 — Safety follow-up (not a removal)
- **Item:** `db:push:unsafe` script
- **Action:** Document risk; consider renaming or extra guard later — out of Phase 0 delete scope

### W8 — Knip unused-file triage
- **Status:** DONE for verified orphan files (human OK 2026-07-30)
- Remaining: unused **exports/types** cleanup (non-blocking)

### W9 — Dependency hygiene
- **Status:** partial — removed `@types/bcryptjs`; kept `sharp`
- Still TODO: add missing `uuid` (and `xlsx` if script kept) to package.json

## Phase 2 queue (finish)

1. Tilopay follow-up: confirm provider HMAC contract and any failed-payment notification policy.
2. ~~Invoice email~~ completed in Betsy v2 Slice 3.
3. ~~Billing storage fake metric~~ removed in Betsy v2 Slice 1.
4. ~~Deployment~~ removed in Phase 0 orphan purge.

## Phase 3 (later)

Parallel domain bug scouts with reproduction evidence; no drive-by refactors.
