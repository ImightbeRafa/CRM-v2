/**
 * Agentes IA 2.0 · E — "Corregir" (live tuning), server side. The owner tells the agent how it should have answered
 * (test chat or a real chat) and this saves it through the same admin functions the UI and the agent-pack script use
 * (validation, version bump, audit):
 *   example     → one more P/R pair in the agent's own FAQ document "<agent> · Correcciones" (new approved version,
 *                 bound to the agent, old versions unbound; only the latest 3 versions keep their text — DATA-51).
 *                 Knowledge is DATA in the prompt (its own budget, V1), so it shapes answers.
 *   saved_reply → a guide saved reply (playbook, key fix_<title>_<random>, listed first in the prompt — V2).
 *   rule        → a "Siempre" / "Nunca" line in the selling rules (max 10 each, 8 KB guard kept), saved under a row
 *                 lock on the agent so two saves at once never drop a line.
 * Every save bumps the agent version (lines stay on; drift only suggests re-testing) and is audited
 * ('chat_agent_tune'). Never an AI call; never payment data, confirmation wording, links, Betsy markers or an amount
 * the agent can't quote. Real chats: the texts come from the database (INT-107), never from the client.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { parseBrandFactsSafe } from '@/lib/soft-ai/brand-facts'
import { loadAgentSalesContext } from '@/lib/soft-ai/agent-sales-context'
import { loadMappedInventoryIds } from '@/lib/soft-ai/agent-inventory-map'
import { salesAllowedAmounts, salesFreeShippingRule } from '@/lib/soft-ai/sales-state'
import { redactPiiText } from '@/lib/soft-ai/llm/redact'
import type { FreeShippingRule } from '@/lib/soft-ai/llm/output-validator'
import {
  approveKnowledgeSource,
  bindKnowledgeToAgent,
  createKnowledgeSource,
  mapKnowledgeAdminError,
  unbindKnowledgeFromAgent,
} from '@/lib/soft-ai/knowledge-admin'
import { KNOWLEDGE_NAME_MAX } from '@/lib/soft-ai/knowledge-types'
import { createShortcut, listShortcuts, shortcutErrorStatus } from '@/lib/soft-ai/shortcut-admin'
import { isReservedShortcutKey, TUNE_SHORTCUT_PREFIX, validateShortcutForSave, type ShortcutDraft } from '@/lib/soft-ai/shortcuts'
import { loadSalesSetup, saveSalesSetup, SalesRulesTooLargeError, SalesSetupNotReadyError } from '@/lib/soft-ai/agent-sales-setup'
import {
  brandDomainsFrom,
  checkCorrectionText,
  correctionAnswer,
  ownerTextProblem,
  placeRule,
  ruleTarget,
  sanitizeTuneQuestion,
  savedReplyKey,
  savedReplyTitle,
  TUNE_AUDIT_REPLY_MAX,
  TUNE_CODE_REPLY_NOTE,
  TUNE_VERSIONS_WITH_CONTENT,
  upsertCorrectionPair,
  type TuneBody,
  type TuneSaveAs,
} from '@/lib/soft-ai/agent-tuning-core'

/** Bound before the other FAQs (the corrections also have their own prompt budget, knowledge-types V1). */
const CORRECTIONS_PRIORITY = 10
/** fix_* saved replies: low sortOrder, newest first (each new one goes one below the lowest fix_*), V2. */
const SHORTCUT_TUNE_SORT = 10

/** A refusal the route shows as-is. */
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

type SalesFacts = {
  allowed: number[]
  allowedDeals: Array<'free_shipping' | 'special_price'>
  freeShippingRule: FreeShippingRule | null
  brandDomains: string[]
}

/** Prices the agent may quote (the same list the live validator uses + mapped prices for big catalogs), its promo deals and own site. */
async function salesFactsFor(tenantId: string, agent: { id: string; brandFacts: unknown }): Promise<SalesFacts> {
  const facts = parseBrandFactsSafe(agent.brandFacts)
  const ids = await loadMappedInventoryIds(tenantId, agent.id).catch(() => null)
  const ctx = await loadAgentSalesContext({ tenantId, agentId: agent.id, inventoryItemIds: ids, brandFacts: facts })
  let allowed = salesAllowedAmounts(ctx)
  if (!ctx.catalog && ids && ids.length) {
    // Over the inline size the live turn looks prices up; here the mapped products' own prices count.
    const items = await prisma.inventoryItem.findMany({
      where: { tenantId, isActive: true, id: { in: ids.slice(0, 200) } },
      select: { name: true, sellingPrice: true },
    })
    allowed = salesAllowedAmounts({ ...ctx, catalog: items.map((i) => ({ name: i.name, price: Number(i.sellingPrice), stockLabel: 'disponible' })) })
  }
  return {
    allowed,
    allowedDeals: [...(ctx.promo?.freeShipping ? (['free_shipping'] as const) : []), ...(ctx.promo?.specialPrice ? (['special_price'] as const) : [])],
    freeShippingRule: salesFreeShippingRule(ctx),
    brandDomains: brandDomainsFrom([facts.website, facts.catalogUrl]),
  }
}

