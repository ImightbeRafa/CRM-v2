import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db'
import { loadConversationForTenant } from '@/lib/chat-conversation-route-helpers'
import { parseCustomerPaste, type CustomerPasteCandidate } from '@/lib/customer-paste'
import { enhanceCustomerPasteWithAi, isCustomerPasteAiConfigured } from '@/lib/customer-paste-ai'
import { isAiTermsAcceptedNow } from '@/lib/soft-ai/agent-ai-terms-server'
import { isPlatformAiPaused } from '@/lib/soft-ai/agent-kill-switch'
import { customerTextsForPrefill, detectOrderChoices, matchPrefillProducts } from '@/lib/chat-order-prefill-core'

export const maxDuration = 15

/** Chat → order prefill (Rafael 2026-10-17). Read-only: it never creates an order; a person reviews and submits. */
const limiter = createIdentifierRateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 60, identifier: 'chat-order-prefill' })
const LOOKBACK_MS = 72 * 60 * 60 * 1000

const EMPTY: CustomerPasteCandidate = { name: '', phone: '', email: '', username: '', province: '', canton: '', district: '', address: '' }

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateAPIWithPermission(request, 'create_sales')
  if (!auth.ok) return auth.response
  const limited = await limiter(`${auth.tenantId}:${auth.userId}`)
  if (!limited.allowed) return NextResponse.json({ error: 'Demasiados intentos. Esperá un momento.' }, { status: 429, headers: limited.headers })

  const { id } = await context.params
  const conversation = await loadConversationForTenant({ conversationId: id, tenantId: auth.tenantId, viewerUserId: auth.userId })
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await prisma.chatMessage.findMany({
    where: { tenantId: auth.tenantId, conversationId: conversation.id, sentAt: { gte: new Date(Date.now() - LOOKBACK_MS) } },
    orderBy: { sentAt: 'desc' },
    take: 60,
    select: { direction: true, content: true },
  })
  const customerTexts = customerTextsForPrefill(rows.reverse())
  const rawText = customerTexts.join('\n').slice(-6_000)

  let customer: CustomerPasteCandidate = parseCustomerPaste(rawText, { ...EMPTY })
  let source: 'ai' | 'heuristic' = 'heuristic'
  // Same gates as Ventas "Pegar cliente": the customer's text goes to the AI only with the terms accepted and AI not paused.
  if (rawText.trim().length >= 3 && isCustomerPasteAiConfigured() && !(await isPlatformAiPaused()) && (await isAiTermsAcceptedNow(auth.tenantId))) {
    try {
      const ai = await enhanceCustomerPasteWithAi({ tenantId: auth.tenantId, userId: auth.userId, rawText, heuristic: customer })
      customer = { ...customer, ...Object.fromEntries(Object.entries(ai).filter(([, v]) => typeof v === 'string' && v.trim())) }
      source = 'ai'
    } catch (error) {
      console.warn('[chat/order-prefill] AI clean-up skipped', error instanceof Error ? error.name : 'unknown')
    }
  }

  const items = await prisma.inventoryItem.findMany({
    where: { tenantId: auth.tenantId, isActive: true },
    select: { id: true, name: true, category: true, sellingPrice: true },
    take: 500,
  })
  const products = matchPrefillProducts(items, customerTexts)
  const choices = detectOrderChoices(customerTexts)

  return NextResponse.json(
    {
      customer: {
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        province: customer.province,
        canton: customer.canton,
        district: customer.district,
        address: customer.address,
      },
      orderType: choices.orderType,
      paymentChoice: choices.paymentChoice,
      products,
      source,
    },
    { headers: limited.headers },
  )
}
