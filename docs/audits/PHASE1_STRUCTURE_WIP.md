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
- **Status:** Incomplete
- **Path:** `src/app/api/invoices/[id]/email/route.ts`
- **Issue:** Logs and returns success without sending email
- **Phase:** Phase 2 finish

### W5 — Billing storage display
- **Status:** Incomplete
- **Issue:** Storage usage hard-coded to `0 MB`
- **Phase:** Phase 2 finish

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

### W10 — Site-wide perceived performance
- **Status:** IN PROGRESS (first slice shipped)
- **Done:** stop global ConfigProvider fan-out; slim logistics order list; parallel dashboard/stats queries; dynamic heavy production/estadísticas chunks; route skeletons
- **Still open:** production `limit=all` operational window, estadísticas SQL date aggregation, config tab split, middleware auth reuse
- **Phase:** finish remaining query bounds without hiding active orders

## Phase 2 queue (finish)

1. Invoice email real send or honest error — `src/app/api/invoices/[id]/email/route.ts`
2. Tilopay: token cache (`api/tilopay/auth`), webhook hash verify (`lib/tilopay.ts`, `webhook`, `webhook-repeat`), failed-payment email TODO
3. Billing storage real metric or remove fake `0 MB` — `api/billing/usage`
4. ~~Deployment~~ removed in Phase 0 orphan purge

## Phase 3 (later)

Parallel domain bug scouts with reproduction evidence; no drive-by refactors.
