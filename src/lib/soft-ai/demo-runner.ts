/**
 * Soft DEMO AI runner — proves full AI e2e without Meta.
 * Mutates demo conversation copies in memory only.
 */

import { conversationStorageKey, type SoftConversation, type SoftTag } from '@/lib/chat-soft-copilot'
import { DEFAULT_SOFT_AI_CONFIG } from '@/lib/soft-ai/config'
import {
  appendToolLog,
  getConversationAgentState,
  type SoftAiAgentStateMap,
} from '@/lib/soft-ai/agent-state'
import { runSoftAiTurn } from '@/lib/soft-ai/worker'
import type { SoftAiToolLogEntry } from '@/lib/soft-ai/types'
import type { ChatInboxMessage } from '@/lib/chat-inbox'

export type SoftDemoAiRunResult = {
  conversations: SoftConversation[]
  agentState: SoftAiAgentStateMap
  /** Keys that received an AI reply this pass. */
  repliedKeys: string[]
}

export async function runSoftDemoAiPass(opts: {
  conversations: SoftConversation[]
  agentState: SoftAiAgentStateMap
  nowMs?: number
}): Promise<SoftDemoAiRunResult> {
  const nowMs = opts.nowMs ?? Date.now()
  let agentState = { ...opts.agentState }
  const repliedKeys: string[] = []
  const nextConversations: SoftConversation[] = []

  for (const conv of opts.conversations) {
    if (!conv.isDemo) {
      nextConversations.push(conv)
      continue
    }
    const key = conversationStorageKey(conv.socialAccountId, conv.recipientId)
    const state = getConversationAgentState(agentState, key, true)
    const last = conv.messages[conv.messages.length - 1]
    if (!last || last.direction !== 'inbound' || state.mode !== 'ai_active') {
      nextConversations.push(conv)
      continue
    }

    const result = await runSoftAiTurn({
      conversationKey: key,
      recipientId: conv.recipientId,
      recipientName: conv.recipientName,
      platform: conv.platform,
      messages: conv.messages.map((m) => ({
        id: m.id,
        direction: m.direction === 'outbound' ? ('outbound' as const) : ('inbound' as const),
        content: m.content,
        sentAt: m.sentAt,
        orderId: m.orderId,
      })),
      inboundText: last.content,
      agentMode: state.mode,
      config: DEFAULT_SOFT_AI_CONFIG,
      tags: conv.tags,
      orderId: conv.orderId || null,
      demo: true,
      nowMs,
    })

    if (result.skipped || !result.reply) {
      nextConversations.push(conv)
      continue
    }

    const aiMsg: ChatInboxMessage = {
      id: `demo-ai-${key}-${nowMs}`,
      direction: 'outbound',
      content: result.reply,
      sentAt: new Date(nowMs).toISOString(),
      receivedAt: null,
      orderId: result.orderId || undefined,
    }

    const updated: SoftConversation = {
      ...conv,
      messages: [...conv.messages, aiMsg],
      lastMessage: result.reply,
      lastMessageAt: aiMsg.sentAt,
      unreadCount: 0,
      tags: result.tags as SoftTag[],
      orderId: result.orderId,
      status: result.agentMode === 'human' ? 'nuevo' : 'en_curso',
    }

    agentState = appendToolLog(
      agentState,
      key,
      result.toolLog as SoftAiToolLogEntry[],
      {
        mode: result.agentMode,
        lastAiMessageId: aiMsg.id,
      },
      true,
    )

    repliedKeys.push(key)
    nextConversations.push(updated)
  }

  return { conversations: nextConversations, agentState, repliedKeys }
}