/** The owner's text as written (invisible characters dropped), or a refusal naming the problem phrase (V9). */
function ownerText(text: string, field: string, brandDomains: string[]): string {
  const r = ownerTextProblem(text, field, brandDomains)
  if (!r.ok) throw new TuneRefusal(r.code, r.error)
  return r.text
}

function refuseIfBad(text: string | null, facts: SalesFacts, field: string, neverRule = false) {
  if (!text) return
  const check = checkCorrectionText(text, facts.allowed, field, {
    neverRule,
    allowedDeals: facts.allowedDeals,
    freeShippingRule: facts.freeShippingRule,
  })
  if (!check.ok) throw new TuneRefusal(check.code, check.error)
}

function correctionsName(agentName: string, agentId: string, taken: boolean): string {
  const suffix = taken ? ` (${agentId.slice(-4)})` : ''
  const base = `${agentName.trim() || 'Agente'}`.slice(0, KNOWLEDGE_NAME_MAX - ' · Correcciones'.length - suffix.length)
  return `${base} · Correcciones${suffix}`
}

const tuningOf = (agentId: string) => ({ metadata: { path: ['agentTuning'], equals: agentId } }) satisfies Prisma.ChatKnowledgeSourceWhereInput

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'

async function saveExample(tenantId: string, agent: { id: string; name: string }, question: string, answer: string, actor: Actor) {
  // V10: the agent's own corrections document, wherever it is — approved or archived, bound or not — latest first.
  const current = await prisma.chatKnowledgeSource.findFirst({
    where: { tenantId, kind: 'faq', status: { in: ['approved', 'archived'] }, contentPurgedAt: null, ...tuningOf(agent.id) },
    orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
    select: { id: true, name: true, body: true, version: true, status: true },
  })
  const body = upsertCorrectionPair(current?.body ?? '', { question, answer })
  if (current && current.status === 'approved' && current.body.trim() === body.trim()) {
    const bound = await prisma.chatAgentKnowledgeSource.count({ where: { tenantId, agentId: agent.id, sourceId: current.id } })
    if (bound) return { targetId: current.id, unchanged: true }
  }

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
  // DATA-51: the audit rows of these saves keep the length, not the whole corrections text.
  const created = await createKnowledgeSource({ tenantId, ...actor, kind: 'faq', name, body, metadata: { agentTuning: agent.id }, auditBody: 'omit' })
  await approveKnowledgeSource({ tenantId, sourceId: created.id, ...actor, auditBody: 'omit' })
  await bindKnowledgeToAgent({ tenantId, agentId: agent.id, sourceId: created.id, priority: CORRECTIONS_PRIORITY, ...actor })
  // Every older corrections version bound to this agent goes (one document per agent).
  const links = await prisma.chatAgentKnowledgeSource.findMany({ where: { tenantId, agentId: agent.id, sourceId: { not: created.id } }, select: { sourceId: true } })
  const stale = links.length
    ? await prisma.chatKnowledgeSource.findMany({ where: { tenantId, id: { in: links.map((l) => l.sourceId) }, ...tuningOf(agent.id) }, select: { id: true } })
    : []
  for (const s of stale) await unbindKnowledgeFromAgent({ tenantId, agentId: agent.id, sourceId: s.id, ...actor })
  await purgeOldCorrections(tenantId, agent.id)
  return { targetId: created.id, unchanged: false }
}

/**
 * DATA-51: only the latest TUNE_VERSIONS_WITH_CONTENT versions keep their text. Older ARCHIVED versions keep the row
 * (history, hash, audit) with the body emptied and contentPurgedAt set — never a hard delete, never an approved row.
 */
