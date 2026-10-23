/**
 * Betsy's own sales agent (Rafael 2026-10-23): a TRUE hand-off from an agent with `salesRules.escalateToSupport` also
 * opens a ticket in Betsy's support pipeline (SupportTicket → webhook to the support agent + e-mail to the support inbox),
 * besides the normal inbox hand-off ("Necesita persona"), which is never replaced.
 *
 * Gates (all must hold, else nothing happens): SUPPORT_PIPELINE_ENABLED=true, the business is listed in
 * SUPPORT_AI_CHAT_TENANTS (a customer's chats never reach Betsy's support inbox because an owner ticked a box), and the
 * agent's setting is on. One open ticket per chat: a later hand-off adds an internal note to it. The ticket's contact
 * e-mail is Betsy's own support inbox, so the pipeline never e-mails the chat's customer. Payment data, secrets, e-mails
 * and long numbers are masked. Never throws (the hand-off already happened).
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { supportBaseUrl, supportPipelineEnabled, getSupportEmailConfig } from '@/lib/support/config'
import { redactSecrets } from '@/lib/support/redact'
import { addStaffMessage, createSupportTicket } from '@/lib/support/tickets'
import { HANDOFF_REASON_LABELS } from '@/lib/workspace-notifications'
import { loadSalesSetup } from '@/lib/soft-ai/agent-sales-setup'

type EnvLike = Record<string, string | undefined>

/** Businesses whose agents may escalate into Betsy's support pipeline (env, comma-separated tenant ids). */
export function supportChatTenants(env: EnvLike = process.env): Set<string> {
  return new Set(
    (env.SUPPORT_AI_CHAT_TENANTS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

const OPEN_STATUSES = ['open', 'ai_answered', 'waiting_customer', 'escalated'] as const
const MAX_MESSAGES = 6
const MAX_LINE = 300

/** Free text as it may leave the inbox: secrets, cards and e-mails redacted, then every long number / IBAN masked. */
export function maskForSupport(text: string): string {
  return redactSecrets(text || '')
    .replace(/\bCR\s?\d[\d\s]{14,}\d\b/gi, '[cuenta]')
    .replace(/\+?\d(?:[\s.\-–/]?\d){5,}/g, '[número]')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Custom-agent questions go to the agent_request queue; everything else is a question. */
export function supportCategoryFor(text: string): 'agent_request' | 'question' {
  return /(?<![\p{L}])(?:agente|agentes|asistente\s+virtual|bot|chatbot|ia\s+para\s+mi|inteligencia\s+artificial)(?![\p{L}])/iu.test(text)
    ? 'agent_request'
    : 'question'
}

type ChatLine = { direction: string; content: string | null }

/** The ticket body (pure): who, why, the chat link, the last messages — all masked. */
export function buildSupportTicketBody(input: {
  channel: string
  handle: string | null
  reasonLabel: string
  chatUrl: string
  messages: ChatLine[]
}): string {
  const lines = input.messages
    .filter((m) => (m.content || '').trim())
    .slice(-MAX_MESSAGES)
    .map((m) => `${m.direction === 'inbound' ? 'Cliente' : 'Betsy'}: ${maskForSupport(m.content || '').slice(0, MAX_LINE)}`)
  return [
    `Chat de ${input.channel}${input.handle ? ` (${maskForSupport(input.handle).slice(0, 60)})` : ''}`,
    `Motivo: ${input.reasonLabel}`,
    `Abrir el chat: ${input.chatUrl}`,
    '',
    'Últimos mensajes:',
    ...lines,
  ].join('\n')
}

export async function escalateHandoffToSupport(
  input: { tenantId: string; conversationId: string; agentId: string | null; reason: string },
  env: EnvLike = process.env,
): Promise<'created' | 'appended' | 'skipped'> {
  try {
    if (!supportPipelineEnabled(env) || !input.agentId || !supportChatTenants(env).has(input.tenantId)) return 'skipped'
    const setup = await loadSalesSetup(input.tenantId, input.agentId)
    if (!setup.salesRules.escalateToSupport) return 'skipped'

    const conversation = await prisma.chatConversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId },
      select: { id: true, peerUsername: true, peerName: true, socialAccount: { select: { platform: true } } },
    })
    if (!conversation) return 'skipped'
    const recent = await prisma.chatMessage.findMany({
      where: { conversationId: conversation.id, tenantId: input.tenantId },
      orderBy: { sentAt: 'desc' },
      take: MAX_MESSAGES,
      select: { direction: true, content: true },
    })
    const messages = recent.reverse()
    const platform = conversation.socialAccount?.platform === 'instagram' ? 'Instagram' : 'WhatsApp'
    const handle = conversation.peerUsername ? `@${conversation.peerUsername}` : conversation.peerName
    const reasonLabel = (HANDOFF_REASON_LABELS as Record<string, string>)[input.reason] || 'Necesita una persona'
    const body = buildSupportTicketBody({
      channel: platform,
      handle,
      reasonLabel,
      chatUrl: `${supportBaseUrl(env)}/chats?c=${encodeURIComponent(conversation.id)}`,
      messages,
    })

    // One open ticket per chat: a later hand-off is an internal note on it (no new webhook / e-mail).
    const open = await prisma.supportTicket.findFirst({
      where: { source: 'ai_chat', status: { in: [...OPEN_STATUSES] }, meta: { path: ['conversationId'], equals: conversation.id } },
      select: { id: true },
    })
    if (open) {
      await addStaffMessage({ ticketId: open.id, author: 'system', visibility: 'internal', body: `Nueva derivación de la IA.\n${body}` })
      return 'appended'
    }
    const customerText = messages.filter((m) => m.direction === 'inbound').map((m) => m.content || '').join('\n')
    await createSupportTicket({
      source: 'ai_chat',
      // A prospect from the chat, not a Betsy account: no tenant / user, contact = Betsy's own inbox (no customer ack).
      tenantId: null,
      userId: null,
      contact: { name: handle ? maskForSupport(handle).slice(0, 60) : null, email: getSupportEmailConfig(env).agentInbox },
      subject: `IA de ventas: ${reasonLabel}`,
      body,
      category: supportCategoryFor(customerText),
      meta: { conversationId: conversation.id, agentTenantId: input.tenantId, agentId: input.agentId, channel: platform.toLowerCase(), handoffReason: input.reason },
    })
    return 'created'
  } catch (error) {
    console.error('[soft-ai support-escalation]', error instanceof Error ? error.name : 'error')
    return 'skipped'
  }
}

/** From a settled hand-off of a queued turn (agent-turn settleHandoff). Cheap no-op for every business not allowlisted. */
export async function escalateHandoffFromJob(
  row: { tenantId: string; conversationId: string; socialAccountId: string; deliveryKey: string },
  reason: string,
  env: EnvLike = process.env,
): Promise<'created' | 'appended' | 'skipped'> {
  if (!supportPipelineEnabled(env) || !supportChatTenants(env).has(row.tenantId)) return 'skipped'
  try {
    const turn = await prisma.chatAgentTurn.findFirst({ where: { tenantId: row.tenantId, automationDeliveryKey: row.deliveryKey }, select: { agentId: true } })
    const binding = turn
      ? null
      : await prisma.chatAgentBinding.findFirst({ where: { tenantId: row.tenantId, socialAccountId: row.socialAccountId }, select: { agentId: true } })
    return escalateHandoffToSupport({ tenantId: row.tenantId, conversationId: row.conversationId, agentId: turn?.agentId ?? binding?.agentId ?? null, reason }, env)
  } catch (error) {
    console.error('[soft-ai support-escalation]', error instanceof Error ? error.name : 'error')
    return 'skipped'
  }
}
