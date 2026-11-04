/**
 * Engine for the DeepSleep sentence-swap data scripts (moved unchanged out of deepsleep-no-weight-apply.ts /
 * -revert.ts so a second edit set reuses the same safety, instead of a copy). Each wrapper passes one edit set.
 *
 * Apply (default dry-run):
 *   - Reads live values first; each sentence must appear exactly once (or already be swapped → unchanged). Any
 *     mismatch, a limit over its cap or a parse that would alter another field → errors listed, exit 1, NO write.
 *   - --apply writes, and only after a backup JSON (before + after per field) is saved under scripts/agent-pack/out/
 *     (gitignored) or --backup-dir. Right before each write the live value is re-read and must still equal the
 *     backed-up "before" (else that write is skipped and reported, exit 1).
 *   - Saves go through the same admin functions as the UI (version bump + ChatAgentVersion snapshot, knowledge versions).
 *   - Never touches model, status, bindings of other sources, shipping, payment, follow-ups or other agents.
 * Revert: from that backup's exact path; only where live still equals the backed-up "after" (else skipped, exit 1).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
import { resolveRepoOutPath } from '../lib/out-path-guard'
import {
  sameJson,
  type NoWeightBackupV1,
  type NoWeightChange,
  type TextEditBackupKind,
  resolveNoWeightActor,
  requireNoWeightTenant,
} from './deepsleep-no-weight-shared'

/** One edit set: which sentences to swap where. Empty parts are skipped (no live read required for them). */
export type TextEditSet = {
  /** Backup kind + file prefix (`<kind>-backup-<stamp>.json`). */
  kind: TextEditBackupKind
  title: string
  agentId: string
  actorEmail: string
  /** Script names for the actor label and the printed revert command. */
  applyScript: string
  revertScript: string
  instructions?: TextEdit[]
  shortcuts?: Record<string, TextEdit[]>
  knowledge?: Record<string, TextEdit[]>
  brandFacts?: Record<string, TextEdit[]>
  salesRules?: { mustSay?: TextEdit[]; neverSay?: TextEdit[]; objections?: TextEdit[]; handoffWhen?: TextEdit[] }
}

const TENANT_ID = DEEPSLEEP_TENANT_ID

