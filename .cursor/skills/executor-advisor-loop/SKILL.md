---
name: executor-advisor-loop
description: >-
  Operates a Sol-orchestrated Executor/Advisor loop: the current session model
  as Executor (implement, run, iterate, dispatch parallel read-only scouts) and
  Sol (gpt-5.6-sol-high) as Advisor/orchestrator (planning, architecture,
  verification, delete gating). Use for all coding sessions, agent tasks,
  feature work, refactors, bug fixes, audits, and implementation requests.
  Trigger when the user starts coding work or asks to build, fix, refactor,
  audit, or implement anything.
---

# Executor / Advisor Loop (Sol-Orchestrated)

You are the **Executor** (current session model). **Sol** (`gpt-5.6-sol-high`) is the **Advisor / Orchestrator** — planning, architecture, verification, and delete gating only. You implement and dispatch workers; Sol never implements.

**Important:** Sol cannot recursively spawn workers. The **parent session (you)** coordinates Task subagents. Sol plans, decomposes, merges findings, and verifies; you fan out bounded parallel scouts and apply approved slices serially.

## Roles

| Role | Model / type | Responsibility |
|------|----------------|----------------|
| Executor (parent) | You (current session) | Files, terminal, iteration, dispatching parallel read-only scouts, applying approved slices |
| Sol Orchestrator / Advisor | `gpt-5.6-sol-high` via Task | Architecture, planning, tradeoffs, merge findings, gate deletes, verification |
| Dead-code scout | `explore` or `generalPurpose` | Unused exports, routes, deps (`knip` + grep); read-only |
| Domain auditors | `explore` (parallel) | Bounded ownership: `ventas`, `logistics`, `bot`, `billing/config` |
| Safety reviewer | Sol verify mode | Diff gate: safe to delete? data/auth/billing risk? |
| Doc scribe | `generalPurpose` | Keep `docs/kb/` architecture + `docs/audits/` ledgers + AGENTS process notes current |
| CI / smoke | shell + `ci-watcher` when PR exists | Prove green after each apply |

Advisor/scouts never implement product changes. You never skip the verify prompt after completing work.

## Session Flow

```
User request
  → [Plan?] Sol Advisor (non-trivial only)
  → [Audit?] Parent fans out parallel read-only scouts (non-overlapping ownership)
  → Sol merges findings → quarantine vs safe-delete
  → Executor applies approved slices SERIALLY
  → Prove: lint + build + tests + `npm run kb:check` if routes/schema changed
  → Doc scribe updates docs/kb (if architecture changed) and docs/audits/
  → Ask user: "Should Sol verify?"
  → [If yes/verify] Sol Advisor verify
  → Executor fixes blockers → done
```

## Parallelism rules

- **Parallel only for read-only audit** (scouts, domain auditors, inventory).
- **Serial for destructive applies** (deletes, renames that break imports, script removals).
- Non-overlapping file ownership per scout. No nested delegation (scouts do not spawn more agents).
- Fan-out default: up to 4 domain auditors + 1 dead-code scout. Merge before any delete.

## Hard stops (never do)

- `prisma db push` / `prisma migrate` against Supabase or any shared DB
- `--accept-data-loss` or anything that drops `lm_*` tables
- Speculative edits to logistics/`lm_*` schema
- Auth, billing, or backup **behavior** changes during dead-code / slim phases
- Deleting webhooks, Tilopay, cron, or bot entrypoints from static “unused” alone
- Blanket Knip suppressions or deleting App Router files solely because Knip flagged them
- Mass-delete of quarantine items without explicit human OK

See `docs/audits/SAFETY_GATES.md`.

## Phase 1 — Plan (Advisor, before coding)

Call Sol **before** implementation when ANY of these apply:
- New feature or subsystem
- Refactor touching 3+ files
- Architecture or design decision needed
- Requirements ambiguous or conflicting
- Codebase audit / dead-code / structure phases
- User explicitly asks to plan first

**Skip planning** for: typos, renames, formatting, single obvious one-file edits, running a command the user specified verbatim.

### How to call Advisor (plan)

Launch one Task subagent:

```
subagent_type: generalPurpose
model: gpt-5.6-sol-high
description: "Advisor — plan"
```

Prompt shape:

```text
Role: Advisor — architecture and planning only. Do not implement.

Mode: plan

Task: [user goal in one sentence]

Repo context:
- Stack: [languages, frameworks]
- Key paths: [relevant dirs/files]
- Constraints: [from user or codebase]

Return:
1. Assessment (2-3 sentences)
2. Recommended approach
3. File-level action list (ordered steps)
4. Test plan
5. Risks / open questions
```

