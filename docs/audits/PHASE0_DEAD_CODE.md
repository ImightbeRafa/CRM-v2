# Phase 0 — Dead Code Inventory

Status legend: `REMOVED` | `QUARANTINE` | `KEEP` | `PENDING_KNIP`

## Removed (this kickoff)

| Item | Evidence | Status |
|------|----------|--------|
| Stale `package.json` scripts (`setup`, `verify`, `test:flow`, `test:registration`, `test:tilopay`, `test:webhook`, `upgrade:plan`, `check:trials`, `check:tenant`, `set:trial-expired`, `check:billing`, `create:test-user`, `reset:user`, `reset:test-users`, `delete:test-users`, `seed:statuses`, `ensure:defaults`, `cleanup:tests`, `test:correos-ws`) | Target files missing under `scripts/` | REMOVED |
| `src/app/test-phase2/` | No inbound product references; integration-test page | REMOVED |
| `src/app/sentry-example-page/` | Sentry sample scaffolding; only calls sentry-example-api | REMOVED |
| `src/app/api/sentry-example-api/` | Sentry sample API; only used by example page | REMOVED |

## Quarantine (needs human OK — do not delete yet)

| Item | Why quarantined | Revisit criteria |
|------|-----------------|------------------|
| `src/app/home` vs `src/app/landing` duplicate trees | Both product-facing marketing surfaces; need canonical route decision | Human picks keep/merge/delete one tree |
| `src/app/deployment` | Authenticated UI calling missing `/api/deployment/*` — finish or remove? | Human: keep+implement APIs, or delete page |
| External entry risk APIs (webhooks, Tilopay, cron, bot) | May be unused in-repo but called externally | Never delete from Knip alone |
| `src/lib/correosAutomation.ts` | Knip unused file; large logistics automation (likely dynamic/future use) | Human + domain audit before any delete |
| `src/lib/auth.ts` | Knip unused; thin `validateSession` wrapper — auth-adjacent | Human OK; prefer keep unless proven obsolete vs `auth-helpers` |
| `src/lib/instagram-oauth.ts` | Knip unused; Meta/Instagram integration | External-entry risk — keep until product decision |
| `src/lib/dom-protection.ts` | Knip unused; client resilience helper | Prove no dynamic import; then SAFE_DELETE candidate |
| `src/templates/integration-snippet.ts` | Knip unused template | Confirm not served to customers |
| Setup-wizard legacy steps (`WelcomeStep`, `BusinessInfoStep`, `CustomFieldsStep`, `FrequentClientsStep`, `FrequentProductsStep`, `InventoryStep`, `SellersStep`, `ShippingStep`) | Superseded by `WelcomeBusinessStep` / `OrderStatusStep` / etc. in `SetupWizard.tsx` | Likely SAFE_DELETE after human OK |
| `ProduccionDashboard.tsx` + `OrderList.tsx` | Only reference each other; page uses other components | Confirm `/produccion` does not need them; then SAFE_DELETE |
| UI leftovers (`MotionButton`, `skeletons`, `StatusFeedback`, `toaster`, `ProfileCompletionModal`, `QuickSetupWizard`, `useCurrency`, `useMobile`, `orderUtils`, mdx index, sales stream types, `bot/index.ts`) | Knip unused files; product-adjacent | Per-item prove + Sol SAFE_DELETE |
| Knip unused exports (165) / types (30) | High false-positive rate (UI kit barrels, bot tools, backups) | Export cleanup later; not kickoff deletes |
| `sharp` unused dep; `@types/bcryptjs` unused devDep | May be Next/transitive intentional | Confirm Next image / bcrypt typing before remove |
| Unlisted deps: `xlsx` (script), `uuid` (auth/email) | Missing from package.json but used | Add to dependencies in a later hygiene PR — do not delete callers |

## Keep

| Item | Reason |
|------|--------|
| `@sentry/nextjs`, instrumentation, production Sentry config | Real error monitoring — not sample pages |
| `db:push` / `scripts/safe-db-push.mjs` | Required safety wrapper |
| `db:push:unsafe` | Dangerous but intentional break-glass; do not remove in Phase 0 (see Phase 1 safety follow-up) |
| Backup / bot test scripts that exist | Real coverage |
| shadcn/ui unused named exports | Design-system barrels; keep until deliberate UI prune |

## Knip first run (2026-07-30)

Command: `npm run audit:dead` (`knip --no-exit-code`)

Summary counts:
- Unused files: **27** (listed under Quarantine; none auto-deleted)
- Unused dependencies: **1** (`sharp`)
- Unused devDependencies: **1** (`@types/bcryptjs`)
- Unlisted dependencies: **3** (`xlsx`, `uuid`×2)
- Unused exports: **165**
- Unused exported types: **30**
- Duplicate exports: **1** (`OptionSetsManager` default)

Treat Knip output as **leads, not proof**. Next App Router entrypoints and dynamic/integration code produce false positives.
