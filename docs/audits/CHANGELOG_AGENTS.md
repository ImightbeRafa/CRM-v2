# Agent Changelog

Append-only. Newest entries at the top.

## 2026-08-03 — workforce clock reliability hardening

- Read-only production forensic check: one Lau employee, one valid open entry, no
  duplicate open entries, and `lm_time_entries_one_open_per_employee` is installed.
  The final code regeneration was followed by a successful clock-in six seconds later.
- Root cause confirmed: the older blank-clock-out row was voided (twice), so it was not
  a live open entry; the UI incorrectly displayed the contradictory `Open` / `Voided`
  state. Five code rotations in four minutes also invalidated the prior codes in sequence.
- Centralized time-entry state precedence (`voided` > `completed` > `open`); added an
  explicit audited Restore operation, blocked edits of voided rows, prevented restoring
  an open-shaped void when another live open entry exists, and made repeat Void a no-op.
- Serialized punch/admin mutations by locking the employee row. Clock-out uses guarded
  predicates plus the expected entry id; retries replay the original state without
  changing timestamps or duplicating audits.
- Worker UI binds punch actions to the validated code, clears stale identity state when
  the input changes, consumes the punch response directly, and uses Costa Rica display
  time. Lookup now distinguishes invalid credentials from operational 503 failures.
- Code rotation and audit are atomic and optimistic-versioned; the UI is single-flight.
  Added a production warning and deployment documentation for a stable
  `EMPLOYEE_CODE_SECRET` compatibility rollout.
- Split shared-IP lookup/punch limits (60/120 per 15 minutes) and removed the third
  post-punch lookup. Unignored the workforce schema migration so the critical partial
  unique index can be source-controlled.
- Prove: focused ESLint pass; workforce state, code, and datetime tests pass. Next debug
  build compiles the workforce changes, then fails on the pre-existing
  `@vercel/blob` `get` / `BlobAccessType` imports in `src/lib/backups/blob-store.ts`.

## 2026-07-31 — personnel time-clock timezone corrections (branch `cursor/fix-personnel-time-clock-472f`)

- Root cause: Time Clock admin corrections sent bare `datetime-local` strings; UTC server
  interpreted them as UTC, shifting Costa Rica wall times by 6 hours on save/reload.
- Added browser-safe `src/lib/workforce-datetime.ts` (CR display, datetime-local ↔ ISO).
- API `parseClockTimestamp` now requires explicit timezone; empty clock-out clears/reopens.
- PATCH void/correct + audit are atomic; punch in/out + audit likewise.
- Workforce UI: CR-formatted inputs/display, ISO submit, save guard, stale week fetch ignore,
  Next week advances from selected week; coverage actuals use CR slot bounds.
- Prove: `npm run test:workforce-datetime`, lint, build.

## 2026-07-30 — orphan purge (human OK: delete all except explicitly used)

- Deleted orphan routes: `/landing`, `/deployment`.
- Deleted orphan libs/templates: `correosAutomation.ts`, `auth.ts`, `instagram-oauth.ts`, `dom-protection.ts`, `integration-snippet.ts`, `bot/index.ts`.
- Deleted 8 legacy setup-wizard steps; produccion orphan pair; UI leftovers listed in Phase 0.
- Removed `@types/bcryptjs`; kept `sharp` and `/home`.
- Cleaned `/landing` refs in middleware, SubscriptionBanner, FeedbackWidget, DOCUMENTATION.
- Prove: lint pass, test:backups 8/8, test:bot-grok pass, build pass, knip unused files 0.

## 2026-07-30 — logistics mobile layout (branch `cursor/logistics-mobile-layout-cb22`)

- Fixed logistics shell on ≤768px: column flex + `100dvh`, main content no longer clipped by horizontal overflow.
- Replaced crowded horizontal mobile nav with compact header + accessible drawer (`LogisticsMobileNav`).
- Made Tablero de Envíos stack “Sin Asignar” above Kanban boards; swipeable columns; archive/verify forms wrap on narrow screens.
- Dashboard stats use 2 columns on mobile; loading shell no longer forces full viewport height inside main.

## 2026-07-30 — kickoff (branch `cursor/codebase-slim-agent-os-1e77`)

- Upgraded `.cursor/skills/executor-advisor-loop/SKILL.md` to Sol-orchestrated multi-agent loop (`gpt-5.6-sol-high`); parent dispatches parallel read-only scouts; serial deletes; safety gates.
- Added `.cursor/commands/codebase-audit.md`.
- Created `docs/audits/` ledgers (Phase 0, Phase 1, safety gates, this changelog).
- Added `knip` + `npm run audit:dead` (non-blocking).
- Removed stale `package.json` scripts pointing at missing files.
- Deleted `src/app/test-phase2`, `src/app/sentry-example-page`, `src/app/api/sentry-example-api`.
- Seeded quarantine: home/landing dup, deployment, external APIs, Tilopay/invoice/billing TODOs.
- Prove: `npm run lint` (pass, pre-existing warnings), `npm run test:backups` (8/8),
  `npm run test:bot-grok` (pass), `npm run audit:dead` (inventory only),
  `npm run build` (pass with `OPENAI_API_KEY` placeholder — import-time OpenAI client in
  WhatsApp webhook is a pre-existing env requirement at build collect time).
