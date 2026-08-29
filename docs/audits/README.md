# Codebase Audits (Agent-Maintained)

Living ledgers for the slim → structure → finish → bug-hunt program. **Agents must update these files after every meaningful slice.**

## Ledgers

| File | Purpose |
|------|---------|
| [SAFETY_GATES.md](./SAFETY_GATES.md) | Delete classes, hard stops, prove commands |
| [PHASE0_DEAD_CODE.md](./PHASE0_DEAD_CODE.md) | Removed / quarantined / keep inventory |
| [PHASE1_STRUCTURE_WIP.md](./PHASE1_STRUCTURE_WIP.md) | Unfinished work + structure plan |
| [CHANGELOG_AGENTS.md](./CHANGELOG_AGENTS.md) | Append-only agent process and fix notes |
| [BETSY_V2_LOCAL_RELEASE.md](./BETSY_V2_LOCAL_RELEASE.md) | Per-slice implementation and safety ledger |
| [BETSY_V2_RELEASE_REPORT.md](./BETSY_V2_RELEASE_REPORT.md) | Integrated local release evidence and rollout gates |

## How agents update

After each slice (delete, quarantine seed, tooling change, finish/fix):

1. Move items between **Removed**, **Quarantine**, and **Keep** in Phase 0 as needed.
2. Add or close workstreams in Phase 1 when structure/WIP status changes.
3. Append one short entry to `CHANGELOG_AGENTS.md` (date, branch/PR, what changed, prove commands run).
4. Never rewrite history of prior changelog entries — append only.

## Commands

```bash
npm run audit:dead    # knip inventory (non-blocking)
npm run lint
npm run build
npm run test:backups
npm run test:bot-grok
```

## Orchestration

Use Cursor command `/codebase-audit` and skill `.cursor/skills/executor-advisor-loop/SKILL.md`.
Sol (`gpt-5.6-sol-high`) plans and safety-gates; the parent session dispatches parallel read-only scouts and applies deletes serially.

## Status values

- `SAFE_DELETE` — proven unused / non-product; may auto-remove under conservative policy
- `QUARANTINE` — needs human OK before delete or finish
- `KEEP` — intentional; do not remove
- `WIP` — incomplete feature; track in Phase 1 / finish in Phase 2
