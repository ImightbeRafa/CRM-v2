/**
 * Agentes IA 2.0 · E — "Corregir" (live tuning), server side. The owner tells the agent how it should have answered
 * (test chat or a real chat) and this saves it through the same admin functions the UI and the agent-pack script use
 * (validation, version bump, audit):
 *   example     → one more P/R pair in the agent's own FAQ document "<agent> · Correcciones" (new approved version,
 *                 bound to the agent, old version unbound). Knowledge is DATA in the prompt, so it shapes answers.
 *   saved_reply → a guide saved reply (playbook, key fix_<slug>) the agent can fetch with use_shortcut.
 *   rule        → a "Siempre" / "Nunca" line in the selling rules (max 10 each, 8 KB guard kept).
 * Every save bumps the agent version (lines stay on; drift only suggests re-testing) and is audited
 * ('chat_agent_tune'). Never an AI call; never payment data, confirmation wording or an amount the agent can't quote.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { parseBrandFactsSafe } from '@/lib/soft-ai/brand-facts'
import { loadAgentSalesContext } from '@/lib/soft-ai/agent-sales-context'
import { loadMappedInventoryIds } from '@/lib/soft-ai/agent-inventory-map'
import { salesAllowedAmounts, stripBetsyLookalikes } from '@/lib/soft-ai/sales-state'
import {
  approveKnowledgeSource,
  bindKnowledgeToAgent,
  createKnowledgeSource,
  unbindKnowledgeFromAgent,
} from '@/lib/soft-ai/knowledge-admin'
import { KNOWLEDGE_NAME_MAX } from '@/lib/soft-ai/knowledge-types'
import { createShortcut, listShortcuts } from '@/lib/soft-ai/shortcut-admin'
import { validateShortcutForSave, type ShortcutDraft } from '@/lib/soft-ai/shortcuts'
import { loadSalesSetup, saveSalesSetup } from '@/lib/soft-ai/agent-sales-setup'
import {
  checkCorrectionText,
  correctionAnswer,
  maskCustomerMessage,
  placeRule,
  savedReplyKey,
  savedReplyTitle,
  upsertCorrectionPair,
  type TuneBody,
  type TuneSaveAs,
} from '@/lib/soft-ai/agent-tuning-core'

/** Bound before the other FAQs so the corrections are the first FAQ kept inside the prompt budget. */
const CORRECTIONS_PRIORITY = 10
const SHORTCUT_TUNE_SORT = 500

/** A refusal the route shows as-is (400). */
export class TuneRefusal extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly status = 400,
  ) {
    super(code)
    this.name = 'TuneRefusal'
  }
}

type Actor = { actorUserId: string; actorName: string; actorRole: string }

/** Prices the agent may quote: the same list the live validator uses (+ mapped prices for big catalogs). */
async function allowedAmountsFor(tenantId: string, agent: { id: string; brandFacts: unknown }): Promise<number[]> {
  const ids = await loadMappedInventoryIds(tenantId, agent.id).catch(() => null)
  const ctx = await loadAgentSalesContext({ tenantId, agentId: agent.id, inventoryItemIds: ids, brandFacts: parseBrandFactsSafe(agent.brandFacts) })
  if (!ctx.catalog && ids && ids.length) {
    // Over the inline size the live turn looks prices up; here the mapped products' own prices count.
    const items = await prisma.inventoryItem.findMany({
      where: { tenantId, isActive: true, id: { in: ids.slice(0, 200) } },
      select: { name: true, sellingPrice: true },
    })
    return salesAllowedAmounts({ ...ctx, catalog: items.map((i) => ({ name: i.name, price: Number(i.sellingPrice), stockLabel: 'disponible' })) })
  }
  return salesAllowedAmounts(ctx)
}

function refuseIfBad(text: string | null, allowed: number[], field: string) {
  if (!text) return
  const check = checkCorrectionText(text, allowed, field)
  if (!check.ok) throw new TuneRefusal(check.code, check.error)
}

function correctionsName(agentName: string, agentId: string, taken: boolean): string {
  const suffix = taken ? ` (${agentId.slice(-4)})` : ''
  const base = `${agentName.trim() || 'Agente'}`.slice(0, KNOWLEDGE_NAME_MAX - ' · Correcciones'.length - suffix.length)
  return `${base} · Correcciones${suffix}`
}

async function saveExample(tenantId: string, agent: { id: string; name: string }, question: string, answer: string, actor: Actor) {
  // The agent's own corrections document: an approved FAQ bound to it and stamped with its id.
  const links = await prisma.chatAgentKnowledgeSource.findMany({ where: { tenantId, agentId: agent.id }, select: { sourceId: true } })
  const bound = links.length
    ? await prisma.chatKnowledgeSource.findMany({
        where: { tenantId, id: { in: links.map((l) => l.sourceId) }, kind: 'faq', status: 'approved' },
        select: { id: true, name: true, body: true, version: true, metadata: true },
        orderBy: { version: 'desc' },
      })
    : []
  const current =
    bound.find((s) => s.metadata && typeof s.metadata === 'object' && !Array.isArray(s.metadata) && (s.metadata as Record<string, unknown>).agentTuning === agent.id) ??
    null
  const body = upsertCorrectionPair(current?.body ?? '', { question, answer })
  if (current && current.body.trim() === body.trim()) return { targetId: current.id, unchanged: true }

  let name = current?.name
  if (!name) {
    // Knowledge names are business-wide and approving archives the same name: never take another agent's document.
    const candidate = correctionsName(agent.name, agent.id, false)
    const same = await prisma.chatKnowledgeSource.findMany({ where: { tenantId, kind: 'faq', name: candidate, status: 'approved' }, select: { id: true } })
    const usedElsewhere = same.length
      ? (await prisma.chatAgentKnowledgeSource.count({ where: { tenantId, sourceId: { in: same.map((s) => s.id) }, agentId: { not: agent.id } } })) > 0
      : false
    name = usedElsewhere ? correctionsName(agent.name, agent.id, true) : candidate
  }
  const created = await createKnowledgeSource({ tenantId, ...actor, kind: 'faq', name, body, metadata: { agentTuning: agent.id } })
  await approveKnowledgeSource({ tenantId, sourceId: created.id, ...actor })
  await bindKnowledgeToAgent({ tenantId, agentId: agent.id, sourceId: created.id, priority: CORRECTIONS_PRIORITY, ...actor })
  if (current) await unbindKnowledgeFromAgent({ tenantId, agentId: agent.id, sourceId: current.id, ...actor })
  return { targetId: created.id, unchanged: false }
}

