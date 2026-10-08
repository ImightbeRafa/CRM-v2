/**
 * Bulk-enrich conversation list DTOs with Soft Agent Layer trust labels.
 * No-ops when SQL 027 is not applied or the flag is off.
 */

import 'server-only'

import { prisma } from '@/lib/db'
import type { ChatConversationListItemDto } from '@/lib/chat-conversation-api'
import {
  agentStateDot,
  formatAgentHeaderLabel,
} from '@/lib/soft-ai/agent-inbox-projection'
import { isChatAgentSchemaReady, isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import { CHAT_AGENT_LAYER_V1_FLAG } from '@/lib/soft-ai/agent-types'
import { agentsServingUnboundChannels } from '@/lib/soft-ai/agent-settings'

/** Agent-layer flag per business, 60 s per process (read on every inbox list / poll). */
const flagCache = new Map<string, { enabled: boolean; at: number }>()
const FLAG_TTL_MS = 60_000

async function agentLayerEnabled(tenantId: string): Promise<boolean> {
  const hit = flagCache.get(tenantId)
  if (hit && Date.now() - hit.at < FLAG_TTL_MS) return hit.enabled
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: { tenantId, scope: tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
    select: { enabled: true },
  })
  const enabled = Boolean(flag?.enabled)
  if (flagCache.size > 5_000) flagCache.clear()
  flagCache.set(tenantId, { enabled, at: Date.now() })
  return enabled
}

export async function enrichConversationDtosWithAgents(
  tenantId: string,
  items: ChatConversationListItemDto[],
): Promise<ChatConversationListItemDto[]> {
  if (items.length === 0) return items
  try {
    if (!(await agentLayerEnabled(tenantId))) return items
    if (!(await isChatAgentSchemaReady())) return items

    const accountIds = [...new Set(items.map((i) => i.socialAccountId))]
    const conversationIds = items.map((i) => i.id)
    // Independent reads: one round trip instead of two.
    const [bindings, suggestions] = await Promise.all([
      prisma.chatAgentBinding.findMany({
      where: {
        tenantId,
        isActive: true,
        OR: [
          { scope: 'social_account', socialAccountId: { in: accountIds } },
          { scope: 'tenant_default' },
        ],
      },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            emoji: true,
            operationMode: true,
            status: true,
          },
        },
      },
      }),
      prisma.chatAgentTurn.findMany({
        where: {
          tenantId,
          conversationId: { in: conversationIds },
          status: 'suggested',
          outputText: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        select: { conversationId: true, outputText: true },
      }),
    ])

    const byAccount = new Map<string, (typeof bindings)[number]>()
    let tenantDefault: (typeof bindings)[number] | null = null
    for (const b of bindings) {
      if (b.scope === 'tenant_default') tenantDefault = b
      else if (b.socialAccountId) byAccount.set(b.socialAccountId, b)
    }

    const suggestionByConvo = new Map<string, string>()
    for (const s of suggestions) {
      if (!s.conversationId || !s.outputText) continue
      if (!suggestionByConvo.has(s.conversationId)) {
        suggestionByConvo.set(s.conversationId, s.outputText)
      }
    }

    // Same rule as the resolver: a default agent only covers channels without their own when allowed (SQL 049).
    const defaultServes = tenantDefault?.agentId
      ? (await agentsServingUnboundChannels(tenantId)).has(tenantDefault.agentId)
      : false
    return items.map((item) => {
      const binding = byAccount.get(item.socialAccountId) || (defaultServes ? tenantDefault : null)
      if (!binding?.agent || binding.agent.status !== 'live') {
        return {
          ...item,
          agentLabel: 'Sin agente',
          agentEmoji: null,
          agentStateDot: null,
          pendingSuggestionText: suggestionByConvo.get(item.id) || null,
        }
      }
      const agent = binding.agent
      return {
        ...item,
        agentLabel: formatAgentHeaderLabel({
          emoji: agent.emoji,
          name: agent.name,
          operationMode: agent.operationMode,
        }),
        agentEmoji: agent.emoji,
        agentStateDot: agentStateDot({
          operationMode: agent.operationMode,
          conversationAiMode: item.aiMode,
        }),
        pendingSuggestionText: suggestionByConvo.get(item.id) || null,
      }
    })
  } catch (error) {
    if (isMissingRelationError(error)) return items
    console.error('[enrichConversationDtosWithAgents]', error)
    return items
  }
}
