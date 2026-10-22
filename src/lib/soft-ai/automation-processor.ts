/**
 * Soft AI automation job processor — run turn then exactly-once deliver.
 * Dispatches Agent Layer when chat_agent_layer_v1 resolves; else legacy Soft AI.
 * Never imports staff bot modules.
 */

import {
  BURST_SETTLE_MS,
  claimJobById,
  claimBatch,
  completeJob,
  rescheduleJob,
  rescheduleLateJob,
  completeLateJob,
  failJob,
  NEWEST_BURST_JOB_ORDER,
  withProcessingTimeout,
  type ClaimedChatAutomationJob,
} from '@/lib/soft-ai/automation-queue'
import {
  deliverOnce,
  hashSoftAiDeliveryContent,
} from '@/lib/soft-ai/automation-delivery'
import { executeSoftAiInboundTurn } from '@/lib/soft-ai/inbound-hook'
import { readAgentKillState } from '@/lib/soft-ai/agent-kill-switch'
import { dualWriteChatMessage } from '@/lib/chat-conversation-write'
import { executeAgentLayerTurn } from '@/lib/soft-ai/agent-turn'
import { resolveChatAgent } from '@/lib/soft-ai/agent-resolver'
import { prisma } from '@/lib/db'

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
  // Every path into the legacy Soft turn (including a layer flag flipping mid-dispatch) honors the kill switch.
  if ((await readAgentKillState(row.tenantId)).armed) {
    return { status: 'skipped' as const, reason: 'kill_switch' }
  }
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
    // Marks the team reply only up to the customer message this turn answered.
    answersMessageId: row.messageId,
    deliveryStatus: delivery.skipped || providerMessageId ? 'sent' : 'sent',
    platform: payload.platform,
    // The AI's own reply never links an order to the chat (only a person does): kept in metadata only.
    metadata: {
      softAi: true,
      orderId: turn.orderId || null,
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
    // The legacy Soft path can send too: the platform kill switch stops it as well.
    if ((await readAgentKillState(row.tenantId)).armed) {
      return { status: 'skipped' as const, reason: 'kill_switch' }
    }
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

/**
 * Verifier F1 (agents2-pace): while a paced reply is going out, the customer's next message is queued behind it
 * (single-flight per conversation) and would wait for the once-a-minute cron. When this job is done, kick the newest
 * waiting job of the same conversation (tenant-scoped) once. Best effort, never throws; the kicked job does not kick
 * again (no chain / storm) — anything after it is the cron's.
 */
export async function kickNextConversationJob(row: Pick<ClaimedChatAutomationJob, 'id' | 'tenantId' | 'conversationId'>): Promise<void> {
  try {
    const next = await prisma.chatAutomationJob.findFirst({
      where: {
        tenantId: row.tenantId,
        conversationId: row.conversationId,
        id: { not: row.id },
        status: { in: ['pending', 'retry'] },
        availableAt: { lte: new Date() },
      },
      // The job the claim would pick (newest customer message first), not one the claim holds back.
      orderBy: NEWEST_BURST_JOB_ORDER,
      select: { id: true },
    })
    if (next) void processJobById(next.id, { kick: false }).catch(() => undefined)
  } catch {
    /* the cron picks it up */
  }
}

export async function processClaimedJob(row: ClaimedChatAutomationJob, opts?: { kick?: boolean }) {
  const kick = opts?.kick !== false
  const work = dispatch(row)
  try {
    const result = await withProcessingTimeout(work)
    if (result && typeof result === 'object' && 'status' in result && result.status === 'provider_retry') {
      // Lane D: provider outage — same job, later (never completed, never failed).
      await rescheduleJob(row, result.retryAt, result.payload)
      return { id: row.id, status: 'completed' as const }
    }
    await completeJob(row)
    // Burst = one reply: a job that yielded to a newer bubble always hands over to it (also a kicked job), so the
    // newer job never waits for the cron. Bounded: a job only yields while a newer one is queued.
    const superseded = result?.status === 'skipped' && 'reason' in result && result.reason === 'superseded'
    if (kick || superseded) void kickNextConversationJob(row)
    return { id: row.id, status: 'completed' as const }
  } catch (error) {
    const terminal = await failJob(row, error)
    const timedOut = error instanceof Error && error.name === 'ChatAutomationTimeoutError'
    if (timedOut) {
      void work.then(
        // Verifier: a late provider_retry keeps retrying (never 'completed' with its payload dropped).
        (late) =>
          late && typeof late === 'object' && 'status' in late && late.status === 'provider_retry'
            ? rescheduleLateJob(row, late.retryAt, late.payload)
            : completeLateJob(row),
        () => undefined,
      )
    }
    // Not after a timeout: that turn may still be sending in the background (the next one waits for the cron).
    if (kick && !timedOut) void kickNextConversationJob(row)
    return {
      id: row.id,
      status: terminal ? ('failed' as const) : ('retry' as const),
    }
  }
}

export async function processJobById(id: string, opts?: { kick?: boolean }) {
  const row = await claimJobById(id)
  if (!row) return { id, status: 'not_claimed' as const }
  return processClaimedJob(row, opts)
}

/**
 * Burst = one reply: the webhook's best-effort dispatch, once the job's settle time (BURST_SETTLE_MS) is over. When
 * the customer sent another bubble meanwhile, this claim finds nothing (the newer job holds it back) and the newer
 * job's own dispatch answers the whole burst. Never throws; the cron is the safety net.
 */
export function processJobAfterSettle(id: string, settleMs: number = BURST_SETTLE_MS): void {
  setTimeout(() => {
    void processJobById(id).catch((error) => console.error('[soft-ai/automation] settle dispatch failed', error))
  }, settleMs > 0 ? settleMs + 250 : 0)
}

export async function processAutomationBatch(limit = 2) {
  const rows = await claimBatch(limit)
  const results = []
  for (const row of rows) {
    results.push(await processClaimedJob(row))
  }
  return { rows, results }
}
