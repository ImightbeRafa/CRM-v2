import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { hasPermission, type Role } from '@/lib/rbac'
import { isSameOriginRequest } from '@/lib/same-origin'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db'
import { loadConversationForTenant } from '@/lib/chat-conversation-route-helpers'
import {
  boundedCustomerTexts,
  customerTextsForPrefill,
  detectOrderChoices,
  finalizeCustomer,
  labelledCustomerFields,
  matchPrefillProducts,
} from '@/lib/chat-order-prefill-core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * Chat → order prefill (Rafael 2026-10-17). It never creates anything: a person reviews the form and submits it.
 * SecureDog H2: no AI here — the accepted AI terms cover the agent's replies only, so the form is filled from what the
 * customer clearly wrote (labelled lines, email, phone alone on its line, a real location, product names). Turning an AI
 * clean-up on needs Rafael's terms update first. POST so the billing write guard applies.
 */
const limiter = createIdentifierRateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 60, identifier: 'chat-order-prefill' })
const LOOKBACK_MS = 72 * 60 * 60 * 1000
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Reading the chat is update_sales (like every /api/chat/conversations route); making the order is create_sales.
  const auth = await authenticateAPIWithPermission(request, 'update_sales')
  if (!auth.ok) return auth.response
  if (!hasPermission(auth.role as Role, 'create_sales')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const limited = await limiter(`${auth.tenantId}:${auth.userId}`)
  if (!limited.allowed) return NextResponse.json({ error: 'Demasiados intentos. Esperá un momento.' }, { status: 429, headers: limited.headers })

  const { id } = await context.params
  const conversation = await loadConversationForTenant({ conversationId: id, tenantId: auth.tenantId, viewerUserId: auth.userId })
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = await prisma.chatMessage.findMany({
    where: { tenantId: auth.tenantId, conversationId: conversation.id, direction: 'inbound', sentAt: { gte: new Date(Date.now() - LOOKBACK_MS) } },
    orderBy: { sentAt: 'desc' },
    take: 30,
    select: { direction: true, content: true, messageType: true, metadata: true },
  })
  // SecureDog H1: one bounded copy of the customer's text (30 messages × 1 000 chars, 6 000 total) feeds every helper.
  // 2026-10-25: a WhatsApp edit gives its corrected text (often the address), a delete nothing (inbound-text.ts).
  const customerTexts = boundedCustomerTexts(customerTextsForPrefill(rows.reverse()))

  const items = await prisma.inventoryItem.findMany({
    where: { tenantId: auth.tenantId, isActive: true },
    select: { id: true, name: true, category: true, sellingPrice: true },
    take: 500,
  })
  const choices = detectOrderChoices(customerTexts)

  return NextResponse.json(
    {
      customer: finalizeCustomer(labelledCustomerFields(customerTexts)),
      orderType: choices.orderType,
      paymentChoice: choices.paymentChoice,
      products: matchPrefillProducts(items, customerTexts),
      source: 'labels',
    },
    { headers: { ...limited.headers, ...NO_STORE } },
  )
}
