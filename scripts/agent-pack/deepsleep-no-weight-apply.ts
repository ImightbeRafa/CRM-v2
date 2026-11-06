/**
 * DeepSleep "no weight asks" (2026-11-03) — surgical, idempotent data apply on the live Forge agent.
 *
 * Swaps the exact sentences in scripts/lib/deepsleep-no-weight-edits.ts (owner answers 2, 3, 5: never ask weight or
 * height; if the customer gives it, say the size from the guide; between two sizes the bigger one; back pain is
 * answered with care, no handoff) on: Forge systemInstructions, saved replies fg_tallas / fg_dolor, three bound
 * knowledge sources, brandFacts "Elegir talla" and four selling-rule fields. Everything else in those texts stays.
 * Saves go through the same admin functions as the UI (version bump + ChatAgentVersion snapshot, knowledge versions).
 *
 * Safety:
 *   - Reads live values first; each sentence must appear exactly once (or already be swapped → unchanged). Any
 *     mismatch, a limit over its cap or a parse that would alter another field → errors listed, exit 1, NO write.
 *   - Default is dry-run. --apply writes, and only after a backup JSON (before + after per field) is saved under
 *     scripts/agent-pack/out/ (gitignored) or --backup-dir. Right before each write the live value is re-read and
 *     must still equal the backed-up "before" (else that write is skipped and reported, exit 1).
 *   - Never touches model, status, bindings of other sources, shipping, payment, follow-ups or other agents.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-no-weight-apply.ts --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     [--apply] [--backup-dir=scripts/agent-pack/out] [--actor-email=rafa.work0412@gmail.com]
 *
 * Revert: scripts/agent-pack/deepsleep-no-weight-revert.ts --backup=<that json>.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { validateShortcutForSave } from '@/lib/soft-ai/shortcuts'
import { AGENT_INSTRUCTIONS_MAX } from '@/lib/soft-ai/agent-types'
import { KNOWLEDGE_BODY_MAX, KNOWLEDGE_NAME_MAX } from '@/lib/soft-ai/knowledge-types'
import { approveKnowledgeSource, bindKnowledgeToAgent, unbindKnowledgeFromAgent, updateKnowledgeDraft } from '@/lib/soft-ai/knowledge-admin'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import {
  assertSalesSetupReady,
  loadSalesSetup,
  lockAgentForSalesRules,
  parseSalesRules,
  saveSalesSetup,
  SALES_RULES_MAX_OCTETS,
  SALES_RULES_TX,
  salesRulesOctets,
  type SalesRules,
} from '@/lib/soft-ai/agent-sales-setup'
import { planTextEdits, type TextEdit } from '@/lib/soft-ai/text-patch'
import { DEEPSLEEP_TENANT_ID, DEEPSLEEP_TENANT_SLUG } from '../lib/deepsleep-conversion-ids'
import {
  NO_WEIGHT_ACTOR_EMAIL,
  NO_WEIGHT_AGENT_ID,
  NO_WEIGHT_BRAND_FACT_EDITS,
  NO_WEIGHT_INSTRUCTION_EDITS,
  NO_WEIGHT_KNOWLEDGE_EDITS,
  NO_WEIGHT_SALES_RULE_EDITS,
  NO_WEIGHT_SHORTCUT_EDITS,
} from '../lib/deepsleep-no-weight-edits'
import {
  PACK_BRAND_FACT_EDITS,
  PACK_BUNDLE_RENAMES,
  PACK_INSTRUCTION_EDITS,
  PACK_KNOWLEDGE_EDITS,
  PACK_SALES_RULE_EDITS,
  PACK_SHORTCUT_EDITS,
} from '../lib/forge-pack-wording-edits'
import { resolveRepoOutPath } from '../lib/out-path-guard'
import { sameJson, type NoWeightBackupV1, type NoWeightChange, resolveNoWeightActor, requireNoWeightTenant } from './deepsleep-no-weight-shared'

const APPLY = process.argv.includes('--apply')
const TENANT_ID = DEEPSLEEP_TENANT_ID
const AGENT_ID = NO_WEIGHT_AGENT_ID
/** --set=pack-wording (Rafael 2026-11-06, "uno o dos" instead of "Pack de 2"); default: the 2026-11-03 no-weight set. */
const SET = arg('set') || 'no-weight'
if (SET !== 'no-weight' && SET !== 'pack-wording') throw new Error('--set must be no-weight or pack-wording')
const EDITS =
  SET === 'pack-wording'
    ? { instructions: PACK_INSTRUCTION_EDITS, shortcuts: PACK_SHORTCUT_EDITS, knowledge: PACK_KNOWLEDGE_EDITS, brandFacts: PACK_BRAND_FACT_EDITS, salesRules: PACK_SALES_RULE_EDITS as Record<string, TextEdit[]>, bundleRenames: PACK_BUNDLE_RENAMES }
    : { instructions: NO_WEIGHT_INSTRUCTION_EDITS, shortcuts: NO_WEIGHT_SHORTCUT_EDITS, knowledge: NO_WEIGHT_KNOWLEDGE_EDITS, brandFacts: NO_WEIGHT_BRAND_FACT_EDITS, salesRules: NO_WEIGHT_SALES_RULE_EDITS as Record<string, TextEdit[]>, bundleRenames: {} as Record<string, string> }

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const errors: string[] = []
const lines: string[] = []
const say = (s: string) => {
  lines.push(s)
  console.log(s)
}