function arg(argv: string[], name: string): string | null {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

export async function runTextEditApply(set: TextEditSet, argv: string[] = process.argv): Promise<void> {
  const APPLY = argv.includes('--apply')
  const AGENT_ID = set.agentId
  const errors: string[] = []
  const say = (s: string) => console.log(s)

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
    if (set.instructions?.length) {
      const ins = planText('systemInstructions', agent.systemInstructions, set.instructions)
      if (ins !== null) {
        if (ins.trim().length > AGENT_INSTRUCTIONS_MAX) errors.push(`systemInstructions: ${ins.trim().length} > ${AGENT_INSTRUCTIONS_MAX}`)
        else say(`      (${ins.trim().length}/${AGENT_INSTRUCTIONS_MAX})`)
        changes.push({ kind: 'instructions', agentId: AGENT_ID, before: agent.systemInstructions, after: ins })
      }
    }

    // 2. Saved replies (raw DB body, not the display upgrade)
    for (const [key, edits] of Object.entries(set.shortcuts ?? {})) {
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
    for (const [name, edits] of Object.entries(set.knowledge ?? {})) {
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
    for (const [label, edits] of Object.entries(set.brandFacts ?? {})) {
      const hits = extra.filter((e) => e.label === label)
      if (hits.length !== 1 || typeof hits[0].value !== 'string') {
        errors.push(`brandFacts "${label}": expected 1 entry, found ${hits.length}`)
        continue
      }
      const after = planText(`brandFacts "${label}"`, hits[0].value, edits)
      if (after === null) continue
      if (after.length > 200) errors.push(`brandFacts "${label}": ${after.length} > 200`)
      else say(`      (value ${after.length}/200)`)
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

    // 5. Selling rules (only the keys this set edits)
    const rules = set.salesRules ?? {}
    if (Object.values(rules).some((e) => e?.length)) {
      const { salesRules: current } = await loadSalesSetup(TENANT_ID, AGENT_ID)
      const patch: Partial<SalesRules> = {}
      const before: Partial<SalesRules> = {}
      for (const key of ['mustSay', 'neverSay'] as const) {
        const edits = rules[key]
        if (!edits?.length) continue
        const next = planList(`salesRules.${key}`, current[key], edits)
        if (next) Object.assign(patch, { [key]: next }), Object.assign(before, { [key]: current[key] })
      }
      for (const key of ['objections', 'handoffWhen'] as const) {
        const edits = rules[key]
        if (!edits?.length) continue
        const live = current[key]
        if (typeof live !== 'string') {
          errors.push(`salesRules.${key}: empty`)
          continue
        }
        const after = planText(`salesRules.${key}`, live, edits)
        if (after !== null) Object.assign(patch, { [key]: after }), Object.assign(before, { [key]: live })
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
    }
    return changes
  }

  const writeBackup = (backup: NoWeightBackupV1, path: string) => writeFileSync(path, JSON.stringify(backup, null, 2))

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

  say(`${set.title} — ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  const tenant = await requireNoWeightTenant(arg(argv, 'confirm-tenant'), TENANT_ID, DEEPSLEEP_TENANT_SLUG)
  say(`Tenant: ${tenant.name} (${tenant.slug} / ${tenant.id})`)
  const act = await resolveNoWeightActor(arg(argv, 'actor-email') || set.actorEmail, TENANT_ID, set.applyScript)
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
  const dir = resolveRepoOutPath(arg(argv, 'backup-dir') || join(process.cwd(), 'scripts/agent-pack/out'), '--backup-dir')
  mkdirSync(dir, { recursive: true })
  const createdAt = new Date().toISOString()
  const backup: NoWeightBackupV1 = { version: 1, kind: set.kind, createdAt, tenantId: TENANT_ID, changes }
  const backupPath = join(dir, `${set.kind}-backup-${createdAt.replace(/[:.]/g, '-')}.json`)
  writeBackup(backup, backupPath)
  say(`\nBackup: ${backupPath}`)
  const skipped = await apply(changes, backup, backupPath, act)
  if (skipped.length) {
    say(`\n! Skipped ${skipped.length} (live changed after the plan; re-run the dry-run): ${skipped.join('; ')}`)
    process.exitCode = 1
  }
  say(`\nDone. Revert: scripts/agent-pack/${set.revertScript}.ts --confirm-tenant=${DEEPSLEEP_TENANT_SLUG} --backup=${backupPath} [--apply]`)
}

type Verdict = 'revert' | 'already' | 'drift'

/**
 * Revert from a backup JSON (exact --backup= path; no newest-file fallback). Per change, only when the live value
 * still equals the backed-up "after" (else skipped and reported, unless --force):
 *   - instructions / saved reply / brandFacts / selling rules → the "before" value, through the same admin saves;
 *   - knowledge → a NEW version carrying the old body (the old version is archived and cannot be re-bound), approved
 *     and bound with the old priority; the swapped version is unbound.
 * Already-reverted values are left alone. Default is dry-run; --apply writes.
 */
export async function runTextEditRevert(
  opts: { kind: TextEditBackupKind; title: string; actorEmail: string; revertScript: string },
  argv: string[] = process.argv,
): Promise<void> {
  const APPLY = argv.includes('--apply')
  const FORCE = argv.includes('--force')
  const verdict = (liveIsAfter: boolean, liveIsBefore: boolean): Verdict =>
    liveIsAfter ? 'revert' : liveIsBefore ? 'already' : FORCE ? 'revert' : 'drift'
  const brandEq = (a: unknown, b: unknown) => {
    try {
      return sameJson(parseBrandFacts(a ?? {}), parseBrandFacts(b ?? {}))
    } catch {
      return sameJson(a, b)
    }
  }

  console.log(`${opts.title} — ${APPLY ? 'APPLY' : 'DRY-RUN'}${FORCE ? ' (--force)' : ''}`)
  const path = arg(argv, 'backup')
  if (!path) throw new Error(`Refusing: pass --backup=<${opts.kind}-backup-*.json>`)
  const backup = JSON.parse(readFileSync(path, 'utf8')) as NoWeightBackupV1
  if (backup.kind !== opts.kind || backup.version !== 1 || backup.tenantId !== TENANT_ID) {
    throw new Error(`Refusing: not a ${opts.kind} v1 backup for this tenant`)
  }
  const tenant = await requireNoWeightTenant(arg(argv, 'confirm-tenant'), TENANT_ID, DEEPSLEEP_TENANT_SLUG)
  console.log(`Tenant: ${tenant.name} (${tenant.slug}) · backup ${backup.createdAt} · ${backup.changes.length} change(s)`)
  const act = await resolveNoWeightActor(arg(argv, 'actor-email') || opts.actorEmail, TENANT_ID, opts.revertScript)

  const drift: string[] = []
  const report = (label: string, v: Verdict) => {
    console.log(`  ${v === 'revert' ? '~' : v === 'already' ? '=' : '!'} ${label}: ${v === 'revert' ? 'restore before' : v === 'already' ? 'already the before value' : 'live changed since apply — skipped (use --force)'}`)
    if (v === 'drift') drift.push(label)
    return v === 'revert'
  }

  for (const ch of [...backup.changes].reverse() as NoWeightChange[]) {
    if (ch.kind === 'instructions') {
      const live = await prisma.chatAgent.findFirst({ where: { id: ch.agentId, tenantId: TENANT_ID }, select: { systemInstructions: true } })
      const go = report('instructions', verdict(live?.systemInstructions === ch.after, live?.systemInstructions === ch.before))
      if (go && APPLY) await updateChatAgent({ tenantId: TENANT_ID, agentId: ch.agentId, ...act, patch: { systemInstructions: ch.before } })
    } else if (ch.kind === 'shortcut') {
      const live = await prisma.chatAgentShortcut.findFirst({ where: { id: ch.shortcutId, tenantId: TENANT_ID }, select: { body: true } })
      const go = report(`shortcut ${ch.key}`, verdict(live?.body === ch.after, live?.body === ch.before))
      if (go && APPLY) await updateShortcut({ tenantId: TENANT_ID, agentId: ch.agentId, shortcutId: ch.shortcutId, ...act, patch: { body: ch.before } })
    } else if (ch.kind === 'brand_facts') {
      const live = await prisma.chatAgent.findFirst({ where: { id: ch.agentId, tenantId: TENANT_ID }, select: { brandFacts: true } })
      const go = report('brandFacts', verdict(brandEq(live?.brandFacts, ch.after), brandEq(live?.brandFacts, ch.before)))
      if (go && APPLY) await updateChatAgent({ tenantId: TENANT_ID, agentId: ch.agentId, ...act, patch: { brandFacts: ch.before } })
    } else if (ch.kind === 'sales_rules') {
      const { salesRules } = await loadSalesSetup(TENANT_ID, ch.agentId)
      const eq = (side: Partial<SalesRules>) => Object.entries(side).every(([k, v]) => sameJson(salesRules[k as keyof SalesRules], v))
      const go = report(`salesRules ${Object.keys(ch.before).join(', ')}`, verdict(eq(ch.after), eq(ch.before)))
      if (go && APPLY) {
        await assertSalesSetupReady()
        await prisma.$transaction(async (tx) => {
          await lockAgentForSalesRules(tx, TENANT_ID, ch.agentId)
          await saveSalesSetup(TENANT_ID, ch.agentId, { salesRules: ch.before }, act.actorUserId, tx)
          await tx.chatAgent.updateMany({ where: { id: ch.agentId, tenantId: TENANT_ID }, data: { version: { increment: 1 }, updatedBy: act.actorUserId } })
        }, SALES_RULES_TX)
      }
    } else if (ch.kind === 'knowledge') {
      if (!ch.afterSourceId) {
        console.log(`  = knowledge "${ch.name}": never written (no after id)`)
        continue
      }
      const after = await prisma.chatKnowledgeSource.findFirst({ where: { id: ch.afterSourceId, tenantId: TENANT_ID } })
      const bound = await prisma.chatAgentKnowledgeSource.findFirst({ where: { tenantId: TENANT_ID, agentId: ch.agentId, sourceId: ch.afterSourceId } })
      const liveIsAfter = Boolean(after && after.status === 'approved' && bound && after.body === ch.after)
      const boundNow = await prisma.chatAgentKnowledgeSource.findMany({
        where: { tenantId: TENANT_ID, agentId: ch.agentId, source: { name: ch.name, status: 'approved' } },
        include: { source: true },
      })
      const liveIsBefore = boundNow.length === 1 && boundNow[0].source.body === ch.beforeBody
      const go = report(`knowledge "${ch.name}" (${ch.afterSourceId})`, verdict(liveIsAfter, liveIsBefore))
      if (go && APPLY && after) {
        const draft = await updateKnowledgeDraft({ tenantId: TENANT_ID, sourceId: after.id, ...act, body: ch.beforeBody })
        await approveKnowledgeSource({ tenantId: TENANT_ID, sourceId: draft.id, ...act })
        await bindKnowledgeToAgent({ tenantId: TENANT_ID, agentId: ch.agentId, sourceId: draft.id, priority: ch.priority, ...act })
        await unbindKnowledgeFromAgent({ tenantId: TENANT_ID, agentId: ch.agentId, sourceId: after.id, ...act }).catch(() => null)
        console.log(`    → restored body as ${draft.id}`)
      }
    }
  }
  if (drift.length) {
    console.log(`\n! ${drift.length} skipped (changed since apply): ${drift.join('; ')}`)
    process.exitCode = 1
  }
  console.log(APPLY ? '\nRevert done.' : '\nDRY-RUN: nothing written. Re-run with --apply.')
}

/** Wrapper entry: run, report errors as exit 1, always disconnect. */
export function runMain(fn: () => Promise<void>) {
  fn()
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
