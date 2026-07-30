# Phase 1 — Structure & WIP

Organize unfinished work so Phase 2 can finish items deliberately. Seeded at kickoff; agents update as discovery continues.

## Workstreams

### W1 — Landing / marketing dedupe
- **Status:** WIP / QUARANTINE
- **Paths:** `src/app/home`, `src/app/landing`
- **Need:** Canonical public landing route; remove or merge duplicate component trees
- **Blocked on:** Human decision

### W2 — Deployment dashboard
- **Status:** WIP / broken
- **Paths:** `src/app/deployment/page.tsx`, `src/app/deployment/components/DeploymentDashboard.tsx`
- **Issue:** Fetches `/api/deployment/checklist`, `/api/deployment/backup`, `/api/deployment/rollback` which do not exist
- **Options:** Implement APIs, or remove UI (quarantine until human OK)

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

### W8 — Knip unused-file triage (after human OK)
- Legacy setup-wizard steps (superseded) — likely first SAFE_DELETE batch
- `ProduccionDashboard` / `OrderList` orphan pair
- Small UI leftovers (`MotionButton`, skeletons, etc.)
- **Do not** start with `correosAutomation.ts`, `instagram-oauth.ts`, or auth wrappers

### W9 — Dependency hygiene
- Decide on `sharp` / `@types/bcryptjs`
- Add missing `uuid` (and `xlsx` if script kept) to package.json

## Phase 2 queue (finish)

1. Invoice email real send or honest error — `src/app/api/invoices/[id]/email/route.ts`
2. Tilopay: token cache (`api/tilopay/auth`), webhook hash verify (`lib/tilopay.ts`, `webhook`, `webhook-repeat`), failed-payment email TODO
3. Billing storage real metric or remove fake `0 MB` — `api/billing/usage`
4. Deployment: implement or delete (after human OK)

## Phase 3 (later)

Parallel domain bug scouts with reproduction evidence; no drive-by refactors.
