import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookSharedSecret } from '@/lib/tilopay'
import { applyPurchaseWebhook, isBillingTableMissing } from '@/lib/ai-billing/store'
import { clearCreditAllowanceCache } from '@/lib/ai-billing/allowance'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APPROVED = ['aprobada', 'approved', 'success', 'paid']
const DECLINED = ['rechazada', 'declined', 'failed', 'canceled', 'cancelada']

/**
 * Tilopay notification for an AI credit pack (one-off payment link from /api/billing/ai-credits/checkout).
 * Only this webhook credits a balance — never the browser's success redirect. Checks, in order: Tilopay shared
 * secret / HMAC → known random ref (aicr_…) → approved + amount AND currency equal to the stored server price →
 * one transaction marks the purchase paid and writes the ledger row (UNIQUE source keys: replays are no-ops).
 * Answers 200 for anything already handled or not ours, so Tilopay does not retry forever; logs carry no ids.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifyWebhookSharedSecret(req, raw)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }
  const ref = String(body.referencia ?? body.reference ?? body.orderNumber ?? '').trim()
  if (!/^aicr_[a-f0-9]{32}$/.test(ref)) return NextResponse.json({ ok: true, ignored: true })
  const status = String(body.estado ?? body.status ?? '').toLowerCase()
  const event = String(body.event ?? body.tipo ?? '').toLowerCase()
  const amount = Number(body.monto ?? body.amount)
  const tx = body.transaccion_id ?? body.transaction_id ?? body.id
  try {
    const outcome = await applyPurchaseWebhook({
      ref,
      approved: APPROVED.includes(status) || event === 'payment.approved',
      declined: DECLINED.includes(status),
      // Tilopay sends minor units on this path (same as /api/tilopay/webhook: USD 2000 = $20.00).
      amountCents: Number.isFinite(amount) ? Math.round(amount) : -1,
      currency: String(body.moneda ?? body.currency ?? ''),
      transactionId: tx === undefined || tx === null || tx === '' ? null : String(tx).slice(0, 120),
    })
    if (outcome.result === 'credited') clearCreditAllowanceCache(outcome.tenantId)
    if (outcome.result === 'mismatch') {
      console.warn('[tilopay/webhook-ai-credits] payment does not match the server price')
      return NextResponse.json({ error: 'Payment does not match the purchase' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, result: outcome.result })
  } catch (error) {
    if (isBillingTableMissing(error)) return NextResponse.json({ error: 'Not ready' }, { status: 503 })
    console.error('[tilopay/webhook-ai-credits] failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Webhook failed' }, { status: 500 })
  }
}