Present Sol's plan briefly to the user, then proceed unless they redirect.

## Phase 1b — Orchestrated audit (optional)

When the user asks for dead-code audit, slim-down, structure WIP, or `/codebase-audit`:

1. Call Sol in plan mode to define scout ownership and delete classes.
2. Parent launches parallel read-only scouts with bounded paths.
3. Parent (or doc scribe) writes findings into `docs/audits/PHASE0_DEAD_CODE.md` and `docs/audits/PHASE1_STRUCTURE_WIP.md`.
4. Call Sol in **safety** mode before any delete batch:

```text
Role: Advisor — safety gate only. Do not implement.

Mode: safety

Proposed deletes:
- [paths + evidence]

Return for each item: SAFE_DELETE | QUARANTINE | KEEP
Reason + residual risk.
```

5. Executor applies only `SAFE_DELETE` items, one concern per commit when practical.
6. After each slice: `npm run lint`, `npm run build`, `npm run test:backups`, `npm run test:bot-grok`.
7. If prove fails: revert the slice; do not pile forward. Escalate to Sol after 2 failures.

## Phase 2 — Execute (you)

Implement the plan yourself:
- Small focused diffs matching project conventions
- Run commands and tests as needed
- Fix errors without re-consulting Advisor unless stuck after 2 genuine attempts on the same blocker
- Update `docs/audits/CHANGELOG_AGENTS.md` after each meaningful slice

Do not call Sol mid-implementation for routine fixes.

## Phase 3 — Verify prompt (mandatory)

After implementation is complete (or the scoped slice of work is done), **always ask the user**:

> **Should Sol verify?** Reply **yes** or **verify** to have Sol review the implementation, or **no** / **skip** to finish without verification.

**Do not** launch Sol verification until the user confirms with yes, verify, or equivalent affirmative.

If the user already said "verify when done" or "yes verify" in the same message that scoped the work, treat that as confirmation and proceed directly to Phase 4.

## Phase 4 — Verify (Advisor, on user confirmation)

When the user says yes or verify:

Launch one Task subagent:

```
subagent_type: generalPurpose
model: gpt-5.6-sol-high
description: "Advisor — verify"
```

Prompt shape:

```text
Role: Advisor — verification only. Do not implement.

Mode: verify

Original task: [user goal]

What Executor implemented:
- [bullet summary of changes]
- Files touched: [list]

Evidence:
- [test results, linter output, or diff summary if available]

Return:
1. Verdict: PASS | PASS WITH NOTES | FAIL
2. Correctness assessment
3. Missing pieces or regressions
4. Specific fixes (file + action) if FAIL or PASS WITH NOTES
5. Residual risks
```

Apply Advisor fixes yourself. If verdict is FAIL, fix blockers and ask again: **Should Sol verify?**

## Phase 5 — Escalate (Advisor, when stuck)

If blocked after 2 attempts on the same issue, call Advisor in escalate mode (same Task settings, `Mode: escalate`). Include error output and what you already tried. Sol should re-scope rather than thrash. Apply the guidance and continue executing.

## Cost Gates

- **Default**: Sol for plan (non-trivial) + verify (user opt-in only) + safety gate before delete batches
- **Never**: Sol every turn, Sol for trivial edits, auto-verify without asking, parallel destructive applies

## Output Conventions

After completing work, summarize:
- What was done
- Files changed
- Test/command results
- Ledger updates under `docs/audits/`
- Whether Sol verified (and verdict if so)

Keep Advisor summaries concise; full detail lives in subagent output you act on.

## Architecture preflight (KB)

Before planning or implementing work that touches orders, auth, tenants, billing, bots, logistics, finance, workforce, or schema:

1. Read `docs/kb/README.md` then the relevant domain file (boundaries, auth, data ownership, order flow).
2. Treat `AGENTS.md` hard stops as non-negotiable (`prisma db push` against Supabase, `lm_*` drops, allowlist edits without a human).
3. After adding or removing App Router `page.tsx` / `route.ts`, Prisma models/enums, or `lm_*` `CREATE TABLE`: run `npm run kb:generate`, commit `docs/kb/generated/`, and update the curated file if behavior changed. `npm run kb:check` must stay clean.

Do not duplicate domain content in this skill. The KB is the map; this skill is the loop.

