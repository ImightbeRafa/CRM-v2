/**
 * DeepSleep "no weight asks" (2026-11-03) — surgical, idempotent data apply on the live Forge agent.
 *
 * Swaps the exact sentences in scripts/lib/deepsleep-no-weight-edits.ts (owner answers 2, 3, 5: never ask weight or
 * height; if the customer gives it, say the size from the guide; between two sizes the bigger one; back pain is
 * answered with care, no handoff) on: Forge systemInstructions, saved replies fg_tallas / fg_dolor, three bound
 * knowledge sources, brandFacts "Elegir talla" and four selling-rule fields. Everything else in those texts stays.
 * Applied live 2026-11-04 08:06 CR. Its mismatch sentences now carry the 2026-11-04 "weight decides" text, so a re-run
 * after deepsleep-weight-decides-apply.ts is a no-op, and a re-run before it refuses (conflict, exit 1, no write).
 *
 * Safety (see deepsleep-text-edit-engine.ts): live read first, exact sentence once or already swapped, any conflict or
 * cap → exit 1 with no write; default dry-run; --apply writes a backup first; wrong tenant refused.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-no-weight-apply.ts --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     [--apply] [--backup-dir=scripts/agent-pack/out] [--actor-email=rafa.work0412@gmail.com]
 *
 * Revert: scripts/agent-pack/deepsleep-no-weight-revert.ts --backup=<that json>.
 */
import {
  NO_WEIGHT_ACTOR_EMAIL,
  NO_WEIGHT_AGENT_ID,
  NO_WEIGHT_BRAND_FACT_EDITS,
  NO_WEIGHT_INSTRUCTION_EDITS,
  NO_WEIGHT_KNOWLEDGE_EDITS,
  NO_WEIGHT_SALES_RULE_EDITS,
  NO_WEIGHT_SHORTCUT_EDITS,
} from '../lib/deepsleep-no-weight-edits'
import { runMain, runTextEditApply } from './deepsleep-text-edit-engine'

runMain(() =>
  runTextEditApply({
    kind: 'deepsleep-no-weight',
    title: 'DeepSleep no-weight apply',
    agentId: NO_WEIGHT_AGENT_ID,
    actorEmail: NO_WEIGHT_ACTOR_EMAIL,
    applyScript: 'deepsleep-no-weight-apply',
    revertScript: 'deepsleep-no-weight-revert',
    instructions: NO_WEIGHT_INSTRUCTION_EDITS,
    shortcuts: NO_WEIGHT_SHORTCUT_EDITS,
    knowledge: NO_WEIGHT_KNOWLEDGE_EDITS,
    brandFacts: NO_WEIGHT_BRAND_FACT_EDITS,
    salesRules: NO_WEIGHT_SALES_RULE_EDITS,
  }),
)
