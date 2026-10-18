---
name: executor-advisor-loop
description: Claude Code version of Betsy's Executor/Advisor loop — main session executes, `advisor` (Opus, high) plans and gates, `verifier` (Opus, extra-high) reviews, `securedog` (Opus, max) does security review, `scout` (Sonnet) fans out read-only searches. Use for feature work, bug fixes, merges, refactors, audits and release readiness in this repo.
---

# Executor / Advisor loop (Claude Code)

Same process as `.cursor/skills/executor-advisor-loop/SKILL.md`, mapped to Claude Code
subagents. The main session is the **Executor**: the only writer. Subagents never edit.

```
request
 → trivial?  → just do it → prove → done
 → Plan: advisor (Mode: plan)            [non-trivial only]
 → Scout: parallel `scout`s, non-overlapping paths   [only when the map is unknown]
 → Execute: main session, small serial slices, prove after each
 → Verify: `verifier` on the diff        [every non-trivial slice, automatic]
 → Security: `securedog`                  [new/changed routes, auth, middleware, webhooks, before prod]
 → fix findings → re-prove → ledger → report
```

## When to call what

| Situation | Call |
|---|---|
| New feature, 3+ files, cross-branch merge, auth/billing/chat/WhatsApp/logistics logic, unclear requirements | `advisor` Mode: plan |
| Any delete batch or risky data-path change | `advisor` Mode: safety |
| Same blocker failed twice | `advisor` Mode: escalate (include error + attempts) |
| "Where is X / who calls Y / inventory domain Z" | 1–4 `scout`s in parallel, each owning distinct paths |
| Slice finished (non-trivial) | `verifier` with base ref, goal, files, proof output |
| Release candidate or new API/auth surface | `securedog` with base ref |

Skip the Advisor for typos, copy tweaks, single obvious one-file fixes, and commands the
user dictated verbatim. Never call subagents every turn.

## Prompts

Advisor: `Mode: plan|safety|escalate` · `Task:` one sentence · `Context:` branch, base,
key paths, constraints · what you need back.

Verifier: `Goal:` · `Base ref:` · `Changed:` bullets + files · `Proof:` commands and
results (baseline failures labeled) · `Focus:` the riskiest part.

## Execute rules

- Worktree or branch per task; never commit to `dev`. Draft PRs. No merge without Rafael GO.
- Small slices; after each: `npx tsc --noEmit` (compare to baseline), `npm run lint`,
  relevant `npm run test:*`. Before a PR: `npm run build`.
- If a proof fails: fix or revert the slice — never pile forward.
- UI changes need eyes: preview/browser check (see `.cursor/skills/verify-betsy/SKILL.md`),
  desktop and 390 px mobile. Preview shares the prod DB: avoid writes, clean up test data.
- Hard stops from `docs/audits/SAFETY_GATES.md` and AGENTS.md always apply.

## Report

What changed · files · proof results (new vs baseline) · verifier / securedog verdicts ·
ledger updated (`docs/audits/CHANGELOG_AGENTS.md`) · what still needs Rafael.