async function saveSavedReply(tenantId: string, agentId: string, customerMessage: string, body: string, title: string | null, actor: Actor) {
  const listed = await listShortcuts(tenantId, agentId)
  if (!listed.schemaReady) throw new TuneRefusal('not_ready', 'Las respuestas guardadas todavía no están disponibles.', 503)
  const draft: ShortcutDraft = {
    key: savedReplyKey(customerMessage, new Set(listed.shortcuts.map((s) => s.key))),
    title: savedReplyTitle(title, customerMessage),
    kind: 'playbook',
    intents: [],
    keywords: [],
    body,
    deliveryMode: 'guide',
    isActive: true,
    sortOrder: SHORTCUT_TUNE_SORT,
  }
  const valid = validateShortcutForSave(draft)
  if (!valid.ok) throw new TuneRefusal(valid.code, 'La respuesta no se pudo guardar como respuesta guardada (revisá el texto y el título).')
  const row = await createShortcut({ tenantId, agentId, ...actor, draft })
  return { targetId: row.id, key: row.key }
}

async function saveRule(tenantId: string, agentId: string, note: string, actorUserId: string) {
  const setup = await loadSalesSetup(tenantId, agentId)
  const placed = placeRule(setup.salesRules, note)
  if (!placed.text) throw new TuneRefusal('empty', 'La regla quedó vacía. Escribila completa, por ejemplo: "nunca prometas bajar de peso".')
  // saveSalesSetup keeps the 8 KB CHECK (SalesRulesTooLargeError) and re-parses the lists (max 10 each).
  await saveSalesSetup(tenantId, agentId, { salesRules: { mustSay: placed.mustSay, neverSay: placed.neverSay } }, actorUserId)
  // The rules live outside ChatAgent: bump the version so the change shows as "volvé a probar", like other edits.
  await prisma.chatAgent.updateMany({ where: { id: agentId, tenantId }, data: { version: { increment: 1 }, updatedBy: actorUserId } })
  return { target: placed.target, text: placed.text }
}

export type TuneResult = { saveAs: TuneSaveAs; targetId?: string; key?: string; rule?: { target: 'mustSay' | 'neverSay'; text: string }; unchanged?: boolean; version: number | null }

export async function tuneAgent(input: { tenantId: string; agentId: string; body: TuneBody } & Actor): Promise<TuneResult> {
  const { tenantId, body } = input
  const actor: Actor = { actorUserId: input.actorUserId, actorName: input.actorName, actorRole: input.actorRole }
  const agent = await prisma.chatAgent.findFirst({ where: { id: input.agentId, tenantId }, select: { id: true, name: true, status: true, brandFacts: true } })
  if (!agent) throw new TuneRefusal('AGENT_NOT_FOUND', 'Agente no encontrado', 404)
  if (agent.status === 'archived') throw new TuneRefusal('AGENT_ARCHIVED', 'Este agente está archivado: restauralo para corregirlo.', 409)

  // Owner text is data in the prompt: no Betsy look-alike markers.
  const corrected = stripBetsyLookalikes(body.correctedReply).trim()
  const note = body.note ? stripBetsyLookalikes(body.note).trim() : null
  const question = maskCustomerMessage(stripBetsyLookalikes(body.customerMessage))
  if (!question) throw new TuneRefusal('empty', 'Falta el mensaje del cliente.')

  const allowed = await allowedAmountsFor(tenantId, agent)
  if (body.saveAs !== 'rule') refuseIfBad(corrected, allowed, 'La respuesta')
  refuseIfBad(note, allowed, 'La nota')

  let result: Omit<TuneResult, 'version'>
  if (body.saveAs === 'example') {
    result = { saveAs: 'example', ...(await saveExample(tenantId, agent, question, correctionAnswer(corrected, note), actor)) }
  } else if (body.saveAs === 'saved_reply') {
    result = { saveAs: 'saved_reply', ...(await saveSavedReply(tenantId, agent.id, question, correctionAnswer(corrected, note), body.title, actor)) }
  } else {
    result = { saveAs: 'rule', rule: await saveRule(tenantId, agent.id, note || '', actor.actorUserId) }
  }

  const after = await prisma.chatAgent.findFirst({ where: { id: agent.id, tenantId }, select: { version: true } })
  await logAuditEvent({
    tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgent',
    entityId: agent.id,
    entityName: agent.name,
    oldValues: body.agentReply ? { agentReply: body.agentReply.slice(0, 1500) } : null,
    newValues: {
      customerMessage: question,
      correctedReply: body.saveAs === 'rule' ? null : corrected,
      note,
      ...result,
      version: after?.version ?? null,
    },
    userId: actor.actorUserId,
    userName: actor.actorName,
    userRole: actor.actorRole,
    reason: 'chat_agent_tune',
  })
  return { ...result, version: after?.version ?? null }
}
