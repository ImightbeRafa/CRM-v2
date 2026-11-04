/**
 * Revert of deepsleep-no-weight-apply.ts from its backup JSON (exact --backup= path; no newest-file fallback).
 *
 * Per change, only when the live value still equals the backed-up "after" (else skipped and reported, unless --force):
 *   - instructions / saved reply / brandFacts / selling rules → the "before" value, through the same admin saves;
 *   - knowledge → a NEW version carrying the old body (the old version is archived and cannot be re-bound), approved
 *     and bound with the old priority; the no-weight version is unbound.
 * Already-reverted values are left alone. Default is dry-run; --apply writes.
 *
 *   node --env-file=.env.local --import tsx --import ./scripts/shim-server-only.mjs \
 *     scripts/agent-pack/deepsleep-no-weight-revert.ts --confirm-tenant=deepsleepp-cr-1762740734630 \
 *     --backup=scripts/agent-pack/out/deepsleep-no-weight-backup-<stamp>.json [--apply] [--force] [--actor-email=…]
 */
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { updateShortcut } from '@/lib/soft-ai/shortcut-admin'
import { approveKnowledgeSource, bindKnowledgeToAgent, unbindKnowledgeFromAgent, updateKnowledgeDraft } from '@/lib/soft-ai/knowledge-admin'
import { parseBrandFacts } from '@/lib/soft-ai/brand-facts'
import {
  assertSalesSetupReady,
  loadSalesSetup,
  lockAgentForSalesRules,
  saveSalesSetup,
  SALES_RULES_TX,
  type SalesRules,
} from '@/lib/soft-ai/agent-sales-setup'
import { DEEPSLEEP_TENANT_ID, DEEPSLEEP_TENANT_SLUG } from '../lib/deepsleep-conversion-ids'
import { NO_WEIGHT_ACTOR_EMAIL } from '../lib/deepsleep-no-weight-edits'
import { sameJson, type NoWeightBackupV1, type NoWeightChange, requireNoWeightTenant, resolveNoWeightActor } from './deepsleep-no-weight-shared'

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
const TENANT_ID = DEEPSLEEP_TENANT_ID

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

type Verdict = 'revert' | 'already' | 'drift'
const verdict = (liveIsAfter: boolean, liveIsBefore: boolean): Verdict =>
  liveIsAfter ? 'revert' : liveIsBefore ? 'already' : FORCE ? 'revert' : 'drift'

const brandEq = (a: unknown, b: unknown) => {
  try {
    return sameJson(parseBrandFacts(a ?? {}), parseBrandFacts(b ?? {}))
  } catch {
    return sameJson(a, b)
  }
}

async function main() {
  console.log(`DeepSleep no-weight revert — ${APPLY ? 'APPLY' : 'DRY-RUN'}${FORCE ? ' (--force)' : ''}`)
  const path = arg('backup')
  if (!path) throw new Error('Refusing: pass --backup=<deepsleep-no-weight-backup-*.json>')
  const backup = JSON.parse(readFileSync(path, 'utf8')) as NoWeightBackupV1
  if (backup.kind !== 'deepsleep-no-weight' || backup.version !== 1 || backup.tenantId !== TENANT_ID) {
    throw new Error('Refusing: not a deepsleep-no-weight v1 backup for this tenant')
  }
  const tenant = await requireNoWeightTenant(arg('confirm-tenant'), TENANT_ID, DEEPSLEEP_TENANT_SLUG)
  console.log(`Tenant: ${tenant.name} (${tenant.slug}) · backup ${backup.createdAt} · ${backup.changes.length} change(s)`)
  const act = await resolveNoWeightActor(arg('actor-email') || NO_WEIGHT_ACTOR_EMAIL, TENANT_ID, 'deepsleep-no-weight-revert')

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

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