async function purgeOldCorrections(tenantId: string, agentId: string) {
  const versions = await prisma.chatKnowledgeSource.findMany({
    where: { tenantId, kind: 'faq', contentPurgedAt: null, ...tuningOf(agentId) },
    orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
    select: { id: true, status: true },
    take: 200,
  })
  const old = versions.slice(TUNE_VERSIONS_WITH_CONTENT).filter((v) => v.status === 'archived').map((v) => v.id)
  if (old.length) {
    await prisma.chatKnowledgeSource.updateMany({
      where: { tenantId, id: { in: old }, status: 'archived' },
      data: { body: '', contentPurgedAt: new Date() },
    })
  }
}

async function saveSavedReply(tenantId: string, agentId: string, body: string, title: string | null, actor: Actor) {
  const listed = await listShortcuts(tenantId, agentId)
  if (!listed.schemaReady) throw new TuneRefusal('not_ready', 'Las respuestas guardadas todavía no están disponibles.', 503)
  const fixSorts = listed.shortcuts.filter((s) => s.key.startsWith(TUNE_SHORTCUT_PREFIX)).map((s) => s.sortOrder)
  // Newest first: one below the lowest correction so far (never below 0).
  const sortOrder = fixSorts.length ? Math.max(0, Math.min(SHORTCUT_TUNE_SORT, ...fixSorts) - 1) : SHORTCUT_TUNE_SORT
  // INT-103 c: title = the owner's or "Respuesta corregida"; the key comes from the title + a random suffix.
  const finalTitle = savedReplyTitle(title)
  const draft: ShortcutDraft = {
    key: savedReplyKey(finalTitle, new Set(listed.shortcuts.map((s) => s.key))),
    title: finalTitle,
    kind: 'playbook',
    intents: [],
    keywords: [],
    body,
    deliveryMode: 'guide',
    isActive: true,
    sortOrder,
  }
  const valid = validateShortcutForSave(draft)
  if (!valid.ok) throw new TuneRefusal(valid.code, 'La respuesta no se pudo guardar como respuesta guardada (revisá el texto y el título).')
  const row = await createShortcut({ tenantId, agentId, ...actor, draft })
  return { targetId: row.id, key: row.key }
}

/**
 * Concurrent rule saves (read-modify-write of the selling rules): the agent row is locked (SELECT … FOR UPDATE) for
 * the read, the merge and the write, so a second save waits and then reads the first one's lines.
 */
async function saveRule(tenantId: string, agentId: string, note: string, actorUserId: string) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ChatAgent" WHERE "id" = ${agentId} AND "tenantId" = ${tenantId} FOR UPDATE`
      const setup = await loadSalesSetup(tenantId, agentId, tx)
      const placed = placeRule(setup.salesRules, note)
      if (!placed.text) throw new TuneRefusal('empty', 'La regla quedó vacía. Escribila completa, por ejemplo: "nunca prometas bajar de peso".')
      // saveSalesSetup keeps the 8 KB CHECK (SalesRulesTooLargeError) and re-parses the lists (max 10 each).
      await saveSalesSetup(tenantId, agentId, { salesRules: { mustSay: placed.mustSay, neverSay: placed.neverSay } }, actorUserId, tx)
      // The rules live outside ChatAgent: bump the version so the change shows as "volvé a probar", like other edits.
      await tx.chatAgent.updateMany({ where: { id: agentId, tenantId }, data: { version: { increment: 1 }, updatedBy: actorUserId } })
      return { target: placed.target, text: placed.text }
    },
    { timeout: 15_000 },
  )
}

