/**
 * Server side of the Mapa de conocimiento: loads what the agent really has, from the same sources the live turn uses
 * (approved + bound knowledge and which of it fits the prompt budget, the saved-reply catalog as the prompt shows it,
 * Config › Métodos de envío, mapped products, brand facts, combos / promo) and the live gaps (turns handed to a person
 * because the agent did not have the answer). Tenant-scoped; read-only. Channel overlays are not included (the map
 * covers the agent's own knowledge; the UI says so).
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
import { listRuntimeShortcuts } from '@/lib/soft-ai/shortcut-repository'
import { guideCatalogRows } from '@/lib/soft-ai/shortcuts'
import { loadSalesSetup } from '@/lib/soft-ai/agent-sales-setup'
import { loadCoverage } from '@/lib/shipping/coverage-store'
import { promoInEffect } from '@/lib/soft-ai/promo'
import { DIGIT_WORDS_RE, normalizeQuestion, sanitizeTuneQuestion } from '@/lib/soft-ai/agent-tuning-core'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { buildKnowledgeMap, gapAnswered, type KnowledgeDocInput, type KnowledgeMap } from '@/lib/soft-ai/knowledge-map'

/** An optional part failed: the map still renders (that part shows as missing), the error name is logged. */
function logSoft<T>(part: string, error: unknown, fallback: T): T {
  console.error('[knowledge-map]', part, error instanceof Error ? error.name : 'unknown')
  return fallback
}

/** Turns are only kept 90 days (retention); the gap list never looks further back. */
export const GAP_WINDOW_DAYS = 90
const GAP_TURNS_MAX = 200
const GAP_GROUPS_MAX = 20

export type KnowledgeGapGroup = {
  /**
   * Best-effort masked customer question (≤200): phones, emails, payment / ID numbers, spelled-out digit runs and the
   * conversation's own contact / client name are replaced. Free text (an address, a health detail) can remain; only
   * people who can edit the agent see it, and they can already read these chats.
   */
  question: string
  count: number
  lastAt: string
  /** One of the turns, for answering it later (the server reloads the text itself). */
  turnId: string
  conversationId: string | null
  /** The agent can already see an answer (visible knowledge only). */
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
  /** Gaps show customer questions: only for people who can edit the agent (update_config, like Corregir). */
  includeGaps: boolean
  now?: Date
}): Promise<KnowledgeMapResult | null> {
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
    select: { id: true, name: true, brandFacts: true },
  })
  if (!agent) return null
  const now = input.now ?? new Date()

  const [inventory, slice, shortcuts, sales, coverage] = await Promise.all([
    listMappedInventory(input.tenantId, agent.id),
    // '' = no channel overlays (same as Corregir).
    loadApprovedKnowledgeForAgent({ tenantId: input.tenantId, agentId: agent.id, socialAccountId: '' }),
    listRuntimeShortcuts(input.tenantId, agent.id).catch((e) => logSoft('shortcuts', e, [])),
    loadSalesSetup(input.tenantId, agent.id).catch((e) => logSoft('sales', e, null)),
    loadCoverage(input.tenantId).catch((e) => logSoft('coverage', e, [])),
  ])

  const budgeted = budgetKnowledgeSlice(slice)
  const visibleIds = new Set([...budgeted.brandBook, ...budgeted.policies, ...budgeted.faqs].map((s) => s.id))
  const laneOf = (s: KnowledgeSourceDto): KnowledgeDocInput['lane'] =>
    s.kind === 'faq' ? (isAgentTuningSource(s) ? 'corrections' : 'faq') : 'brand_policy'
  const docs: KnowledgeDocInput[] = [...slice.brandBook, ...slice.policies, ...slice.faqs].map((s) => ({
    name: s.name,
    kind: s.kind,
    body: s.body,
    visible: visibleIds.has(s.id),
    lane: laneOf(s),
  }))

  // Same rule as agent-sales-context: the agent's offered methods (all active ones when none is chosen).
  const offered = new Set(sales?.offeredShippingMethodIds ?? [])
  const methods = coverage.filter((m) => offered.size === 0 || offered.has(m.shippingMethodId))
  const promo = sales?.salesRules.promo
  const map = buildKnowledgeMap({
    products: inventory.items.filter((i) => i.isActive).map((i) => ({ id: i.id, name: i.name, price: i.sellingPrice })),
    docs,
    catalogReplies: guideCatalogRows(shortcuts).map((r) => ({ title: r.title, body: r.body })),
    brandFacts: parseBrandFactsSafe(agent.brandFacts),
    shippingMethods: methods.map((m) => ({ name: m.name, price: Number(m.basePrice) || 0, allowsCod: m.allowsCod })),
    freeShippingBundles: (sales?.salesRules.bundles ?? []).filter((b) => b.shippingIncluded === true).map((b) => b.name),
    promoFreeShipping: Boolean(promo && promoInEffect(promo, now) && promo.freeShipping && promo.freeShippingMethodIds.length === 0),
    budgets: { brand_policy: KNOWLEDGE_LAYER2_CHAR_BUDGET, faq: KNOWLEDGE_LAYER34_CHAR_BUDGET, corrections: KNOWLEDGE_TUNING_CHAR_BUDGET },
  })

  const visibleBodies = docs.filter((d) => d.visible).map((d) => d.body)
  const gaps = input.includeGaps ? await loadGaps(input.tenantId, agent.id, visibleBodies, now) : null
  return {
    ...map,
    agentName: agent.name,
    gaps,
    goldTest: await loadGoldTest(input.tenantId, agent.id),
    productsAvailable: inventory.available,
  }
}

