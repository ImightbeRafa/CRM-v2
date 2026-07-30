# Phase 0 — Dead Code Inventory

Status legend: `REMOVED` | `QUARANTINE` | `KEEP` | `PENDING_KNIP`

## Removed (kickoff + orphan purge)

| Item | Evidence | Status |
|------|----------|--------|
| Stale `package.json` scripts (19 missing-target scripts) | Target files missing under `scripts/` | REMOVED |
| `src/app/test-phase2/` | No inbound product references | REMOVED |
| `src/app/sentry-example-page/` + `src/app/api/sentry-example-api/` | Sentry sample scaffolding | REMOVED |
| `src/app/landing/` (entire tree) | Orphan fork; `/` redirects to `/home`; no nav inbound | REMOVED |
| `src/app/deployment/` (entire tree) | Orphan; missing `/api/deployment/*`; no nav | REMOVED |
| `src/lib/correosAutomation.ts` | No importers; live Correos is `src/lib/correos/` | REMOVED |
| `src/lib/auth.ts` | Unused `validateSession`; app uses `auth-helpers` / `auth-options` | REMOVED |
| `src/lib/instagram-oauth.ts` | Superseded by `api/auth/instagram/auth-url` | REMOVED |
| `src/lib/dom-protection.ts` | No consumers | REMOVED |
| `src/templates/integration-snippet.ts` | Unserved template | REMOVED |
| `src/lib/bot/index.ts` | Unused barrel; submodules imported directly | REMOVED |
| Setup-wizard legacy steps (8 files) | Superseded by current `SetupWizard` steps | REMOVED |
| `ProduccionDashboard.tsx` + `OrderList.tsx` | Orphan island; page uses `EnhancedProductionDashboard` | REMOVED |
| UI leftovers (`MotionButton`, `skeletons`, `StatusFeedback`, `toaster`, `ProfileCompletionModal`, `QuickSetupWizard`, `useCurrency`, `useMobile`, empty `orderUtils`, `mdx/index.ts`, `sales/stream/types.ts`) | No consumers | REMOVED |
| `@types/bcryptjs` | `bcryptjs@3` ships types | REMOVED |
| Stale `/landing` refs in middleware, SubscriptionBanner, FeedbackWidget, DOCUMENTATION | Cleaned with landing delete | REMOVED |

## Quarantine (remaining)

| Item | Why | Revisit |
|------|-----|---------|
| Knip unused exports (165) / types (30) | High false-positive rate (UI kit barrels, bot tools) | Export cleanup later — not file deletes |
| Unlisted deps: `xlsx`, `uuid` | Used but missing from package.json | Add to dependencies in hygiene PR |
| External entry APIs (webhooks, Tilopay, cron, bot) | External callers | Never delete from Knip alone |

## Keep

| Item | Reason |
|------|--------|
| `/home` | Canonical public landing (`/` redirects here) |
| `@sentry/nextjs`, instrumentation | Real error monitoring |
| `sharp` | Next image optimization |
| `db:push` / `safe-db-push.mjs` / `db:push:unsafe` | DB tooling (unsafe = break-glass, not Phase 0 removal) |
| Live `src/lib/correos/`, auth-helpers, auth-options, bot submodules | Actively used |
| shadcn/ui unused named exports | Design-system barrels until deliberate UI prune |

## Knip runs

**2026-07-30 first run (pre-purge):** Unused files 27 · unused exports 165 · unused deps `sharp` · unused devDep `@types/bcryptjs`.

**2026-07-30 post-orphan-purge:** Unused files **0** · unused exports 165 (export cleanup later) · unused dep `sharp` (kept — Next image) · unlisted `xlsx`/`uuid` (hygiene follow-up).
