/**
 * Soft AI automation job processor — run turn then exactly-once deliver.
 * Dispatches Agent Layer when chat_agent_layer_v1 resolves; else legacy Soft AI.
 * Never imports staff bot modules.
 */

import {
  claimJobById,
  claimBatch,
  completeJob,
  completeLateJob,
  failJob,
  withProcessingTimeout,
  type ClaimedChatAutomationJob,
} from '@/lib/soft-ai/automation-queue'
import {
  deliverOnce,
  hashSoftAiDeliveryContent,
} from '@/lib/soft-ai/automation-delivery'
import { executeSoftAiInboundTurn } from '@/lib/soft-ai/inbound-hook'
import { dualWriteChatMessage } from '@/lib/chat-conversation-write'
import { executeAgentLayerTurn } from '@/lib/soft-ai/agent-turn'
import { resolveChatAgent } from '@/lib/soft-ai/agent-resolver'

type JobPayload = {
  platform?: string | null
  content?: string | null
  senderName?: string | null
}

function readPayload(payload: unknown): JobPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {}
  const p = payload as Record<string, unknown>
  return {
    platform: typeof p.platform === 'string' ? p.platform : null,
    content: typeof p.content === 'string' ? p.content : null,
    senderName: typeof p.senderName === 'string' ? p.senderName : null,
  }
}

async function dispatchLegacy(row: ClaimedChatAutomationJob) {
  const payload = readPayload(row.payload)
  if (!payload.content || !payload.platform) {
    throw new Error('SOFT_AI_PAYLOAD_INVALID')
  }

  const turn = await executeSoftAiInboundTurn({
    tenantId: row.tenantId,
    socialAccountId: row.socialAccountId,
    senderId: row.peerId,
    senderName: payload.senderName,
    platform: payload.platform,
    content: payload.content,
  })

  if (turn.skipped || !turn.reply || !turn.sendContext) {
    return { status: 'skipped' as const, reason: turn.skippedReason }
  }

  const contentHash = hashSoftAiDeliveryContent(turn.reply)
  const delivery = await deliverOnce({
    jobId: row.id,
    deliveryKey: row.deliveryKey,
    kind: 'text',
    contentHash,
    send: async () => {
      const result = await turn.sendContext!.send(turn.reply!)
      if (!result.ok) {
        throw new Error(
          result.error && /^[A-Z0-9_:-]{3,80}$/i.test(result.error)
            ? result.error.slice(0, 80).toUpperCase().replace(/[^A-Z0-9_:-]/g, '_')
            : 'META_SEND_FAILED',
        )
      }
      return result
    },
    providerDeliveryId: (result) => result.providerMessageId,
  })

  const providerMessageId =
    delivery.providerDeliveryId ||
    (!delivery.skipped ? delivery.result?.providerMessageId : undefined)

  await dualWriteChatMessage({
    tenantId: row.tenantId,
    socialAccountId: row.socialAccountId,
    direction: 'outbound',
    content: turn.reply,
    sentAt: new Date(),
    peerId: row.peerId,
    peerName: payload.senderName || null,
    providerMessageId: providerMessageId || null,
    messageType: 'text',
    deliveryStatus: delivery.skipped || providerMessageId ? 'sent' : 'sent',
    platform: payload.platform,
    orderId: turn.orderId || null,
    metadata: {
      softAi: true,
      toolLog: turn.toolLog,
      agentMode: turn.agentMode,
      to: row.peerId,
      platform: payload.platform,
      providerMessageId,
      automationJobId: row.id,
      deliverySkipped: delivery.skipped,
    },
    suppressSoftAi: true,
  })

  if (turn.persistEscalation) {
    await turn.persistEscalation()
  }

  return { status: 'delivered' as const, skipped: delivery.skipped }
}

async function dispatch(row: ClaimedChatAutomationJob) {
  // Probe layer flag without requiring ai_active yet.
  const probe = await resolveChatAgent({
    tenantId: row.tenantId,
    socialAccountId: row.socialAccountId,
    conversationAiMode: 'ai_active',
  })

  if (!probe.layerEnabled) {
    return dispatchLegacy(row)
  }

  // Flag on: Agent Layer owns allowlisted + non-allowlisted outcomes (skip).
  // Never fall through to legacy for allowlisted accounts.
  const result = await executeAgentLayerTurn(row)
  if (result.status === 'legacy') {
    return dispatchLegacy(row)
  }
  return result
}

export async function processClaimedJob(row: ClaimedChatAutomationJob) {
  const work = dispatch(row)
  try {
    await withProcessingTimeout(work)
    await completeJob(row)
    return { id: row.id, status: 'completed' as const }
  } catch (error) {
    const terminal = await failJob(row, error)
    if (error instanceof Error && error.name === 'ChatAutomationTimeoutError') {
      void work.then(
        () => completeLateJob(row),
        () => undefined,
      )
    }
    return {
      id: row.id,
      status: terminal ? ('failed' as const) : ('retry' as const),
    }
  }
}

export async function processJobById(id: string) {
  const row = await claimJobById(id)
  if (!row) return { id, status: 'not_claimed' as const }
  return processClaimedJob(row)
}

export async function processAutomationBatch(limit = 2) {
  const rows = await claimBatch(limit)
  const results = []
  for (const row of rows) {
    results.push(await processClaimedJob(row))
  }
  return { rows, results }
}
