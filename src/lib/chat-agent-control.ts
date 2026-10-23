/**
 * Who answers a chat (Tomar control / Pausar / Devolver a IA): the chat's aiMode plus the tenant's agentState map
 * (flag config), the same server contract the inbox has used since F37. Shared by /api/chat/soft-ai/control and
 * "Respondido" (which gives a handed-off chat back to the agent WITHOUT answering the waiting message).
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'
import { parseConversationKey } from '@/lib/chat-conversation-api'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'

export type AgentControlAction = 'take_over' | 'pause' | 'resume'

export function modeForAgentAction(action: AgentControlAction): SoftAiAgentMode {
  if (action === 'take_over') return 'human'
  if (action === 'pause') return 'paused'
  if (action === 'resume') return 'ai_active'
  const exhaustive: never = action
  return exhaustive
}

/** Writes the mode for this tenant's chat (`<socialAccountId>::<peerId>`). Returns the parsed key (null = not a chat key). */
export async function setConversationAgentMode(args: {
  tenantId: string
  conversationKey: string
  action: AgentControlAction
}): Promise<{ mode: SoftAiAgentMode; keyParts: { socialAccountId: string; peerId: string } | null }> {
  const { tenantId, conversationKey, action } = args
  const mode = modeForAgentAction(action)
  const db = prisma as any
  const existing = await db.tenantFeatureFlag.findFirst({
    where: { tenantId, scope: tenantId, key: SOFT_TENANT_AI_V1_FLAG },
    select: { id: true, enabled: true, config: true },
  })

  const prevConfig =
    existing?.config && typeof existing.config === 'object' && !Array.isArray(existing.config)
      ? (existing.config as Record<string, unknown>)
      : {}
  const agentState =
    prevConfig.agentState && typeof prevConfig.agentState === 'object'
      ? { ...(prevConfig.agentState as Record<string, unknown>) }
      : {}

  agentState[conversationKey] = {
    mode,
    updatedAt: new Date().toISOString(),
    action,
    // Staff-driven controls must be visible to inbound (F37-02 server truth)
    staffControlled: action === 'take_over' || action === 'pause' || action === 'resume',
  }

  const nextConfig = { ...prevConfig, agentState }

  const keyParts = parseConversationKey(conversationKey)
  if (keyParts) {
    await db.chatConversation.updateMany({
      where: {
        tenantId,
        socialAccountId: keyParts.socialAccountId,
        peerId: keyParts.peerId,
      },
      data: { aiMode: mode },
    })
  }

  if (existing?.id) {
    await db.tenantFeatureFlag.update({
      where: { id: existing.id },
      data: { config: nextConfig },
    })
  } else {
    // Control without enabling worker — skeleton row stays disabled
    await db.tenantFeatureFlag.create({
      data: {
        scope: tenantId,
        tenantId,
        key: SOFT_TENANT_AI_V1_FLAG,
        enabled: false,
        config: nextConfig,
      },
    })
  }
  return { mode, keyParts }
}
