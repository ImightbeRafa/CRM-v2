import 'server-only'
/**
 * Live WhatsApp images for agent replies (B5). Each image goes out at most once per job (deliverOnce row keyed by
 * job + position + image hash) and never twice in the same chat (the chat's earlier agent images are skipped).
 * The upload to Meta has no customer-visible effect, so it happens before the delivery row is claimed: an upload
 * failure just drops that image, and the text reply still goes out.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { buildWhatsAppMediaMessage } from '@/lib/chat-outbound-media'
import { buildMediaCacheMetadataPatch } from '@/lib/chat-media'
import { dualWriteChatMessage, isPersistedDualWrite } from '@/lib/chat-conversation-write'
import { deliverOnce } from '@/lib/soft-ai/automation-delivery'
import { readAgentAssetBytes, type AgentAsset } from '@/lib/soft-ai/agent-assets'

const META_TIMEOUT_MS = 8_000
/** Meta keeps uploaded media ~30 days: reuse an id for 25. */
const MEDIA_ID_REUSE_MS = 25 * 24 * 60 * 60 * 1000
const SENT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
/** Images only while the turn is early: the job times out at 42 s and the text must still go out. */
export const AGENT_IMAGE_DEADLINE_MS = 28_000
/** An uncached upload needs this much time left (upload + send). */
const UPLOAD_MIN_LEFT_MS = 12_000

/** Image hashes the agent already sent in this chat (last 30 days). */
export async function loadSentAgentImageShas(tenantId: string, conversationId: string): Promise<string[]> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      tenantId,
      conversationId,
      direction: 'outbound',
      messageType: 'image',
      sentAt: { gte: new Date(Date.now() - SENT_LOOKBACK_MS) },
      metadata: { path: ['softAi'], equals: true },
    },
    select: { metadata: true },
    orderBy: { sentAt: 'desc' },
    take: 60,
  })
  const out: string[] = []
  for (const row of rows) {
    const sha = (row.metadata as Record<string, unknown> | null)?.agentAssetSha
    if (typeof sha === 'string') out.push(sha)
  }
  return out
}

async function reusableMediaId(tenantId: string, socialAccountId: string, sha: string): Promise<string | null> {
  const row = await prisma.chatMessage.findFirst({
    where: {
      tenantId,
      socialAccountId,
      direction: 'outbound',
      messageType: 'image',
      providerMediaId: { not: null },
      sentAt: { gte: new Date(Date.now() - MEDIA_ID_REUSE_MS) },
      metadata: { path: ['agentAssetSha'], equals: sha },
    },
    select: { providerMediaId: true },
    orderBy: { sentAt: 'desc' },
  })
  return row?.providerMediaId || null
}