/** Save errors in Spanish, per save type (V10). TuneRefusal passes through. */
function saveFailure(saveAs: TuneSaveAs, error: unknown): TuneRefusal {
  if (error instanceof TuneRefusal) return error
  if (saveAs === 'example') {
    if (isUniqueViolation(error)) return new TuneRefusal('conflict', 'Otra corrección se guardó al mismo tiempo. Intentá de nuevo.', 409)
    const k = mapKnowledgeAdminError(error)
    if (k) {
      return k.status === 503 && k.body.code === 'KNOWLEDGE_SCHEMA_NOT_READY'
        ? new TuneRefusal('not_ready', 'Los ejemplos todavía no están disponibles.', 503)
        : new TuneRefusal(k.body.code || 'example_failed', 'No se pudo guardar el ejemplo. Intentá de nuevo.', k.status >= 500 ? 503 : 409)
    }
  } else if (saveAs === 'saved_reply') {
    if (isUniqueViolation(error)) return new TuneRefusal('conflict', 'Ya existe una respuesta guardada con esa clave. Intentá de nuevo.', 409)
    const s = shortcutErrorStatus(error)
    if (s) {
      return new TuneRefusal(
        s.code,
        s.code === 'confirmation_wording'
          ? 'La respuesta dice que un pago o pedido está confirmado. El agente nunca confirma pagos ni pedidos.'
          : 'No se pudo guardar la respuesta guardada. Revisá el texto y el título.',
        s.status,
      )
    }
  } else {
    if (error instanceof SalesRulesTooLargeError) return new TuneRefusal('rules_full', 'Las reglas de venta ya están llenas. Guardá esta corrección como ejemplo.')
    if (error instanceof SalesSetupNotReadyError) return new TuneRefusal('not_ready', 'Las reglas de venta todavía no están disponibles.', 503)
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2028' || error.code === 'P2034')) {
      return new TuneRefusal('conflict', 'Otra persona cambió las reglas al mismo tiempo. Intentá de nuevo.', 409)
    }
  }
  throw error
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export type TuneSource = {
  messageId: string
  conversationId: string
  agentReply: string
  customerMessageId: string
  customerText: string
  /** Sent by code (a keyword saved reply / a system message), not written by the agent: nothing to correct here. */
  decidedByCode: boolean
}

/**
 * INT-107 / V6: a real chat's AI message and the customer message it answered, from the database. Tenant-scoped; the
 * conversation must be this tenant's; the message must be an outbound AI message of THIS agent (send snapshot).
 */
export async function loadTuneSource(tenantId: string, agentId: string, messageId: string): Promise<TuneSource> {
  const notFound = new TuneRefusal('message_not_found', 'No encontramos ese mensaje del agente.', 404)
  const msg = await prisma.chatMessage.findFirst({
    where: { id: messageId, tenantId, direction: 'outbound' },
    select: { id: true, content: true, metadata: true, conversationId: true },
  })
  if (!msg?.conversationId) throw notFound
  const conversation = await prisma.chatConversation.findFirst({ where: { id: msg.conversationId, tenantId }, select: { id: true } })
  if (!conversation) throw notFound
  const meta = asRecord(msg.metadata)
  // INT-108: only a message with its own recorded agent, and only that agent.
  if (meta.softAi !== true || meta.agentId !== agentId) throw new TuneRefusal('not_this_agent', 'Ese mensaje no lo mandó este agente.', 404)
  let decidedByCode = meta.replyBy === 'code'
  let answersId = typeof meta.answersMessageId === 'string' ? meta.answersMessageId : null
  if (typeof meta.turnId === 'string' && (!answersId || meta.replyBy === undefined)) {
    // Older messages (before replyBy / answersMessageId were recorded): the turn row knows both.
    const turn = await prisma.chatAgentTurn.findFirst({
      where: { id: meta.turnId, tenantId, agentId },
      select: { triggerMessageId: true, shortcutKey: true },
    })
    answersId = answersId ?? turn?.triggerMessageId ?? null
    if (meta.replyBy === undefined && turn?.shortcutKey) {
      if (isReservedShortcutKey(turn.shortcutKey) || turn.shortcutKey.startsWith('sys_')) decidedByCode = true
      else {
        const sc = await prisma.chatAgentShortcut.findFirst({ where: { tenantId, agentId, key: turn.shortcutKey }, select: { deliveryMode: true } })
        if (sc?.deliveryMode === 'verbatim') decidedByCode = true
      }
    }
  }
  if (!answersId) throw new TuneRefusal('customer_not_found', 'No encontramos el mensaje del cliente que respondió el agente.', 404)
  const customer = await prisma.chatMessage.findFirst({
    where: { id: answersId, tenantId, conversationId: msg.conversationId, direction: 'inbound' },
    select: { id: true, content: true },
  })
  if (!customer) throw new TuneRefusal('customer_not_found', 'No encontramos el mensaje del cliente que respondió el agente.', 404)
  return {
    messageId: msg.id,
    conversationId: msg.conversationId,
    agentReply: msg.content || '',
    customerMessageId: customer.id,
    customerText: customer.content || '',
    decidedByCode,
  }
}

