/**
 * Bulk-enrich conversation list DTOs with Soft Agent Layer trust labels.
 * No-ops when SQL 027 is not applied or the flag is off.
 */

import 'server-only'

import { prisma } from '@/lib/db'
import type { ChatConversationListItemDto } from '@/lib/chat-conversation-api'
import { formatAgentHeaderLabel } from '@/lib/soft-ai/agent-inbox-projection'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'
import { resolvePersistedAgentMode, softAiConversationKey } from '@/lib/soft-ai/agent-mode-server'
import { chatAiStatus, dotFromChatAiStatus, type ChatLineAi } from '@/lib/soft-ai/agent-status'
import { conversationsWithRecentHuman, loadLinesAiStatus } from '@/lib/soft-ai/agent-status-server'
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

/**
 * Line truth for the inbox, loaded once per line per request and kept 10 s per process (the list polls; a switch
 * change shows within seconds, and a local "Tomar" is recomputed client-side from aiMode at once).
 */
const linesCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof loadLinesAiStatus>> }>()
const LINES_TTL_MS = 10_000

async function cachedLines(tenantId: string, accountIds: string[]) {
  const key = `${tenantId}|${[...accountIds].sort().join(',')}`
  const hit = linesCache.get(key)
  if (hit && Date.now() - hit.at < LINES_TTL_MS) return hit.value
  const value = await loadLinesAiStatus(tenantId, accountIds)
  if (linesCache.size > 2_000) linesCache.clear()
  linesCache.set(key, { at: Date.now(), value })
  return value
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
    // Agentes IA 2.0 — the truth: line status once per line, legacy agentState, and "a person wrote in 24 h" only for
    // the NULL-mode chats on lines that are on (the only ones it can change).
    const [lines, softFlag] = await Promise.all([
      cachedLines(tenantId, accountIds),
      prisma.tenantFeatureFlag.findFirst({
        where: { tenantId, scope: tenantId, key: SOFT_TENANT_AI_V1_FLAG },
        select: { config: true },
      }),
    ])
    const softConfig =
      softFlag?.config && typeof softFlag.config === 'object' && !Array.isArray(softFlag.config)
        ? (softFlag.config as Record<string, unknown>)
        : null
    const persistedFor = (item: ChatConversationListItemDto) =>
      resolvePersistedAgentMode(softConfig, softAiConversationKey(item.socialAccountId, item.peerId))
    const needsHumanCheck = items
      .filter((i) => !i.aiMode && !persistedFor(i) && lines.get(i.socialAccountId)?.status.state === 'on')
      .map((i) => i.id)
    const recentHuman = await conversationsWithRecentHuman(tenantId, needsHumanCheck)

    return items.map((item) => {
      const binding = byAccount.get(item.socialAccountId) || (defaultServes ? tenantDefault : null)
      const line = lines.get(item.socialAccountId)?.status ?? null
      const aiLine: ChatLineAi | null = line ? { state: line.state, code: line.code, label: line.label, hint: line.hint } : null
      const aiPersistedMode = persistedFor(item)
      const aiHumanRecent = recentHuman.has(item.id)
      const aiStatus = chatAiStatus({
        line: aiLine,
        conversationAiMode: item.aiMode,
        persistedAiMode: aiPersistedMode,
        humanWroteRecently: aiHumanRecent,
        assignedUserName: item.assignedUser?.name ?? null,
      })
      const truth = { aiLine, aiPersistedMode, aiHumanRecent, aiStatus }
      if (!binding?.agent || binding.agent.status !== 'live') {
        return {
          ...item,
          ...truth,
          agentLabel: 'Sin agente',
          agentId: null,
          agentEmoji: null,
          // "IA" only when the chat is really answered by the AI (never for a line without a live agent).
          agentStateDot: aiStatus.state === 'ia' ? dotFromChatAiStatus(aiStatus) : null,
          pendingSuggestionText: suggestionByConvo.get(item.id) || null,
        }
      }
      const agent = binding.agent
      return {
        ...item,
        ...truth,
        agentLabel: formatAgentHeaderLabel({
          emoji: agent.emoji,
          name: agent.name,
          operationMode: agent.operationMode,
        }),
        agentId: agent.id,
        agentEmoji: agent.emoji,
        agentStateDot: dotFromChatAiStatus(aiStatus),
        pendingSuggestionText: suggestionByConvo.get(item.id) || null,
      }
    })
  } catch (error) {
    if (isMissingRelationError(error)) return items
    console.error('[enrichConversationDtosWithAgents]', error)
    return items
  }
}
