/**
 * "Aplicar" for a reviewed Studio draft (F3 S5). The owner sends back what they kept / edited; this writes it into
 * the agent's EXISTING stores through their own admin functions (validation, version bump, audit unchanged):
 *   brand facts (deep merge, only the fields sent) · knowledge (policy / faq, named "<agente> · …", approved + bound)
 *   · guide shortcuts from quick replies · inventory map (UNION with what the agent already sells) · sales rules.
 * Nothing goes live: any change bumps the agent version, so Activar needs a fresh test run.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { parseBrandFactsSafe, type BrandFacts } from '@/lib/soft-ai/brand-facts'
import { updateChatAgent } from '@/lib/soft-ai/agent-admin'
import { approveKnowledgeSource, bindKnowledgeToAgent, createKnowledgeSource } from '@/lib/soft-ai/knowledge-admin'
import { createShortcut, listShortcuts } from '@/lib/soft-ai/shortcut-admin'
import { loadMappedInventoryIds, setMappedInventory, MAX_MAPPED_ITEMS } from '@/lib/soft-ai/agent-inventory-map'
import { saveSalesSetup, SalesSetupNotReadyError, type SalesRules } from '@/lib/soft-ai/agent-sales-setup'
import { hasConfirmationWording } from '@/lib/soft-ai/shortcuts'
import { KNOWLEDGE_BODY_MAX } from '@/lib/soft-ai/knowledge-types'

export type ApplySelection = {
  brand?: Partial<{ storeName: string; website: string; address: string; hours: string; pickupText: string }>
  payment?: {
    shareWithCustomers: boolean
    sinpe?: { number: string; holderName?: string | null } | null
    transfer?: { iban?: string | null; bank?: string | null; holderName?: string | null } | null
  }
  policies?: Array<{ title: string; text: string }>
  faq?: Array<{ question: string; answer: string }>
  quickReplies?: Array<{ title: string; body: string }>
  inventoryItemIds?: string[]
  salesRules?: Partial<SalesRules>
}

export type ApplyResult = {
  brandFacts: boolean
  knowledge: string[]
  shortcuts: number
  inventory: number | null
  salesRules: boolean
  skipped: string[]
}

export class DraftNotReadyError extends Error {
  constructor() {
    super('DRAFT_NOT_READY')
    this.name = 'DraftNotReadyError'
  }
}

type Actor = { userId: string; name: string; role: string }

const t = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
const httpUrl = (v: unknown) => {
  const s = t(v, 300)
  if (!s) return undefined
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`
  return /^https?:\/\/\S+$/i.test(withProto) ? withProto : undefined
}

/** Pure: merge only the fields the owner sent into the agent's current brand facts (exported for tests). */
export function mergeBrandFacts(current: BrandFacts, sel: ApplySelection): BrandFacts {
  const next: BrandFacts = JSON.parse(JSON.stringify(current || { schemaVersion: 1 }))
  const b = sel.brand || {}
  if (t(b.storeName, 60)) next.storeName = t(b.storeName, 60)
  if (httpUrl(b.website)) next.website = httpUrl(b.website)
  if (t(b.hours, 200)) next.hoursText = t(b.hours, 200)
  if (t(b.address, 200) || t(b.pickupText, 300)) {
    next.location = { ...(next.location || {}) }
    if (t(b.address, 200)) next.location.address = t(b.address, 200)
    if (t(b.pickupText, 300)) next.location.pickupInstructions = t(b.pickupText, 300)
  }
  if (sel.payment) {
    const pay = { shareWithCustomers: false, methods: [] as NonNullable<BrandFacts['payment']>['methods'], ...(next.payment || {}) }
    pay.shareWithCustomers = sel.payment.shareWithCustomers === true
    const methods = new Set(pay.methods || [])
    const sinpeNumber = t(sel.payment.sinpe?.number, 32)
    if (sinpeNumber) {
      pay.sinpe = { number: sinpeNumber, ...(t(sel.payment.sinpe?.holderName, 80) ? { holderName: t(sel.payment.sinpe?.holderName, 80) } : {}) }
      methods.add('sinpe')
    }
    const tr = sel.payment.transfer
    if (tr && (t(tr.iban, 40) || t(tr.bank, 80))) {
      pay.transfer = {
        ...(t(tr.bank, 80) ? { bank: t(tr.bank, 80) } : {}),
        ...(t(tr.iban, 40) ? { iban: t(tr.iban, 40) } : {}),
        ...(t(tr.holderName, 80) ? { holderName: t(tr.holderName, 80) } : {}),
      }
      methods.add('transferencia')
    }
    pay.methods = [...methods].slice(0, 5)
    next.payment = pay
  }
  return next
}

/** Pure: knowledge bodies (policy / faq), bounded to the knowledge store's max. */
export function knowledgeBodies(sel: ApplySelection): { policy: string | null; faq: string | null } {
  const policy = (sel.policies || [])
    .map((p) => [t(p.title, 80), t(p.text, 3000)].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n\n')
    .slice(0, KNOWLEDGE_BODY_MAX)
  const faq = (sel.faq || [])
    .map((f) => (t(f.question, 300) && t(f.answer, 1200) ? `P: ${t(f.question, 300)}\nR: ${t(f.answer, 1200)}` : ''))
    .filter(Boolean)
    .join('\n\n')
    .slice(0, KNOWLEDGE_BODY_MAX)
  return { policy: policy || null, faq: faq || null }
}

function slugKey(title: string, taken: Set<string>): string {
  const base =
    'studio_' +
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 28)
  let key = base.length > 7 ? base : 'studio_respuesta'
  for (let i = 2; taken.has(key); i += 1) key = `${base.slice(0, 36)}_${i}`
  taken.add(key)
  return key
}