/** One text field: plan the swaps; record conflicts as errors. Returns the after value or null when unchanged/conflict. */
function planText(label: string, live: string, edits: TextEdit[]): string | null {
  const plan = planTextEdits(live, edits)
  if (plan.status === 'conflict') {
    errors.push(`${label}: ${plan.error}`)
    say(`  ! ${label}: CONFLICT ${plan.error}`)
    return null
  }
  if (plan.status === 'same') {
    say(`  = ${label}: already applied (unchanged)`)
    return null
  }
  say(`  ~ ${label}: ${live.length} → ${plan.next.length} chars`)
  for (const e of edits) say(`      - ${JSON.stringify(e.from)}\n      + ${JSON.stringify(e.to)}`)
  return plan.next
}

/** A string list edited as one block (one item per line), so a swap targets exactly one item. */
function planList(label: string, live: string[], edits: TextEdit[]): string[] | null {
  if (live.some((x) => x.includes('\n'))) {
    errors.push(`${label}: an item has a line break`)
    return null
  }
  const next = planText(label, live.join('\n'), edits)
  if (next === null) return null
  const items = next.split('\n')
  if (items.length !== live.length) {
    errors.push(`${label}: item count changed ${live.length} → ${items.length}`)
    return null
  }
  return items
}

async function plan(): Promise<NoWeightChange[]> {
  const changes: NoWeightChange[] = []
  const agent = await prisma.chatAgent.findFirst({
    where: { id: AGENT_ID, tenantId: TENANT_ID },
    select: { id: true, name: true, version: true, systemInstructions: true, brandFacts: true },
  })
  if (!agent) throw new Error(`Agent ${AGENT_ID} not found on tenant`)
  say(`\n== ${agent.name} (${agent.id}) live v${agent.version} ==`)

  // 1. Instructions
  const ins = planText('systemInstructions', agent.systemInstructions, EDITS.instructions)
  if (ins !== null) {
    if (ins.trim().length > AGENT_INSTRUCTIONS_MAX) errors.push(`systemInstructions: ${ins.trim().length} > ${AGENT_INSTRUCTIONS_MAX}`)
    else say(`      (${ins.trim().length}/${AGENT_INSTRUCTIONS_MAX})`)
    changes.push({ kind: 'instructions', agentId: AGENT_ID, before: agent.systemInstructions, after: ins })
  }

  // 2. Saved replies (raw DB body, not the display upgrade)
  for (const [key, edits] of Object.entries(EDITS.shortcuts)) {
    const row = await prisma.chatAgentShortcut.findFirst({ where: { tenantId: TENANT_ID, agentId: AGENT_ID, key } })
    if (!row) {
      errors.push(`shortcut ${key}: not found`)
      continue
    }
    const after = planText(`shortcut ${key}`, row.body, edits)
    if (after === null) continue
    const check = validateShortcutForSave({
      key: row.key,
      title: row.title,
      kind: row.kind,
      intents: row.intents,
      keywords: row.keywords,
      deliveryMode: row.deliveryMode,
      body: after,
    } as Parameters<typeof validateShortcutForSave>[0])
    if (!check.ok) errors.push(`shortcut ${key}: ${check.code} (keywords=${row.keywords.length}/20, body=${after.trim().length}/1500)`)
    else say(`      (keywords ${row.keywords.length}/20 kept, body ${after.trim().length}/1500)`)
    changes.push({ kind: 'shortcut', agentId: AGENT_ID, shortcutId: row.id, key, before: row.body, after })
  }

  // 3. Knowledge (the approved source bound to this agent with that exact name)
  for (const [name, edits] of Object.entries(EDITS.knowledge)) {
    const links = await prisma.chatAgentKnowledgeSource.findMany({
      where: { tenantId: TENANT_ID, agentId: AGENT_ID, source: { name, status: 'approved' } },
      include: { source: true },
    })
    if (links.length !== 1) {
      errors.push(`knowledge "${name}": expected 1 approved bound source, found ${links.length}`)
      continue
    }
    const { source, priority } = links[0]
    const after = planText(`knowledge "${name}" (${source.kind} v${source.version} ${source.id})`, source.body, edits)
    if (after === null) continue
    if (name.length > KNOWLEDGE_NAME_MAX) errors.push(`knowledge "${name}": name > ${KNOWLEDGE_NAME_MAX}`)
    if (after.trim() !== after) errors.push(`knowledge "${name}": body has outer whitespace`)
    if (after.length > KNOWLEDGE_BODY_MAX) errors.push(`knowledge "${name}": body ${after.length} > ${KNOWLEDGE_BODY_MAX}`)
    else say(`      (body ${after.length}/${KNOWLEDGE_BODY_MAX}, priority ${priority} kept)`)
    changes.push({
      kind: 'knowledge',
      agentId: AGENT_ID,
      name,
      sourceKind: source.kind,
      beforeSourceId: source.id,
      beforeBody: source.body,
      priority,
      after,
      afterSourceId: null,
    })
  }

  // 4. brandFacts extraFacts (value only)
  const rawFacts = (agent.brandFacts ?? {}) as Record<string, unknown>
  const extra = Array.isArray(rawFacts.extraFacts) ? (rawFacts.extraFacts as Array<{ label?: unknown; value?: unknown }>) : []
  const valueByLabel = new Map<string, string>()
  for (const [label, edits] of Object.entries(EDITS.brandFacts)) {
    const hits = extra.filter((e) => e.label === label)
    if (hits.length !== 1 || typeof hits[0].value !== 'string') {
      errors.push(`brandFacts "${label}": expected 1 entry, found ${hits.length}`)
      continue
    }
    const after = planText(`brandFacts "${label}"`, hits[0].value, edits)
    if (after === null) continue
    if (after.length > 200) errors.push(`brandFacts "${label}": ${after.length} > 200`)
    valueByLabel.set(label, after)
  }
  if (valueByLabel.size) {
    const swap = <T extends { label?: unknown; value?: unknown }>(list: T[]) =>
      list.map((e) => (typeof e.label === 'string' && valueByLabel.has(e.label) ? { ...e, value: valueByLabel.get(e.label) } : e))
    const afterFacts = { ...rawFacts, extraFacts: swap(extra) }
    try {
      const parsedBefore = parseBrandFacts(rawFacts)
      const parsedAfter = parseBrandFacts(afterFacts)
      if (!sameJson(parsedAfter, { ...parsedBefore, extraFacts: swap(parsedBefore.extraFacts ?? []) })) {
        errors.push('brandFacts: the save would change another field')
      } else {
        say(`      (extraFacts ${extra.length}/10; every other brand fact identical after parse)`)
      }
      const drift = Object.keys({ ...rawFacts, ...parsedBefore }).filter(
        (k) => !sameJson((rawFacts as Record<string, unknown>)[k], (parsedBefore as Record<string, unknown>)[k]),
      )
      if (drift.length) say(`      note: the save path re-normalizes ${drift.join(', ')} (same as any UI save)`)
    } catch (e) {
      errors.push(`brandFacts: ${(e as Error).message}`)
    }
    changes.push({ kind: 'brand_facts', agentId: AGENT_ID, before: rawFacts, after: afterFacts })
  }

  // 5. Selling rules
  const { salesRules: current } = await loadSalesSetup(TENANT_ID, AGENT_ID)
  const patch: Partial<SalesRules> = {}
  const before: Partial<SalesRules> = {}
  const must = EDITS.salesRules.mustSay ? planList('salesRules.mustSay', current.mustSay, EDITS.salesRules.mustSay) : null
  if (must) Object.assign(patch, { mustSay: must }), Object.assign(before, { mustSay: current.mustSay })
  const never = EDITS.salesRules.neverSay ? planList('salesRules.neverSay', current.neverSay, EDITS.salesRules.neverSay) : null
  if (never) Object.assign(patch, { neverSay: never }), Object.assign(before, { neverSay: current.neverSay })
  for (const key of ['objections', 'handoffWhen', 'closing', 'upsells'] as const) {
    if (!EDITS.salesRules[key]) continue
    const live = current[key]
    if (typeof live !== 'string') {
      errors.push(`salesRules.${key}: empty`)
      continue
    }
    const after = planText(`salesRules.${key}`, live, EDITS.salesRules[key])
    if (after !== null) Object.assign(patch, { [key]: after }), Object.assign(before, { [key]: live })
  }
  // Combo names (price / shipping unchanged): each rename must hit exactly one live combo, or it is already done.
  const renames = Object.entries(EDITS.bundleRenames)
  if (renames.length) {
    const bundles = current.bundles ?? []
    let changed = false
    const next = bundles.map((b) => ({ ...b }))
    for (const [from, to] of renames) {
      const hits = next.filter((b) => b.name === from)
      if (hits.length === 1) {
        hits[0].name = to
        changed = true
        say(`  ~ salesRules.bundles: ${JSON.stringify(from)} → ${JSON.stringify(to)}`)
      } else if (next.some((b) => b.name === to)) say(`  = salesRules.bundles: ${JSON.stringify(to)} already applied`)
      else errors.push(`salesRules.bundles: ${JSON.stringify(from)} found ${hits.length} times`)
    }
    if (changed) Object.assign(patch, { bundles: next }), Object.assign(before, { bundles })
  }
  if (Object.keys(patch).length) {
    const merged = parseSalesRules({ ...current, ...patch })
    const parsedCurrent = parseSalesRules(current)
    for (const k of Object.keys(merged) as Array<keyof SalesRules>) {
      const want = k in patch ? patch[k] : parsedCurrent[k]
      if (!sameJson(merged[k], want)) errors.push(`salesRules.${k}: would be cut or changed by parseSalesRules`)
    }
    const octets = salesRulesOctets(merged)
    if (octets > SALES_RULES_MAX_OCTETS) errors.push(`salesRules: ${octets} > ${SALES_RULES_MAX_OCTETS} bytes`)
    say(
      `      (objections ${(merged.objections ?? '').length}/1200, handoffWhen ${(merged.handoffWhen ?? '').length}/800, ` +
        `mustSay ${merged.mustSay.length}/10, neverSay ${merged.neverSay.length}/10, ${octets}/${SALES_RULES_MAX_OCTETS} bytes)`,
    )
    changes.push({ kind: 'sales_rules', agentId: AGENT_ID, before, after: patch })
  }
  return changes
}

