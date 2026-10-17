import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPIWithPermission } from '@/lib/auth-helpers'
import { createIdentifierRateLimit } from '@/lib/rate-limit'
import { prisma } from '@/lib/db'
import { loadConversationForTenant } from '@/lib/chat-conversation-route-helpers'
import { enhanceCustomerPasteWithAi, isCustomerPasteAiConfigured } from '@/lib/customer-paste-ai'
import { isAiTermsAcceptedNow } from '@/lib/soft-ai/agent-ai-terms-server'
import { isPlatformAiPaused } from '@/lib/soft-ai/agent-kill-switch'
import {
  customerTextsForPrefill,
  detectOrderChoices,
  finalizeCustomer,
  labelledCustomerFields,
  matchPrefillProducts,
  type PrefillCustomer,
} from '@/lib/chat-order-prefill-core'

export const maxDuration = 15

/**
 * Chat → order prefill (Rafael 2026-10-17). It never creates anything: a person reviews the form and submits it.
 * POST (no body) so the business's billing write guard applies to the AI spend like any other action.
 */
const limiter = createIdentifierRateLimit({ windowMs: 60 * 60 * 1000, maxRequests: 60, identifier: 'chat-order-prefill' })
const LOOKBACK_MS = 72 * 60 * 60 * 1000

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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

  // Only clearly-labelled values without the AI; with it, the AI's answer is final (an empty field stays empty).
  const labelled = labelledCustomerFields(customerTexts)
  let customer: PrefillCustomer = labelled
  let source: 'ai' | 'labels' = 'labels'
  // The chat's text already goes to Luna for this business's agent: same gates (AI terms accepted, AI not paused).
  if (rawText.trim().length >= 3 && isCustomerPasteAiConfigured() && !(await isPlatformAiPaused()) && (await isAiTermsAcceptedNow(auth.tenantId))) {
    try {
      const ai = await enhanceCustomerPasteWithAi({ tenantId: auth.tenantId, userId: auth.userId, rawText, heuristic: { ...labelled, username: '' } })
      customer = {
        name: ai.name ?? '',
        phone: ai.phone ?? '',
        email: ai.email ?? '',
        province: ai.province ?? '',
        canton: ai.canton ?? '',
        district: ai.district ?? '',
        address: ai.address ?? '',
      }
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
  const choices = detectOrderChoices(customerTexts)

  return NextResponse.json(
    {
      customer: finalizeCustomer(customer),
      orderType: choices.orderType,
      paymentChoice: choices.paymentChoice,
      products: matchPrefillProducts(items, customerTexts),
      source,
    },
    { headers: limited.headers },
  )
}
