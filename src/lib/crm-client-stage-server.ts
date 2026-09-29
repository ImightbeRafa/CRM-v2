/**
 * Loads, computes and (only when it changed) stores a client's lifecycle stage. Never throws into
 * the page that asked: without migration 035 the stage is still computed, just not stored.
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
}

export async function loadClientStageSnapshot(tenantId: string, clientId: string): Promise<ClientStageSnapshot> {
  const orders = await prisma.order.findMany({
    where: { tenantId, clientId, deletedAt: null },
    orderBy: { timestamp: 'desc' },
    take: 20,
    select: { id: true, orderId: true, status: true, timestamp: true, contraEntrega: true, cePaymentConfirmed: true, customFields: true },
  })
  const guias = orders.length
    ? await prisma.shippingGuia.findMany({
        where: { tenantId, orderId: { in: orders.map((o) => o.orderId) } },
        select: { orderId: true },
      })
    : []
  const withGuia = new Set(guias.map((g) => g.orderId))
  const replied = await prisma.chatMessage.findFirst({
    where: { tenantId, direction: 'outbound', senderUserId: { not: null }, conversation: { clientId } },
    select: { id: true },
  })
  return {
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      timestamp: o.timestamp,
      contraEntrega: o.contraEntrega,
      cePaymentConfirmed: o.cePaymentConfirmed,
      customFields: o.customFields,
      hasGuia: withGuia.has(o.orderId),
    })),
    humanReplied: Boolean(replied),
  }
}

async function readStored(tenantId: string, clientId: string): Promise<(StoredClientStage & { enteredAt: Date }) | null | 'unavailable'> {
  try {
    const row = await prisma.clientLifecycleState.findFirst({
      where: { clientId, tenantId },
      select: { stageKey: true, source: true, fingerprint: true, enteredAt: true },
    })
    return row
  } catch (error) {
    if (isMissingRelation(error)) return 'unavailable'
    throw error
  }
}

export async function getClientStage(tenantId: string, clientId: string, actorUserId?: string | null): Promise<ClientStageDto> {
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
      await prisma.clientLifecycleState.upsert({
        where: { clientId },
        create: {
          clientId,
          tenantId,
          stageKey: resolved.key,
          source: 'auto',
          fingerprint: derived.fingerprint,
          rulesVersion: CLIENT_STAGE_RULES_VERSION,
          evidenceAt: derived.evidenceAt,
        },
        update: {
          stageKey: resolved.key,
          source: 'auto',
          fingerprint: derived.fingerprint,
          rulesVersion: CLIENT_STAGE_RULES_VERSION,
          evidenceAt: derived.evidenceAt,
          computedAt: new Date(),
          ...(keyChanged ? { enteredAt: new Date(), setByUserId: null } : {}),
        },
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
      // Two readers racing: the other one stored it. Anything else: show the computed stage.
      if (!isMissingRelation(error)) console.warn('[client-stage] not stored', error instanceof Error ? error.message : error)
    }
  }
  void actorUserId
  const def = stageList.stages.find((s) => s.key === resolved.key)
  return {
    key: resolved.key,
    label: stageLabelOf(stageList.stages, resolved.key),
    category: stageCategoryOf(stageList.stages, resolved.key),
    color: def?.color ?? null,
    source: resolved.source,
    reason: resolved.source === 'manual' ? 'Elegida por el equipo' : derived.reason,
    enteredAt: enteredAt ? enteredAt.toISOString() : null,
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
  await prisma.clientLifecycleState.upsert({
    where: { clientId: args.clientId },
    create: {
      clientId: args.clientId,
      tenantId: args.tenantId,
      stageKey: args.stageKey,
      source: 'manual',
      fingerprint: derived.fingerprint,
      rulesVersion: CLIENT_STAGE_RULES_VERSION,
      evidenceAt: derived.evidenceAt,
      setByUserId: args.userId,
    },
    update: {
      stageKey: args.stageKey,
      source: 'manual',
      fingerprint: derived.fingerprint,
      computedAt: new Date(),
      setByUserId: args.userId,
      ...(stored?.stageKey !== args.stageKey ? { enteredAt: new Date() } : {}),
    },
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
  return { ok: true, stage: await getClientStage(args.tenantId, args.clientId) }
}
