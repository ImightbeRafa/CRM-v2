/**
 * Client lifecycle stage (Phase 2a, 2026-09-29) — a pure function of the client's current data,
 * so it is idempotent and needs no event stream (17+ code paths write orders; hooking them all
 * would miss some). Computed lazily where a human looks, stored only when it changes.
 *
 * Rules v1 (rulesVersion 1; tunable later via CrmStage.entryRules):
 * - an open order (not delivered / cancelled) → its stage: Enviado (guía or "enviado"),
 *   En producción, Pagado (paid or cash on delivery), else Esperando pago;
 * - no open order and ≥ 2 purchases → Recurrente (Rafael: "a client that purchases multiple
 *   times");
 * - one delivered order → Entregado;
 * - no orders: Cotizando once someone on the team replied in chat, else Nuevo lead.
 * A manual choice sticks until the evidence changes (fingerprint).
 */
import { derivePaymentState } from '@/lib/order-payment-status'

export const CLIENT_STAGE_RULES_VERSION = 1

export type ClientStageKey =
  | 'nuevo_lead'
  | 'cotizando'
  | 'esperando_pago'
  | 'pagado'
  | 'en_produccion'
  | 'enviado'
  | 'entregado'
  | 'recurrente'

export type StageOrder = {
  id: string
  status: string | null
  timestamp: Date
  contraEntrega?: boolean | null
  cePaymentConfirmed?: boolean | null
  customFields?: unknown
  hasGuia: boolean
}

export type ClientStageSnapshot = {
  orders: StageOrder[]
  humanReplied: boolean
}

export type DerivedClientStage = {
  key: ClientStageKey
  fingerprint: string
  evidenceAt: Date | null
  reason: string
}

const CANCELLED = new Set(['cancelado', 'cancelada', 'cancelled', 'canceled', 'anulado', 'rechazado', 'devuelto'])
const DELIVERED = new Set(['entregado', 'entregada', 'delivered'])
const SHIPPED = new Set(['enviado', 'enviada', 'shipped', 'en_ruta', 'en-ruta'])
const PRODUCTION = new Set(['en-proceso', 'en_proceso', 'en proceso', 'urgente', 'completado', 'completada', 'produccion', 'en_produccion', 'listo'])

function norm(status: string | null | undefined): string {
  return String(status ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export type OrderPhase = 'cancelled' | 'delivered' | 'shipped' | 'production' | 'pending'

export function orderPhase(order: Pick<StageOrder, 'status' | 'hasGuia'>): OrderPhase {
  const s = norm(order.status)
  if (CANCELLED.has(s)) return 'cancelled'
  if (DELIVERED.has(s)) return 'delivered'
  if (SHIPPED.has(s) || order.hasGuia) return 'shipped'
  if (PRODUCTION.has(s)) return 'production'
  return 'pending'
}

function isPurchase(order: StageOrder, phase: OrderPhase): boolean {
  if (phase === 'cancelled') return false
  if (phase === 'delivered' || phase === 'shipped') return true
  const pay = derivePaymentState(order).key
  return pay === 'pagado' || pay === 'contra_entrega'
}

export function deriveClientStage(snapshot: ClientStageSnapshot): DerivedClientStage {
  const orders = [...snapshot.orders].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  const phased = orders.map((o) => ({ o, phase: orderPhase(o) }))
  const live = phased.filter((x) => x.phase !== 'cancelled')
  const purchases = live.filter((x) => isPurchase(x.o, x.phase)).length
  const open = live.find((x) => x.phase !== 'delivered')

  let key: ClientStageKey
  let reason: string
  let evidenceAt: Date | null = null
  let focusId = ''
  let pay = ''

  if (open) {
    focusId = open.o.id
    evidenceAt = open.o.timestamp
    pay = derivePaymentState(open.o).key
    if (open.phase === 'shipped') {
      key = 'enviado'
      reason = 'Pedido con guía o enviado'
    } else if (open.phase === 'production') {
      key = 'en_produccion'
      reason = 'Pedido en producción'
    } else if (pay === 'pagado' || pay === 'contra_entrega') {
      key = 'pagado'
      reason = pay === 'pagado' ? 'Pedido pagado' : 'Pedido contra entrega'
    } else {
      key = 'esperando_pago'
      reason = 'Pedido sin pago registrado'
    }
  } else if (purchases >= 2) {
    key = 'recurrente'
    reason = `${purchases} compras`
    evidenceAt = live[0]?.o.timestamp ?? null
  } else if (live.length > 0) {
    key = 'entregado'
    reason = 'Pedido entregado'
    evidenceAt = live[0].o.timestamp
    focusId = live[0].o.id
  } else if (snapshot.humanReplied) {
    key = 'cotizando'
    reason = 'Conversación con el equipo, sin pedidos'
  } else {
    key = 'nuevo_lead'
    reason = 'Sin pedidos'
  }

  const fingerprint = [
    CLIENT_STAGE_RULES_VERSION,
    key,
    focusId,
    open ? open.phase : '',
    pay,
    purchases,
    live.length,
    snapshot.humanReplied ? 1 : 0,
  ].join('|')
  return { key, fingerprint, evidenceAt, reason }
}

export type StoredClientStage = {
  stageKey: string
  source: 'auto' | 'manual' | 'backfill' | string
  fingerprint: string | null
}

/**
 * What to show / store: a manual choice sticks while the evidence (fingerprint) is unchanged;
 * new evidence moves the client automatically again.
 */
export function resolveClientStage(
  derived: DerivedClientStage,
  stored: StoredClientStage | null,
): { key: string; source: 'auto' | 'manual'; changed: boolean } {
  if (stored && stored.source === 'manual' && stored.fingerprint === derived.fingerprint) {
    return { key: stored.stageKey, source: 'manual', changed: false }
  }
  const changed = !stored || stored.stageKey !== derived.key || stored.fingerprint !== derived.fingerprint || stored.source !== 'auto'
  return { key: derived.key, source: 'auto', changed }
}
