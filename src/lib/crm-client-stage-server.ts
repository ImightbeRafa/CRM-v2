/**
 * Loads, computes and (only when it changed) stores a client's lifecycle stage. Never throws into
 * the page that asked: without migration 035 the stage is still computed, just not stored (and the
 * "table missing" answer is remembered for 5 minutes instead of failing on every view).
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import { recordActivity } from '@/lib/activity'
import { loadStages } from '@/lib/crm-stages-server'
import { stageCategoryOf, stageLabelOf, type StageCategory } from '@/lib/crm-stages'
import {
  CLIENT_STAGE_RULES_VERSION,
  deriveClientStage,
  resolveClientStage,
  type ClientStageSnapshot,
  type StoredClientStage,
} from '@/lib/crm-client-stage'

export type ClientStageDto = {
  key: string
  label: string
  category: StageCategory
  color: string | null
  source: 'auto' | 'manual'
  reason: string
  enteredAt: string | null
  /** 2+ purchases: "Cliente recurrente" shown even while a new order is in progress. */
  repeatCustomer: boolean
  /** false before migration 035: the stage is shown but cannot be pinned by hand. */
  editable: boolean
}

let tableMissingUntil = 0

function foldStatus(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export async function loadClientStageSnapshot(tenantId: string, clientId: string): Promise<ClientStageSnapshot> {
  const [orders, terminal, conversations] = await Promise.all([
    prisma.order.findMany({
      where: { tenantId, clientId, deletedAt: null },
      orderBy: { timestamp: 'desc' },
      take: 20,
      select: { id: true, orderId: true, status: true, timestamp: true, contraEntrega: true, cePaymentConfirmed: true, customFields: true },
    }),
    // Statuses the business marked as finished (same source Producción uses).
    prisma.tenantOrderStatusClassification.findMany({
      where: { tenantId, isTerminal: true },
      select: { statusValue: true, normalizedStatusValue: true },
    }),
    // The client's chats first: the "team replied" check then uses the conversation index
    // instead of scanning every staff message of the business.
    prisma.chatConversation.findMany({ where: { tenantId, clientId }, select: { id: true }, take: 20 }),
  ])
  const terminalSet = new Set(terminal.flatMap((t) => [foldStatus(t.statusValue), foldStatus(t.normalizedStatusValue)]))
  const guias = orders.length
    ? await prisma.shippingGuia.findMany({
        // Successful guías only: a failed Correos attempt must not move the client to "Enviado".
        where: {
          tenantId,
          orderId: { in: orders.map((o) => o.orderId) },
          OR: [{ status: 'completed' }, { guiaNumber: { not: null } }],
          NOT: { status: 'failed' },
        },
        select: { orderId: true },
      })
    : []
  const withGuia = new Set(guias.map((g) => g.orderId))
  const replied = conversations.length
    ? await prisma.chatMessage.findFirst({
        where: { tenantId, conversationId: { in: conversations.map((c) => c.id) }, direction: 'outbound', senderUserId: { not: null } },
        select: { id: true },
      })
    : null
  return {
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      timestamp: o.timestamp,
      contraEntrega: o.contraEntrega,
      cePaymentConfirmed: o.cePaymentConfirmed,
      customFields: o.customFields,
      hasGuia: withGuia.has(o.orderId),
      terminal: terminalSet.has(foldStatus(o.status)),
    })),
    humanReplied: Boolean(replied),
  }
}

async function readStored(tenantId: string, clientId: string): Promise<(StoredClientStage & { enteredAt: Date }) | null | 'unavailable'> {
  if (Date.now() < tableMissingUntil) return 'unavailable'
  try {
    return await prisma.clientLifecycleState.findFirst({
      where: { clientId, tenantId },
      select: { stageKey: true, source: true, fingerprint: true, enteredAt: true },
    })
  } catch (error) {
    if (isMissingRelation(error)) {
      tableMissingUntil = Date.now() + 5 * 60_000
      return 'unavailable'
    }
    throw error
  }
}

type StateWrite = {
  stageKey: string
  source: 'auto' | 'manual'
  fingerprint: string
  evidenceAt: Date | null
  setByUserId: string | null
  resetEnteredAt: boolean
}

/**
 * Tenant-scoped write (SecureDog DATA-08): update only a row of THIS business, create otherwise.
 * An upsert keyed on clientId alone could overwrite another business's row if a future caller
 * passed an unchecked id.
 */
