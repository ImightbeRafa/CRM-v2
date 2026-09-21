/**
 * Soft AI automation job processor — run turn then exactly-once deliver.
 * Reuses Soft AI inbound logic; never imports staff bot modules.
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

async function dispatch(row: ClaimedChatAutomationJob) {
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

export async function processClaimedJob(row: ClaimedChatAutomationJob) {
  const work = dispatch(row)
  try {
    await withProcessingTimeout(work)
    await completeJob(row)
    return { id: row.id, status: 'completed' as const }
  } catch (error) {
    const terminal = await failJob(row, error)
    if (error instanceof Error && error.name === 'ChatAutomationTimeoutError') {
      // If the serverless invocation remains alive and the timed-out work
      // finishes before the delayed retry, close the row instead of sending a
      // duplicate response. If Vercel kills it, the cron retry remains valid.
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