function writeBackup(backup: NoWeightBackupV1, path: string) {
  writeFileSync(path, JSON.stringify(backup, null, 2))
}

async function apply(changes: NoWeightChange[], backup: NoWeightBackupV1, backupPath: string, act: Awaited<ReturnType<typeof resolveNoWeightActor>>) {
  const skipped: string[] = []
  for (const ch of changes) {
    if (ch.kind === 'instructions') {
      const live = await prisma.chatAgent.findFirst({ where: { id: ch.agentId, tenantId: TENANT_ID }, select: { systemInstructions: true } })
      if (live?.systemInstructions !== ch.before) { skipped.push('instructions (changed since plan)'); continue }
      await updateChatAgent({ tenantId: TENANT_ID, agentId: ch.agentId, ...act, patch: { systemInstructions: ch.after } })
      say('  ✓ instructions')
    } else if (ch.kind === 'shortcut') {
      const live = await prisma.chatAgentShortcut.findFirst({ where: { id: ch.shortcutId, tenantId: TENANT_ID }, select: { body: true } })
      if (live?.body !== ch.before) { skipped.push(`shortcut ${ch.key} (changed since plan)`); continue }
      await updateShortcut({ tenantId: TENANT_ID, agentId: ch.agentId, shortcutId: ch.shortcutId, ...act, patch: { body: ch.after } })
      say(`  ✓ shortcut ${ch.key}`)
    } else if (ch.kind === 'knowledge') {
      const live = await prisma.chatKnowledgeSource.findFirst({ where: { id: ch.beforeSourceId, tenantId: TENANT_ID }, select: { body: true, status: true } })
      if (live?.body !== ch.beforeBody || live.status !== 'approved') { skipped.push(`knowledge "${ch.name}" (changed since plan)`); continue }
      const draft = await updateKnowledgeDraft({ tenantId: TENANT_ID, sourceId: ch.beforeSourceId, ...act, body: ch.after })
      ch.afterSourceId = draft.id
      writeBackup(backup, backupPath) // record the new id before the approve, so revert can find it
      await approveKnowledgeSource({ tenantId: TENANT_ID, sourceId: draft.id, ...act })
      await bindKnowledgeToAgent({ tenantId: TENANT_ID, agentId: ch.agentId, sourceId: draft.id, priority: ch.priority, ...act })
      await unbindKnowledgeFromAgent({ tenantId: TENANT_ID, agentId: ch.agentId, sourceId: ch.beforeSourceId, ...act }).catch(() => null)
      say(`  ✓ knowledge "${ch.name}" → ${draft.id}`)
    } else if (ch.kind === 'brand_facts') {
      const live = await prisma.chatAgent.findFirst({ where: { id: ch.agentId, tenantId: TENANT_ID }, select: { brandFacts: true } })
      if (!sameJson(live?.brandFacts ?? {}, ch.before)) { skipped.push('brandFacts (changed since plan)'); continue }
      await updateChatAgent({ tenantId: TENANT_ID, agentId: ch.agentId, ...act, patch: { brandFacts: ch.after } })
      say('  ✓ brandFacts')
    } else if (ch.kind === 'sales_rules') {
      await assertSalesSetupReady()
      const ok = await prisma.$transaction(async (tx) => {
        await lockAgentForSalesRules(tx, TENANT_ID, ch.agentId)
        const { salesRules } = await loadSalesSetup(TENANT_ID, ch.agentId, tx, true)
        for (const [k, v] of Object.entries(ch.before)) if (!sameJson(salesRules[k as keyof SalesRules], v)) return false
        await saveSalesSetup(TENANT_ID, ch.agentId, { salesRules: ch.after }, act.actorUserId, tx)
        await tx.chatAgent.updateMany({ where: { id: ch.agentId, tenantId: TENANT_ID }, data: { version: { increment: 1 }, updatedBy: act.actorUserId } })
        return true
      }, SALES_RULES_TX)
      if (!ok) { skipped.push('salesRules (changed since plan)'); continue }
      say(`  ✓ salesRules ${Object.keys(ch.after).join(', ')}`)
    }
  }
  writeBackup(backup, backupPath)
  return skipped
}

