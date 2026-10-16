/**
 * Server side of the Mapa de conocimiento: loads what the agent really has (approved + bound knowledge, which of it
 * fits the prompt budget, mapped products, brand facts, active saved replies, business hours) and the live gaps
 * (turns handed to a person because the agent did not have the answer). Tenant-scoped; read-only.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { parseBrandFactsSafe } from '@/lib/soft-ai/brand-facts'
import { listMappedInventory } from '@/lib/soft-ai/agent-inventory-map'
import { loadApprovedKnowledgeForAgent } from '@/lib/soft-ai/knowledge-repository'
import {
  budgetKnowledgeSlice,
  isAgentTuningSource,
  KNOWLEDGE_LAYER2_CHAR_BUDGET,
  KNOWLEDGE_LAYER34_CHAR_BUDGET,
  KNOWLEDGE_TUNING_CHAR_BUDGET,
  type KnowledgeSourceDto,
} from '@/lib/soft-ai/knowledge-types'
import { listShortcuts } from '@/lib/soft-ai/shortcut-admin'
import { loadSalesSetup } from '@/lib/soft-ai/agent-sales-setup'
import { normalizeQuestion, sanitizeTuneQuestion } from '@/lib/soft-ai/agent-tuning-core'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { buildKnowledgeMap, type KnowledgeDocInput, type KnowledgeMap } from '@/lib/soft-ai/knowledge-map'

/** Turns are only kept 90 days (retention); the gap list never looks further back. */
export const GAP_WINDOW_DAYS = 90
const GAP_TURNS_MAX = 200
const GAP_GROUPS_MAX = 20

export type KnowledgeGapGroup = {
  /** Masked, length-capped customer question (sanitizeTuneQuestion); never names or phone numbers. */
  question: string
  count: number
  lastAt: string
  /** One of the turns, for answering it later (the server reloads the text itself). */
  turnId: string
  conversationId: string | null
  /** A written answer already covers it (same normalized question in this agent's knowledge). */
  answered: boolean
}

export type KnowledgeMapResult = KnowledgeMap & {
  agentName: string
  gaps: KnowledgeGapGroup[] | null
  goldTest: { savedTests: number; lastPassRate: number | null; lastRunAt: string | null }
  productsAvailable: boolean
}

export async function loadKnowledgeMap(input: {
  tenantId: string
  agentId: string
  /** Gaps show customer questions: only for roles that can already read the inbox (update_sales). */
  includeGaps: boolean
  now?: Date
}): Promise<KnowledgeMapResult | null> {
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
    select: { id: true, name: true, brandFacts: true },
  })
  if (!agent) return null

  const [inventory, slice, shortcuts, sales] = await Promise.all([
    listMappedInventory(input.tenantId, agent.id),
    // '' = no channel overlays (same as Corregir); the UI says the map covers the agent's own knowledge.
    loadApprovedKnowledgeForAgent({ tenantId: input.tenantId, agentId: agent.id, socialAccountId: '' }),
    listShortcuts(input.tenantId, agent.id).catch(() => ({ shortcuts: [] as Array<{ title: string; body: string; isActive: boolean }> })),
    loadSalesSetup(input.tenantId, agent.id).catch(() => null),
  ])

  const visibleIds = new Set(
    (() => {
      const b = budgetKnowledgeSlice(slice)
      return [...b.brandBook, ...b.policies, ...b.faqs, ...b.channelOverlay].map((s) => s.id)
    })(),
  )
  const laneOf = (s: KnowledgeSourceDto): KnowledgeDocInput['lane'] =>
    s.kind === 'faq' ? (isAgentTuningSource(s) ? 'corrections' : 'faq') : 'brand_policy'
  const docs: KnowledgeDocInput[] = [...slice.brandBook, ...slice.policies, ...slice.faqs].map((s) => ({
    name: s.name,
    kind: s.kind,
    body: s.body,
    visible: visibleIds.has(s.id),
    lane: laneOf(s),
  }))

  const map = buildKnowledgeMap({
    products: inventory.items.filter((i) => i.isActive).map((i) => ({ id: i.id, name: i.name, price: i.sellingPrice })),
    docs,
    replies: shortcuts.shortcuts.filter((s) => s.isActive).map((s) => ({ title: s.title, body: s.body })),
    brandFacts: parseBrandFactsSafe(agent.brandFacts),
    hoursEnabled: Boolean(sales?.salesRules.businessHours?.enabled),
    freeShippingBundles: (sales?.salesRules.bundles ?? []).filter((b) => b.shippingIncluded === true).map((b) => b.name),
    budgets: { brand_policy: KNOWLEDGE_LAYER2_CHAR_BUDGET, faq: KNOWLEDGE_LAYER34_CHAR_BUDGET, corrections: KNOWLEDGE_TUNING_CHAR_BUDGET },
  })

  const gaps = input.includeGaps ? await loadGaps(input.tenantId, agent.id, docs, input.now ?? new Date()) : null
  return {
    ...map,
    agentName: agent.name,
    gaps,
    goldTest: await loadGoldTest(input.tenantId, agent.id),
    productsAvailable: inventory.available,
  }
}