export async function applyProfileDraft(input: {
  tenantId: string
  agentId: string
  draftId: string
  actor: Actor
  selection: ApplySelection
}): Promise<ApplyResult> {
  const { tenantId, agentId, actor, selection } = input
  // Claim: only a 'ready' draft of THIS agent can be applied, once.
  const claimed = await prisma.$executeRaw`
    UPDATE "ChatAgentProfileDraft" SET "status" = 'applying'
     WHERE "id" = ${input.draftId} AND "tenantId" = ${tenantId} AND "agentId" = ${agentId} AND "status" = 'ready'`
  if (claimed === 0) throw new DraftNotReadyError()

  const agent = await prisma.chatAgent.findFirst({ where: { id: agentId, tenantId }, select: { id: true, name: true, brandFacts: true } })
  const result: ApplyResult = { brandFacts: false, knowledge: [], shortcuts: 0, inventory: null, salesRules: false, skipped: [] }
  const who = { actorUserId: actor.userId, actorName: actor.name, actorRole: actor.role }
  try {
    if (!agent) throw new Error('AGENT_NOT_FOUND')

    // 1) Brand facts (deep merge; schema + size validated by updateChatAgent → parseBrandFacts).
    if (selection.brand || selection.payment) {
      try {
        const merged = mergeBrandFacts(parseBrandFactsSafe(agent.brandFacts), selection)
        await updateChatAgent({ tenantId, agentId, ...who, patch: { brandFacts: merged } })
        result.brandFacts = true
      } catch {
        result.skipped.push('brand_facts')
      }
    }

    // 2) Knowledge: one policy + one FAQ document per agent, approved and bound.
    const bodies = knowledgeBodies(selection)
    for (const [kind, body, label] of [
      ['policy', bodies.policy, 'Políticas'],
      ['faq', bodies.faq, 'Preguntas frecuentes'],
    ] as const) {
      if (!body) continue
      try {
        const name = `${agent.name} · ${label}`.slice(0, 80)
        const created = await createKnowledgeSource({ tenantId, ...who, kind, name, body, metadata: { studioDraftId: input.draftId } })
        await approveKnowledgeSource({ tenantId, sourceId: created.id, ...who })
        await bindKnowledgeToAgent({ tenantId, agentId, sourceId: created.id, ...who })
        result.knowledge.push(created.id)
      } catch {
        result.skipped.push(`knowledge_${kind}`)
      }
    }

    // 3) Quick replies → guide shortcuts (the agent adapts them; never verbatim confirmations).
    if (selection.quickReplies?.length) {
      const listed = await listShortcuts(tenantId, agentId).catch(() => null)
      const taken = new Set<string>((listed && 'shortcuts' in listed ? listed.shortcuts : []).map((s: { key: string }) => s.key))
      for (const q of selection.quickReplies.slice(0, 20)) {
        const title = t(q.title, 60)
        const body = t(q.body, 1500)
        if (!title || !body || hasConfirmationWording(body)) {
          result.skipped.push('shortcut')
          continue
        }
        try {
          await createShortcut({
            tenantId,
            agentId,
            ...who,
            draft: { key: slugKey(title, taken), title, kind: 'playbook', intents: [], keywords: [], body, deliveryMode: 'guide' },
          })
          result.shortcuts += 1
        } catch {
          result.skipped.push('shortcut')
        }
      }
    }

    // 4) Products: add the confirmed matches to what the agent already sells (never removes any).
    if (selection.inventoryItemIds?.length) {
      try {
        const current = (await loadMappedInventoryIds(tenantId, agentId)) || []
        const union = [...new Set([...current, ...selection.inventoryItemIds])].slice(0, MAX_MAPPED_ITEMS)
        result.inventory = await setMappedInventory({ tenantId, agentId, itemIds: union, actorUserId: actor.userId })
      } catch {
        result.skipped.push('inventory')
      }
    }

    // 5) Selling script.
    if (selection.salesRules) {
      try {
        await saveSalesSetup(tenantId, agentId, { salesRules: selection.salesRules }, actor.userId)
        result.salesRules = true
      } catch (error) {
        result.skipped.push(error instanceof SalesSetupNotReadyError ? 'sales_rules_not_ready' : 'sales_rules')
      }
    }

    await prisma.$executeRaw`
      UPDATE "ChatAgentProfileDraft"
         SET "status" = 'applied', "applied" = ${JSON.stringify(result)}::jsonb, "appliedAt" = NOW(), "appliedBy" = ${actor.userId}
       WHERE "id" = ${input.draftId} AND "tenantId" = ${tenantId} AND "status" = 'applying'`
    return result
  } catch (error) {
    // Nothing (or only part) applied: release the draft so the owner can retry.
    await prisma.$executeRaw`
      UPDATE "ChatAgentProfileDraft" SET "status" = 'ready', "applied" = ${JSON.stringify(result)}::jsonb
       WHERE "id" = ${input.draftId} AND "tenantId" = ${tenantId} AND "status" = 'applying'`.catch(() => 0)
    throw error
  }
}
