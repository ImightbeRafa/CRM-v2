/**
 * Live read of the business's AI opt-in (server). Used right before any provider call or send, and by AI tools outside
 * the agent layer (customer-paste helper). Fails closed: a missing flag row, a malformed config or any read error means
 * "not accepted".
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { aiTermsAccepted, parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { CHAT_AGENT_LAYER_V1_FLAG } from '@/lib/soft-ai/agent-types'

export async function isAiTermsAcceptedNow(tenantId: string): Promise<boolean> {
  try {
    const flag = await prisma.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
      select: { config: true },
    })
    return aiTermsAccepted(parseChatAgentLayerConfig(flag?.config))
  } catch {
    return false
  }
}