async function writeState(tenantId: string, clientId: string, w: StateWrite): Promise<void> {
  const now = new Date()
  const updated = await prisma.clientLifecycleState.updateMany({
    where: { clientId, tenantId },
    data: {
      stageKey: w.stageKey,
      source: w.source,
      fingerprint: w.fingerprint,
      rulesVersion: CLIENT_STAGE_RULES_VERSION,
      evidenceAt: w.evidenceAt,
      computedAt: now,
      setByUserId: w.setByUserId,
      ...(w.resetEnteredAt ? { enteredAt: now } : {}),
    },
  })
  if (updated.count > 0) return
  try {
    await prisma.clientLifecycleState.create({
      data: {
        clientId,
        tenantId,
        stageKey: w.stageKey,
        source: w.source,
        fingerprint: w.fingerprint,
        rulesVersion: CLIENT_STAGE_RULES_VERSION,
        evidenceAt: w.evidenceAt,
        setByUserId: w.setByUserId,
      },
    })
  } catch (error) {
    if ((error as { code?: string })?.code !== 'P2002') throw error
    // Another request created the row between our update and create: apply ours on top once
    // (otherwise a first-ever manual pick could be lost to a concurrent auto write).
    await prisma.clientLifecycleState.updateMany({
      where: { clientId, tenantId },
      data: {
        stageKey: w.stageKey,
        source: w.source,
        fingerprint: w.fingerprint,
        rulesVersion: CLIENT_STAGE_RULES_VERSION,
        evidenceAt: w.evidenceAt,
        computedAt: now,
        setByUserId: w.setByUserId,
      },
    })
  }
}

/** Callers must pass a clientId that belongs to tenantId; this checks it again (defence in depth). */
export async function getClientStage(tenantId: string, clientId: string): Promise<ClientStageDto | null> {
  const client = await prisma.client.findFirst({ where: { id: clientId, tenantId }, select: { id: true } })
  if (!client) return null
  const [snapshot, stored, stageList] = await Promise.all([
    loadClientStageSnapshot(tenantId, clientId),
    readStored(tenantId, clientId),
    loadStages(tenantId, 'client'),
  ])
  const derived = deriveClientStage(snapshot)
  const storedRow = stored === 'unavailable' ? null : stored
  const resolved = resolveClientStage(derived, storedRow)
  let enteredAt = storedRow?.enteredAt ?? null

  if (stored !== 'unavailable' && resolved.changed) {
    const keyChanged = !storedRow || storedRow.stageKey !== resolved.key
    try {
      await writeState(tenantId, clientId, {
        stageKey: resolved.key,
        source: 'auto',
        fingerprint: derived.fingerprint,
        evidenceAt: derived.evidenceAt,
        setByUserId: null,
        resetEnteredAt: keyChanged,
      })
      if (keyChanged) {
        enteredAt = new Date()
        void recordActivity({
          tenantId,
          actorUserId: null,
          actorKind: 'system',
          verb: 'client.stage.auto',
          entityType: 'Client',
          entityId: clientId,
          clientId,
          props: { from: storedRow?.stageKey ?? null, to: resolved.key },
          dedupeKey: `client.stage:${clientId}:${derived.fingerprint}`,
        })
      }
    } catch (error) {
      if (!isMissingRelation(error)) console.warn('[client-stage] not stored', error instanceof Error ? error.message : error)
    }
  }
  const def = stageList.stages.find((s) => s.key === resolved.key)
  return {
    key: resolved.key,
    label: stageLabelOf(stageList.stages, resolved.key),
    category: stageCategoryOf(stageList.stages, resolved.key),
    color: def?.color ?? null,
    source: resolved.source,
    reason: resolved.source === 'manual' ? 'Elegida por el equipo' : derived.reason,
    enteredAt: enteredAt ? enteredAt.toISOString() : null,
    repeatCustomer: derived.repeatCustomer,
    editable: stored !== 'unavailable' && stageList.available,
  }
}

/** A human pins the stage (sticks until the evidence changes). */
export async function setClientStageManually(args: {
  tenantId: string
  clientId: string
  stageKey: string
  userId: string
}): Promise<{ ok: true; stage: ClientStageDto } | { ok: false; status: number; error: string }> {
  const client = await prisma.client.findFirst({ where: { id: args.clientId, tenantId: args.tenantId }, select: { id: true } })
  if (!client) return { ok: false, status: 404, error: 'Cliente no encontrado' }
  const { stages, available } = await loadStages(args.tenantId, 'client')
  if (!available) return { ok: false, status: 503, error: 'Las etapas de cliente aún no están disponibles.' }
  if (!stages.some((s) => s.key === args.stageKey && !s.archived)) return { ok: false, status: 400, error: 'Etapa inválida' }
  const derived = deriveClientStage(await loadClientStageSnapshot(args.tenantId, args.clientId))
  const stored = await readStored(args.tenantId, args.clientId)
  if (stored === 'unavailable') return { ok: false, status: 503, error: 'Las etapas de cliente aún no están disponibles.' }
  await writeState(args.tenantId, args.clientId, {
    stageKey: args.stageKey,
    source: 'manual',
    fingerprint: derived.fingerprint,
    evidenceAt: derived.evidenceAt,
    setByUserId: args.userId,
    resetEnteredAt: stored?.stageKey !== args.stageKey,
  })
  void recordActivity({
    tenantId: args.tenantId,
    actorUserId: args.userId,
    verb: 'client.stage.set',
    entityType: 'Client',
    entityId: args.clientId,
    clientId: args.clientId,
    props: { from: stored?.stageKey ?? null, to: args.stageKey },
  })
  const stage = await getClientStage(args.tenantId, args.clientId)
  return stage ? { ok: true, stage } : { ok: false, status: 404, error: 'Cliente no encontrado' }
}