async function main() {
  say(`DeepSleep Forge text apply (set ${SET}) — ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  const tenant = await requireNoWeightTenant(arg('confirm-tenant'), TENANT_ID, DEEPSLEEP_TENANT_SLUG)
  say(`Tenant: ${tenant.name} (${tenant.slug} / ${tenant.id})`)
  const act = await resolveNoWeightActor(arg('actor-email') || NO_WEIGHT_ACTOR_EMAIL, TENANT_ID, 'deepsleep-no-weight-apply')
  say(`Actor: ${act.actorName} role=${act.actorRole}`)

  const changes = await plan()
  say(`\nPlanned: ${changes.length} change(s): ${changes.map((c) => c.kind + ('key' in c ? `:${c.key}` : 'name' in c ? `:${c.name}` : '')).join(', ') || 'none'}`)
  if (errors.length) {
    say(`\n✗ ${errors.length} validation error(s) — nothing written:`)
    for (const e of errors) say(`  - ${e}`)
    process.exitCode = 1
    return
  }
  if (!APPLY) {
    say('\nDRY-RUN: nothing written. Re-run with --apply to save (a backup is written first).')
    return
  }
  if (!changes.length) {
    say('\nNothing to apply (already applied).')
    return
  }
  const dir = resolveRepoOutPath(arg('backup-dir') || join(process.cwd(), 'scripts/agent-pack/out'), '--backup-dir')
  mkdirSync(dir, { recursive: true })
  const createdAt = new Date().toISOString()
  const backup: NoWeightBackupV1 = { version: 1, kind: 'deepsleep-no-weight', createdAt, tenantId: TENANT_ID, changes }
  const backupPath = join(dir, `deepsleep-${SET}-backup-${createdAt.replace(/[:.]/g, '-')}.json`)
  writeBackup(backup, backupPath)
  say(`\nBackup: ${backupPath}`)
  const skipped = await apply(changes, backup, backupPath, act)
  if (skipped.length) {
    say(`\n! Skipped ${skipped.length} (live changed after the plan; re-run the dry-run): ${skipped.join('; ')}`)
    process.exitCode = 1
  }
  say(`\nDone. Revert: scripts/agent-pack/deepsleep-no-weight-revert.ts --confirm-tenant=${DEEPSLEEP_TENANT_SLUG} --backup=${backupPath} [--apply]`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