/** GET for the panel (real chats): what the agent will see of the question, its reply and where it is saved. */
export async function tunePanelSource(input: { tenantId: string; agentId: string; messageId: string }) {
  const agent = await prisma.chatAgent.findFirst({ where: { id: input.agentId, tenantId: input.tenantId }, select: { id: true, name: true } })
  if (!agent) throw new TuneRefusal('AGENT_NOT_FOUND', 'Agente no encontrado', 404)
  const src = await loadTuneSource(input.tenantId, agent.id, input.messageId)
  return {
    agentName: agent.name,
    customerMessage: sanitizeTuneQuestion(src.customerText),
    agentReply: src.agentReply,
    decidedByCode: src.decidedByCode,
    note: src.decidedByCode ? TUNE_CODE_REPLY_NOTE : null,
  }
}

export type TuneResult = { saveAs: TuneSaveAs; targetId?: string; key?: string; rule?: { target: 'mustSay' | 'neverSay'; text: string }; unchanged?: boolean; version: number | null }

export async function tuneAgent(input: { tenantId: string; agentId: string; body: TuneBody } & Actor): Promise<TuneResult> {
  const { tenantId, body } = input
  const actor: Actor = { actorUserId: input.actorUserId, actorName: input.actorName, actorRole: input.actorRole }
  const agent = await prisma.chatAgent.findFirst({ where: { id: input.agentId, tenantId }, select: { id: true, name: true, status: true, brandFacts: true } })
  if (!agent) throw new TuneRefusal('AGENT_NOT_FOUND', 'Agente no encontrado', 404)
  if (agent.status === 'archived') throw new TuneRefusal('AGENT_ARCHIVED', 'Este agente está archivado: restauralo para corregirlo.', 409)

  // INT-107: in a real chat both texts come from the database; the test chat (Probar) has no message to load.
  let agentReply = body.agentReply
  let customerRaw = body.customerMessage
  let source: 'chat' | 'probar' = 'probar'
  let src: TuneSource | null = null
  if (body.messageId) {
    src = await loadTuneSource(tenantId, agent.id, body.messageId)
    if (src.decidedByCode) throw new TuneRefusal('code_reply', TUNE_CODE_REPLY_NOTE, 409)
    agentReply = src.agentReply
    // The owner may shorten the question shown in the panel; empty → the customer's own words. Sanitized either way.
    customerRaw = body.customerMessage || src.customerText
    source = 'chat'
  }
  // INT-103: never the raw customer text in a document every customer's prompt sees.
  const question = sanitizeTuneQuestion(customerRaw)
  if (!question) throw new TuneRefusal('empty', 'Falta el mensaje del cliente.')

  const facts = await salesFactsFor(tenantId, agent)
  // V9: the owner's wording is kept as written; markers, tags or links are refused, naming the phrase.
  const corrected = body.saveAs === 'rule' ? '' : ownerText(body.correctedReply, 'La respuesta', facts.brandDomains)
  const note = body.note ? ownerText(body.note, 'La nota', facts.brandDomains) : null
  const title = body.title ? ownerText(body.title, 'El título', facts.brandDomains) : null
  if (body.saveAs !== 'rule') refuseIfBad(corrected, facts, 'La respuesta')
  // V7: a "nunca …" line names what NOT to say ("nunca digas que el pago está confirmado"): no wording / amount checks.
  refuseIfBad(note, facts, 'La nota', note ? ruleTarget(note) === 'neverSay' : false)
  refuseIfBad(title, facts, 'El título')

  let result: Omit<TuneResult, 'version'>
  try {
    if (body.saveAs === 'example') {
      result = { saveAs: 'example', ...(await saveExample(tenantId, agent, question, correctionAnswer(corrected, note), actor)) }
    } else if (body.saveAs === 'saved_reply') {
      result = { saveAs: 'saved_reply', ...(await saveSavedReply(tenantId, agent.id, correctionAnswer(corrected, note), title, actor)) }
    } else {
      result = { saveAs: 'rule', rule: await saveRule(tenantId, agent.id, note || '', actor.actorUserId) }
    }
  } catch (error) {
    throw saveFailure(body.saveAs, error)
  }

  const after = await prisma.chatAgent.findFirst({ where: { id: agent.id, tenantId }, select: { version: true } })
  await logAuditEvent({
    tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgent',
    entityId: agent.id,
    entityName: agent.name,
    // DATA-51: the agent's reply masked and capped; the message id when known.
    oldValues: {
      agentReply: agentReply ? redactPiiText(agentReply).slice(0, TUNE_AUDIT_REPLY_MAX) : null,
      messageId: src?.messageId ?? null,
      customerMessageId: src?.customerMessageId ?? null,
    },
    newValues: {
      source,
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
