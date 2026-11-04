/**
 * DeepSleep "weight decides" (2026-11-04) — surgical, idempotent data apply on the live Forge agent, on top of
 * deepsleep-no-weight-apply.ts (applied 08:06 CR). Sentences: scripts/lib/deepsleep-weight-decides-edits.ts.
 *
 * Changes only: KB "ForgeCR · Preguntas frecuentes" and "ForgeCR · Arnés" (mismatch → weight decides; sold out → the
 * closest size up), brandFacts "Elegir talla" and one salesRules.neverSay item. With --drop-mismatch-handoff (owner's
 * yes pending) also salesRules.objections "Fuera de la tabla…" and handoffWhen "estatura y peso muy distintos".
 * Leaves alone: instructions, saved replies, shipping, payment, washing, colors, Correos/order data, follow-ups,
 * every other KB, rule and agent.
 *
 * Safety (deepsleep-text-edit-engine.ts): live read first; each sentence exactly once or already swapped; any conflict
 * or cap → exit 1, no write; default dry-run; --apply writes a backup first and re-checks each value before saving;
 * wrong tenant refused.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-weight-decides-apply.ts --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     [--drop-mismatch-handoff] [--apply] [--backup-dir=scripts/agent-pack/out] [--actor-email=rafa.work0412@gmail.com]
 *
 * Revert: scripts/agent-pack/deepsleep-weight-decides-revert.ts --backup=<that json>.
 */
import { WEIGHT_DECIDES_ACTOR_EMAIL, WEIGHT_DECIDES_AGENT_ID, weightDecidesEdits } from '../lib/deepsleep-weight-decides-edits'
import { runMain, runTextEditApply } from './deepsleep-text-edit-engine'

const dropMismatchHandoff = process.argv.includes('--drop-mismatch-handoff')

runMain(() =>
  runTextEditApply({
    kind: 'deepsleep-weight-decides',
    title: `DeepSleep weight-decides apply${dropMismatchHandoff ? ' (+ --drop-mismatch-handoff)' : ''}`,
    agentId: WEIGHT_DECIDES_AGENT_ID,
    actorEmail: WEIGHT_DECIDES_ACTOR_EMAIL,
    applyScript: 'deepsleep-weight-decides-apply',
    revertScript: 'deepsleep-weight-decides-revert',
    ...weightDecidesEdits({ dropMismatchHandoff }),
  }),
)
