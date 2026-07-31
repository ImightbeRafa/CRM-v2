# Agent Changelog

Append-only. Newest entries at the top.

<<<<<<< HEAD
## 2026-07-30 — orphan purge (human OK: delete all except explicitly used)

- Deleted orphan routes: `/landing`, `/deployment`.
- Deleted orphan libs/templates: `correosAutomation.ts`, `auth.ts`, `instagram-oauth.ts`, `dom-protection.ts`, `integration-snippet.ts`, `bot/index.ts`.
- Deleted 8 legacy setup-wizard steps; produccion orphan pair; UI leftovers listed in Phase 0.
- Removed `@types/bcryptjs`; kept `sharp` and `/home`.
- Cleaned `/landing` refs in middleware, SubscriptionBanner, FeedbackWidget, DOCUMENTATION.
- Prove: lint pass, test:backups 8/8, test:bot-grok pass, build pass, knip unused files 0.
=======
## 2026-07-30 — logistics mobile layout (branch `cursor/logistics-mobile-layout-cb22`)

- Fixed logistics shell on ≤768px: column flex + `100dvh`, main content no longer clipped by horizontal overflow.
- Replaced crowded horizontal mobile nav with compact header + accessible drawer (`LogisticsMobileNav`).
- Made Tablero de Envíos stack “Sin Asignar” above Kanban boards; swipeable columns; archive/verify forms wrap on narrow screens.
- Dashboard stats use 2 columns on mobile; loading shell no longer forces full viewport height inside main.
>>>>>>> origin/dev

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
