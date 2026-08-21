# Safety Gates

Hard rules for unsupervised slim / structure / finish work on Betsy CRM (real users, shared Supabase).

## Delete classes

| Class | Autopilot | Examples |
|-------|-----------|----------|
| Provably dead scaffolding | Yes (conservative) | Stale npm scripts to missing files, Sentry example pages, `test-phase2` |
| Unused export / file (Knip) | No — ledger only until proven + Sol SAFE_DELETE | Library helpers, components |
| Product-facing UI/API | Quarantine — human OK required | `/home` vs `/landing`, `/deployment`, public marketing |
| External entrypoints | Keep / never static-delete | Webhooks, Tilopay, cron, bot, Correos |
| Auth / billing / backup core | Out of scope for Phase 0 | NextAuth, Tilopay charge paths, backup cron |

## Hard stops (never)

1. `prisma db push` / `prisma migrate` against Supabase or shared DB
2. `--accept-data-loss` or any command that drops `lm_*` tables
3. Speculative `lm_*` / logistics schema edits (tables are **not** in Prisma schema)
4. Auth, billing, or backup **behavior** changes during dead-code phases
5. Deleting webhook / cron / bot / Tilopay routes because Knip says unused
6. Parallel destructive file deletes
7. Continuing after a failed prove without reverting the slice

## Prove after every apply slice

```bash
npm run lint
npm run build
npm run test:backups
npm run test:bot-grok
```

Optional inventory (non-blocking):

```bash
npm run audit:dead
npm run kb:check    # if the slice added/removed routes, Prisma models, or lm_* tables
```

## Sol safety gate

Before any delete batch, Sol (`gpt-5.6-sol-high`) must classify each item:

`SAFE_DELETE` | `QUARANTINE` | `KEEP`

Only `SAFE_DELETE` may be applied without human OK.

## Database reminder

`DATABASE_URL` / `DIRECT_URL` point at shared Supabase. Use `npm run db:push` only via `scripts/safe-db-push.mjs` on disposable local DBs. Prefer never running DB push in audit phases. `db:push:unsafe` exists but must not be used against shared Supabase — track as safety follow-up, not a Phase 0 removal.
