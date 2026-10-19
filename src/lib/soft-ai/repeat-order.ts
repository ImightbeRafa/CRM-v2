/**
 * After a collected order, the next buy is a new sale. A second copy of the same
 * SINPE receipt is not a new payment. Pure: the live turn loads the order.
 */
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'

export type ReceiptProbe = {
  content?: string | null
  providerMediaId?: string | null
  mediaBlobPath?: string | null
}

export type SettledReceiptIndex = {
  mediaKeys: string[]
  fingerprints: string[]
}

const PAYMENT_CUE_RE = /sinpe|comprobante|transfer|pag(?:u[eé]|ó|o|aste|aron)/iu

/** 6+ digit runs on a payment-cue message. A phone with no payment words is not a receipt. */
export function paymentFingerprint(text: string | null | undefined): string | null {
  const value = text || ''
  if (!PAYMENT_CUE_RE.test(value)) return null
  const runs = [...value.matchAll(/\d{6,}/g)].map((match) => match[0])
  if (runs.length === 0) return null
  return [...new Set(runs)].sort().join('|')
}

export function historyAfterSettledOrder<T extends { sentAt: string }>(history: readonly T[], settledAt: string): T[] {
  const cut = Date.parse(settledAt)
  if (!Number.isFinite(cut)) return [...history]
  return history.filter((message) => {
    const at = Date.parse(message.sentAt)
    return Number.isFinite(at) && at > cut
  })
}

export function isDuplicateReceipt(probe: ReceiptProbe, settled: SettledReceiptIndex): boolean {
  const mediaKey = probe.providerMediaId || probe.mediaBlobPath || ''
  if (mediaKey && settled.mediaKeys.includes(mediaKey)) return true
  const fingerprint = paymentFingerprint(probe.content)
  return Boolean(fingerprint && settled.fingerprints.includes(fingerprint))
}

export type LinkedSaleCandidate = {
  sentAt: string
  orderNumber: string
  collected: boolean
}

/** Newest linked order whose payment is already collected. */
export function pickSettledSale(rows: readonly LinkedSaleCandidate[]): { orderNumber: string; settledAt: string } | null {
  let best: LinkedSaleCandidate | null = null
  for (const row of rows) {
    if (!row.collected || !row.orderNumber) continue
    if (!best || Date.parse(row.sentAt) > Date.parse(best.sentAt)) best = row
  }
  return best ? { orderNumber: best.orderNumber, settledAt: best.sentAt } : null
}

export function duplicateReceiptReply(orderNumber: string): string {
  return `Ese comprobante ya está en el pedido ${orderNumber}. No lo cuento otra vez.`
}

export function isPaymentHandoff(decision: { intent: string; handoff: { reason: string } | null }): boolean {
  return decision.intent === 'payment_proof' || decision.handoff?.reason === 'payment'
}

export type HistoryMessage = SoftAiHistoryMessage
