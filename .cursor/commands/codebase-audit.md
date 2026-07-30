# Codebase Audit

Run a Sol-orchestrated codebase slim / structure audit for Betsy CRM.

## Goal

Phase 0 (dead code) and Phase 1 (structure WIP) discovery with **conservative** deletes. Keep production users and data safe.

## Procedure

1. **Read** `docs/audits/SAFETY_GATES.md` and `.cursor/skills/executor-advisor-loop/SKILL.md`.
2. **Plan (Sol):** Call Sol (`gpt-5.6-sol-high`) in plan mode. Define scout ownership and out-of-scope paths (auth/billing/backup/`lm_*`).
3. **Discover (parallel, read-only):** Parent session fans out:
   - Dead-code scout: `npm run audit:dead` + unused route/export grep
   - Domain auditors: `ventas`, `logistics`, `bot`, `billing/config` (non-overlapping)
4. **Classify** every finding into `SAFE_DELETE` | `QUARANTINE` | `KEEP`.
5. **Safety gate (Sol):** Before any delete batch, Sol returns SAFE_DELETE / QUARANTINE / KEEP per item.
6. **Apply serially:** Only SAFE_DELETE. One concern per commit when practical.
7. **Prove after each slice:**
   - `npm run lint`
   - `npm run build`
   - `npm run test:backups`
   - `npm run test:bot-grok`
   On failure: revert the slice; do not continue.
8. **Document:** Update `docs/audits/PHASE0_DEAD_CODE.md`, `PHASE1_STRUCTURE_WIP.md`, and append `CHANGELOG_AGENTS.md`.
9. **Ask:** Should Sol verify?

## Prohibitions

- No `prisma db push` / migrate against Supabase; never `--accept-data-loss`
- No deleting webhooks, Tilopay, cron, bot, or App Router entrypoints from Knip alone
- No quarantine deletes without explicit human OK
- No blanket Knip ignores for `src/app/**`
- No auth/billing/backup behavior changes in audit phases

## Outputs

- Updated ledgers under `docs/audits/`
- Draft PR against `dev` listing removals + quarantine callouts