async function loadGaps(tenantId: string, agentId: string, docs: KnowledgeDocInput[], now: Date): Promise<KnowledgeGapGroup[]> {
  const since = new Date(now.getTime() - GAP_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const turns = await prisma.chatAgentTurn.findMany({
    where: {
      tenantId,
      agentId,
      // Test chat / Probar runs are not customers.
      testSessionId: null,
      createdAt: { gte: since },
      decisionTrace: { path: ['outcomeMarkers', 'handoffReason'], equals: 'unknown_answer' },
    },
    orderBy: { createdAt: 'desc' },
    take: GAP_TURNS_MAX,
    select: { id: true, createdAt: true, conversationId: true, triggerMessageId: true },
  })
  const ids = [...new Set(turns.map((t) => t.triggerMessageId).filter((id): id is string => Boolean(id)))]
  if (!ids.length) return []
  const messages = await prisma.chatMessage.findMany({
    where: { tenantId, id: { in: ids }, direction: 'inbound' },
    select: { id: true, content: true },
  })
  const textById = new Map(messages.map((m) => [m.id, m.content || '']))
  const written = docs.map((d) => normalizeQuestion(d.body))
  const groups = new Map<string, KnowledgeGapGroup>()
  for (const t of turns) {
    const raw = t.triggerMessageId ? textById.get(t.triggerMessageId) : undefined
    if (!raw) continue
    const question = sanitizeTuneQuestion(raw).slice(0, 200)
    const key = normalizeQuestion(question)
    if (!key) continue
    const g = groups.get(key)
    if (g) {
      g.count += 1
      continue
    }
    groups.set(key, {
      question,
      count: 1,
      lastAt: t.createdAt.toISOString(),
      turnId: t.id,
      conversationId: t.conversationId,
      answered: written.some((w) => w.includes(key)),
    })
  }
  return [...groups.values()].sort((a, b) => Number(a.answered) - Number(b.answered) || b.count - a.count).slice(0, GAP_GROUPS_MAX)
}

async function loadGoldTest(tenantId: string, agentId: string): Promise<KnowledgeMapResult['goldTest']> {
  const out: KnowledgeMapResult['goldTest'] = { savedTests: 0, lastPassRate: null, lastRunAt: null }
  try {
    if (await isTableReady('ChatAgentTestCase')) {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*)::bigint AS n FROM "ChatAgentTestCase" WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId}`
      out.savedTests = Number(rows[0]?.n ?? 0)
    }
    if (await isTableReady('ChatAgentEvalRun')) {
      const runs = await prisma.$queryRaw<Array<{ passRate: number; createdAt: Date }>>`
        SELECT "passRate", "createdAt" FROM "ChatAgentEvalRun"
         WHERE "tenantId" = ${tenantId} AND "agentId" = ${agentId} AND "suite" = 'probar_scenarios'
         ORDER BY "createdAt" DESC LIMIT 1`
      if (runs[0]) {
        out.lastPassRate = Math.round(Number(runs[0].passRate) * 100)
        out.lastRunAt = runs[0].createdAt.toISOString()
      }
    }
  } catch {
    // Optional panel: the map still renders without it.
  }
  return out
}