async function uploadToWhatsApp(phoneNumberId: string, accessToken: string, asset: AgentAsset): Promise<string | null> {
  const bytes = await readAgentAssetBytes(asset)
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', asset.mimeType)
  form.append('file', new Blob([new Uint8Array(bytes)], { type: asset.mimeType }), asset.mimeType === 'image/png' ? 'imagen.png' : 'imagen.jpg')
  const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${phoneNumberId}/media`), accessToken, { purpose: 'whatsapp' })
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    signal: AbortSignal.timeout(META_TIMEOUT_MS),
  })
  const data = (await res.json().catch(() => ({}))) as { id?: unknown }
  return res.ok && typeof data.id === 'string' ? data.id : null
}

export type AgentImageSend = {
  job: { id: string; deliveryKey: string; tenantId: string; socialAccountId: string; peerId: string; messageId: string | null }
  phoneNumberId: string
  accessToken: string
  agent: { id: string; version: number; name: string; emoji?: string | null }
  turnId: string
  peerName: string | null
  /** Epoch ms after which no more images are attempted. */
  deadlineAt: number
}

/** Sends the images in order; returns how many reached WhatsApp. Never throws (the text must still go out). */
export async function sendAgentImagesOnce(ctx: AgentImageSend, assets: AgentAsset[]): Promise<number> {
  let sent = 0
  for (const asset of assets) {
    try {
      if (Date.now() >= ctx.deadlineAt) break
      const cached = await reusableMediaId(ctx.job.tenantId, ctx.job.socialAccountId, asset.sha256)
      if (!cached && ctx.deadlineAt - Date.now() < UPLOAD_MIN_LEFT_MS) continue
      const mediaId = cached || (await uploadToWhatsApp(ctx.phoneNumberId, ctx.accessToken, asset))
      if (!mediaId) continue
      const delivery = await deliverOnce({
        jobId: ctx.job.id,
        // Keyed by image only (stable when earlier images are filtered out on a re-run).
        deliveryKey: `${ctx.job.deliveryKey}:img:${asset.sha256.slice(0, 32)}`,
        kind: 'image',
        contentHash: asset.sha256,
        send: async () => {
          const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${ctx.phoneNumberId}/messages`), ctx.accessToken, { purpose: 'whatsapp' })
          const res = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(buildWhatsAppMediaMessage({ to: ctx.job.peerId, kind: 'image', mediaId })),
            signal: AbortSignal.timeout(META_TIMEOUT_MS),
          })
          const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id?: string }> }
          if (!res.ok) throw new Error('META_IMAGE_SEND_FAILED')
          return { providerMessageId: data.messages?.[0]?.id }
        },
        providerDeliveryId: (r) => r.providerMessageId,
      })
      if (delivery.skipped) continue // already sent by an earlier attempt of this job (and already recorded)
      sent += 1
      const providerMessageId = delivery.providerDeliveryId || null
      const write = await dualWriteChatMessage({
        tenantId: ctx.job.tenantId,
        socialAccountId: ctx.job.socialAccountId,
        direction: 'outbound',
        content: '[image]',
        sentAt: new Date(),
        peerId: ctx.job.peerId,
        peerName: ctx.peerName,
        providerMessageId,
        messageType: 'image',
        providerMediaId: mediaId,
        mediaMimeType: asset.mimeType,
        mediaFilename: asset.name,
        answersMessageId: ctx.job.messageId,
        deliveryStatus: 'sent',
        platform: 'whatsapp',
        metadata: {
          softAi: true,
          agentId: ctx.agent.id,
          agentVersion: ctx.agent.version,
          agentName: ctx.agent.name,
          agentEmoji: ctx.agent.emoji ?? null,
          turnId: ctx.turnId,
          agentAssetId: asset.id,
          agentAssetSha: asset.sha256,
          to: ctx.job.peerId,
          platform: 'whatsapp',
          providerMessageId,
          automationJobId: ctx.job.id,
        },
        suppressSoftAi: true,
      })
      if (isPersistedDualWrite(write)) {
        // The thread shows our stored copy (no Meta download needed).
        const ref = { mediaBlobPath: asset.blobPath, mediaCacheStatus: 'ready' as const, mediaMimeType: asset.mimeType, mediaFilename: asset.name }
        const row = await prisma.chatMessage.findFirst({ where: { id: write.messageId, tenantId: ctx.job.tenantId }, select: { metadata: true } })
        const meta = row?.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {}
        await prisma.chatMessage.updateMany({
          where: { id: write.messageId, tenantId: ctx.job.tenantId },
          data: {
            mediaBlobPath: asset.blobPath,
            mediaCacheStatus: 'ready',
            mediaSizeBytes: asset.sizeBytes,
            mediaCachedAt: new Date(),
            metadata: buildMediaCacheMetadataPatch(meta, ref) as Prisma.InputJsonValue,
          },
        })
      }
    } catch (error) {
      // Ambiguous / failed image: never retried (could double-send); the text still goes out.
      console.warn('[agent images] image skipped', error instanceof Error ? error.message.slice(0, 60) : 'unknown')
    }
  }
  return sent
}
