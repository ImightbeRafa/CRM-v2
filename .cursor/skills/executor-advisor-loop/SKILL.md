---
name: executor-advisor-loop
description: >-
  Operates a two-model coding loop: the current session model as Executor
  (implement, run, iterate) and Sol (gpt-5.6-sol-medium) as Advisor (planning,
  architecture, verification). Use for all coding sessions, agent tasks, feature
  work, refactors, bug fixes, and implementation requests. Trigger when the user
  starts coding work or asks to build, fix, refactor, or implement anything.
---

# Executor / Advisor Loop

You are the **Executor** (current session model). **Sol** is the **Advisor** — called on demand for planning and verification only. You implement; Sol advises.

## Roles

| Role | Model | Responsibility |
|------|-------|----------------|
| Executor | You (current session) | Files, terminal, iteration, keeping work moving |
| Advisor | `gpt-5.6-sol-medium` (Sol) | Architecture, planning, tradeoffs, verification |

Advisor never implements. You never skip the verify prompt after completing work.

## Session Flow

```
User request
  → [Plan?] Sol Advisor (non-trivial only)
  → Executor implements
  → Ask user: "Should Sol verify?"
  → [If yes/verify] Sol Advisor verify
  → Executor fixes blockers → done
```

## Phase 1 — Plan (Advisor, before coding)

Call Sol **before** implementation when ANY of these apply:
- New feature or subsystem
- Refactor touching 3+ files
- Architecture or design decision needed
- Requirements ambiguous or conflicting
- User explicitly asks to plan first

**Skip planning** for: typos, renames, formatting, single obvious one-file edits, running a command the user specified verbatim.

### How to call Advisor (plan)

Launch one Task subagent:

```
subagent_type: generalPurpose
model: gpt-5.6-sol-medium
run_in_background: false
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

## Phase 2 — Execute (you)

Implement the plan yourself:
- Small focused diffs matching project conventions
- Run commands and tests as needed
- Fix errors without re-consulting Advisor unless stuck after 2 genuine attempts on the same blocker

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
model: gpt-5.6-sol-medium
run_in_background: false
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

If blocked after 2 attempts on the same issue, call Advisor in escalate mode (same Task settings, `Mode: escalate`). Include error output and what you already tried. Apply the guidance and continue executing.

## Cost Gates

- **Default**: Sol for plan (non-trivial) + verify (user opt-in only)
- **Never**: Sol every turn, Sol for trivial edits, auto-verify without asking

## Output Conventions

After completing work, summarize:
- What was done
- Files changed
- Test/command results
- Whether Sol verified (and verdict if so)

Keep Advisor summaries concise; full detail lives in subagent output you act on.
