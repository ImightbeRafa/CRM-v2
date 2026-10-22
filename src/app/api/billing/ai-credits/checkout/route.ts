import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { isSameOriginRequest } from '@/lib/same-origin'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { createPaymentLink } from '@/lib/tilopay'
import { readCustomAgentsFlag } from '@/lib/support/agent-flag'
import { formatUsdCents } from '@/lib/pricing/plan'
import { quotePack } from '@/lib/ai-billing/math'
import {
  aiBillingReady,
  createPendingPurchase,
  deletePendingPurchase,
  getSettings,
  recentPendingPurchases,
} from '@/lib/ai-billing/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const limiter = createIdentifierRateLimit({ windowMs: 60 * 60_000, maxRequests: 6, identifier: 'ai-credits-checkout' })
const MAX_PENDING_24H = 5

const schema = z.object({ packId: z.string().trim().min(1).max(24) })

/**
 * Buy an AI credit pack (agent-enabled businesses, owner only). The price comes from the owner's pack list on the
 * server — never from the request. Creates a pending purchase with a random ref and a one-off Tilopay link for
 * pack + IVA. Credits arrive only through /api/tilopay/webhook-ai-credits.
 */
export async function POST(request: NextRequest) {
  // Billing guard skipped: buying credits must work even when the plan payment is late.
  const auth = await authenticateAPIWithPermission(request, 'manage_billing', { skipBillingGuard: true })
  if (!auth.ok) return auth.response
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Origen no permitido' }, { status: 403 })
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Paquete inválido' }, { status: 400 })
  if (!(await aiBillingReady())) return NextResponse.json({ error: 'Los créditos de IA aún no están disponibles.' }, { status: 503 })

  const tenantId = auth.tenantId
  const flag = await readCustomAgentsFlag(tenantId)
  if (flag?.enabled !== true) {
    return NextResponse.json({ error: 'Los paquetes de créditos son para cuentas con agente. Escribinos para activarlo.' }, { status: 403 })
  }
  if (!(await limiter(`tenant:${tenantId}`)).allowed) {
    return NextResponse.json({ error: 'Demasiados intentos. Probá de nuevo en un rato.' }, { status: 429 })
  }
  if ((await recentPendingPurchases(tenantId)) >= MAX_PENDING_24H) {
    return NextResponse.json({ error: 'Tenés pagos pendientes. Terminá uno o esperá unas horas.' }, { status: 429 })
  }
  const settings = await getSettings()
  const pack = settings.packs.find((p) => p.id === parsed.data.packId)
  if (!pack) return NextResponse.json({ error: 'Paquete inválido' }, { status: 400 })
  const quote = quotePack(pack)

  const purchase = await createPendingPurchase({ tenantId, ...quote, createdBy: auth.userId })
  const base = process.env.NEXTAUTH_URL || request.nextUrl.origin
  try {
    const link = await createPaymentLink({
      amountMinor: quote.totalCents,
      currency: 'USD',
      description: `Créditos de IA Betsy ${formatUsdCents(quote.priceCents)} + IVA`,
      orderId: purchase.ref,
      successUrl: `${base}/config?tab=ai-usage&credits=ok`,
      cancelUrl: `${base}/config?tab=ai-usage&credits=cancel`,
      callbackUrl: `${base}/api/tilopay/webhook-ai-credits`,
      customerEmail: auth.session?.user?.email || undefined,
    })
    if (!link.url || !/^https:\/\//.test(link.url)) throw new Error('no_link')
    return NextResponse.json({ checkoutUrl: link.url, quote })
  } catch (error) {
    await deletePendingPurchase(purchase.id).catch(() => undefined)
    console.error('[billing/ai-credits/checkout] Tilopay link failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'No pudimos abrir el pago. Probá de nuevo.' }, { status: 502 })
  }
}