async function loadGaps(tenantId: string, agentId: string, visibleBodies: string[], now: Date): Promise<KnowledgeGapGroup[]> {
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
  const convIds = [...new Set(turns.map((t) => t.conversationId).filter((id): id is string => Boolean(id)))]
  const [messages, conversations] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { tenantId, id: { in: ids }, direction: 'inbound' },
      select: { id: true, content: true },
    }),
    prisma.chatConversation.findMany({
      where: { tenantId, id: { in: convIds } },
      select: { id: true, peerName: true, client: { select: { name: true } } },
    }),
  ])
  const textById = new Map(messages.map((m) => [m.id, m.content || '']))
  const namesById = new Map(conversations.map((c) => [c.id, [c.peerName, c.client?.name].filter((n): n is string => Boolean(n))]))
  return groupGaps(
    turns.map((t) => ({
      id: t.id,
      createdAt: t.createdAt,
      conversationId: t.conversationId,
      text: t.triggerMessageId ? textById.get(t.triggerMessageId) ?? '' : '',
      names: t.conversationId ? namesById.get(t.conversationId) ?? [] : [],
    })),
    visibleBodies,
  )
}

const ACCENTS: Record<string, string> = { a: '[aáàäâ]', e: '[eéèëê]', i: '[iíìïî]', o: '[oóòöô]', u: '[uúùüû]', n: '[nñ]' }

/**
 * One accent-insensitive regex for a conversation's contact / client names (≤6 parts of 3–40 letters), built once per
 * conversation (SecureDog DATA-57 round 2: "perez" masks "Pérez"; a huge client name costs nothing extra).
 */
export function namesRegex(names: string[]): RegExp | null {
  const folded = names.join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const parts = [...new Set(folded.split(/[^\p{L}]+/u))].filter((w) => w.length >= 3 && w.length <= 40).slice(0, 6)
  if (!parts.length) return null
  const pattern = parts.map((w) => [...w].map((c) => ACCENTS[c] ?? c).join('')).join('|')
  return new RegExp(`(?<![\\p{L}])(?:${pattern})(?![\\p{L}])`, 'giu')
}

/** Best-effort masking of one customer question (≤200 chars). */
export function maskGapQuestion(text: string, names: string[] | RegExp | null = null): string {
  // Cut first: the sanitizer cost grows with the message (DATA-57).
  let q = sanitizeTuneQuestion(text.slice(0, 1000))
  q = q.replace(new RegExp(DIGIT_WORDS_RE.source, 'giu'), '…')
  const re = Array.isArray(names) ? namesRegex(names) : names
  if (re) q = q.replace(new RegExp(re.source, 'giu'), '…')
  return q.slice(0, 200)
}

/** Masks, groups by normalized question and sorts (unanswered first, then most asked). Pure; exported for tests. */
export function groupGaps(
  turns: Array<{ id: string; createdAt: Date; conversationId: string | null; text: string; names?: string[] }>,
  visibleBodies: string[],
): KnowledgeGapGroup[] {
  const groups = new Map<string, KnowledgeGapGroup>()
  const nameRes = new Map<string, RegExp | null>()
  for (const t of turns) {
    if (!t.text) continue
    const convKey = t.conversationId ?? `turn:${t.id}`
    if (!nameRes.has(convKey)) nameRes.set(convKey, namesRegex(t.names ?? []))
    const question = maskGapQuestion(t.text, nameRes.get(convKey) ?? null)
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
      answered: gapAnswered(question, visibleBodies, normalizeQuestion),
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
  } catch (error) {
    // Optional panel: the map still renders without it.
    logSoft('goldTest', error, null)
  }
  return out
}
