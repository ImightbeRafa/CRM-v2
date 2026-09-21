/**
 * Soft Tenant AI inbound hook — after CRM chat webhook stores an inbound,
 * enqueue a durable ChatAutomationJob (Soft-only queue) for Soft AI reply.
 * Feature-flagged (soft_tenant_ai_v1). Never touches staff bot routes.
 *
 * F37-02: agent mode is server-truth. Missing agentState key does NOT default to
 * ai_active. Re-read mode immediately before Meta send; fail-closed if paused/human.
 */

import { prisma } from '@/lib/db'
import { shouldUseSoftTenantAiV1, readSoftTenantAiConfig } from '@/lib/feature-flags'
import { parseSoftAiConfig } from '@/lib/soft-ai/config'
import { runSoftAiTurn } from '@/lib/soft-ai/worker'
import { buildSoftAiServerDeps } from '@/lib/soft-ai/server-deps'
import {
  maySoftAiMetaReply,
  normalizeConversationAiMode,
  resolveSoftAiAgentMode,
  softAiConversationKey,
} from '@/lib/soft-ai/agent-mode-server'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { softAiCanalContextLine } from '@/lib/soft-ai/channel-context'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'
import { persistJob } from '@/lib/soft-ai/automation-queue'

type InboundHookArgs = {
  tenantId: string
  socialAccountId: string
  senderId: string
  senderName?: string | null
  platform: string
  content: string
  conversationId?: string | null
  messageId?: string | null
}

export type SoftAiMetaSendResult = {
  ok: boolean
  providerMessageId?: string
  error?: string
}

export type SoftAiInboundTurnResult = {
  skipped: boolean
  skippedReason?: string
  reply?: string
  orderId?: string | null
  toolLog?: unknown
  agentMode?: string
  sendContext?: {
    send: (text: string) => Promise<SoftAiMetaSendResult>
  }
  persistEscalation?: () => Promise<void>
}

async function loadSoftAiFlagConfig(tenantId: string): Promise<Record<string, unknown>> {
  const flag = await readSoftTenantAiConfig(tenantId)
  return flag.config && typeof flag.config === 'object' && !Array.isArray(flag.config)
    ? (flag.config as Record<string, unknown>)
    : {}
}

async function sendMetaText(opts: {
  platform: string
  accessToken: string
  phoneNumberId?: string | null
  pageId?: string | null
  recipient: string
  text: string
}): Promise<SoftAiMetaSendResult> {
  const token = opts.accessToken
  try {
    if (opts.platform === 'whatsapp') {
      if (!opts.phoneNumberId) return { ok: false, error: 'missing_phone_number_id' }
      const url = addAppSecretProofToUrl(
        buildMetaGraphUrl(`${opts.phoneNumberId}/messages`),
        token,
        { purpose: 'whatsapp' },
      )
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: opts.recipient,
          type: 'text',
          text: { body: opts.text },
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>
        error?: { message?: string }
      }
      if (!res.ok) {
        return { ok: false, error: data.error?.message || `meta_${res.status}` }
      }
      return { ok: true, providerMessageId: data.messages?.[0]?.id }
    }

    // Instagram DM
    const pageId = opts.pageId
    if (!pageId) return { ok: false, error: 'missing_page_id' }
    const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${pageId}/messages`), token)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: opts.recipient },
        message: { text: opts.text },
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json().catch(() => ({}))) as {
      message_id?: string
      error?: { message?: string }
    }
    if (!res.ok) {
      return { ok: false, error: data.error?.message || `meta_${res.status}` }
    }
    return { ok: true, providerMessageId: data.message_id }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'send_failed' }
  }
}

/**
 * Run Soft AI turn + prepare Meta send context. Does not send or dual-write;
 * the automation processor owns exactly-once delivery.
 */
export async function executeSoftAiInboundTurn(
  args: InboundHookArgs,
): Promise<SoftAiInboundTurnResult> {
  const enabled = await shouldUseSoftTenantAiV1(args.tenantId)
  if (!enabled) return { skipped: true, skippedReason: 'flag_off' }

  const key = softAiConversationKey(args.socialAccountId, args.senderId)
  let flagConfig = await loadSoftAiFlagConfig(args.tenantId)
  const db = prisma as any
  const conversationRow = await db.chatConversation.findUnique({
    where: {
      tenantId_socialAccountId_peerId: {
        tenantId: args.tenantId,
        socialAccountId: args.socialAccountId,
        peerId: args.senderId,
      },
    },
    select: { aiMode: true },
  })
  const agentMode = resolveSoftAiAgentMode({
    conversationAiMode: conversationRow?.aiMode,
    flagConfig,
    conversationKey: key,
  })

  // F37-02: missing key / non-explicit mode → fail closed (no Meta auto-reply)
  if (!maySoftAiMetaReply(agentMode)) {
    return {
      skipped: true,
      skippedReason:
        agentMode === 'paused'
          ? 'paused'
          : agentMode === 'human'
            ? 'human'
            : 'missing_or_non_explicit_mode',
    }
  }

  const config = parseSoftAiConfig(flagConfig)
  const recent = await db.chatMessage.findMany({
    where: { socialAccountId: args.socialAccountId },
    orderBy: { sentAt: 'desc' },
    take: 40,
    select: {
      id: true,
      direction: true,
      content: true,
      sentAt: true,
      orderId: true,
      metadata: true,
    },
  })

  const thread = recent
    .filter((m: { metadata?: { from?: string; to?: string } }) => {
      const meta = m.metadata || {}
      const peer = meta.from === args.senderId || meta.to === args.senderId
      return peer
    })
    .reverse()

  const messages = thread.map(
    (m: {
      id: string
      direction: string
      content: string
      sentAt: Date
      orderId?: string | null
    }) => ({
      id: m.id,
      direction: m.direction === 'outbound' ? ('outbound' as const) : ('inbound' as const),
      content: m.content,
      sentAt: new Date(m.sentAt).toISOString(),
      orderId: m.orderId || null,
    }),
  )

  const orderId =
    [...messages].reverse().find((m: { orderId?: string | null }) => m.orderId)?.orderId || null

  const accountForContext = await db.socialAccount.findFirst({
    where: { id: args.socialAccountId, tenantId: args.tenantId },
    select: {
      id: true,
      platform: true,
      accountId: true,
      displayName: true,
      providerDisplayName: true,
      providerUsername: true,
      displayPhoneNumber: true,
      accessToken: true,
      refreshToken: true,
    },
  })

  const canalContext = accountForContext
    ? softAiCanalContextLine({
        id: accountForContext.id,
        platform: accountForContext.platform || args.platform,
        accountId: accountForContext.accountId,
        displayName: accountForContext.displayName,
        providerDisplayName: accountForContext.providerDisplayName,
        providerUsername: accountForContext.providerUsername,
        displayPhoneNumber: accountForContext.displayPhoneNumber,
        phoneNumberId:
          (accountForContext.platform || args.platform) === 'whatsapp'
            ? accountForContext.accountId
            : null,
      })
    : softAiCanalContextLine({
        id: args.socialAccountId,
        platform: args.platform,
        accountId: args.senderId,
      })

  const result = await runSoftAiTurn(
    {
      conversationKey: key,
      recipientId: args.senderId,
      recipientName: args.senderName || null,
      platform: args.platform,
      canalContext,
      messages,
      inboundText: args.content,
      agentMode: 'ai_active',
      config,
      tags: [],
      orderId,
      demo: false,
    },
    buildSoftAiServerDeps(args.tenantId),
  )

  if (result.skipped || !result.reply) {
    return { skipped: true, skippedReason: result.skipReason || 'no_reply' }
  }

  // F37-02: re-read mode immediately before Meta send — fail closed if paused/human/missing
  flagConfig = await loadSoftAiFlagConfig(args.tenantId)
  const conversationBeforeSend = await db.chatConversation.findUnique({
    where: {
      tenantId_socialAccountId_peerId: {
        tenantId: args.tenantId,
        socialAccountId: args.socialAccountId,
        peerId: args.senderId,
      },
    },
    select: { aiMode: true },
  })
  const modeBeforeSend = resolveSoftAiAgentMode({
    conversationAiMode: conversationBeforeSend?.aiMode,
    flagConfig,
    conversationKey: key,
  })
  if (!maySoftAiMetaReply(modeBeforeSend)) {
    console.info('[soft-ai/inbound-hook] Meta send blocked — mode not ai_active', {
      conversationKey: key,
      modeBeforeSend,
    })
    return {
      skipped: true,
      skippedReason:
        modeBeforeSend === 'paused'
          ? 'paused_before_send'
          : modeBeforeSend === 'human'
            ? 'human_before_send'
            : 'missing_mode_before_send',
    }
  }

  const account = accountForContext
  if (!account?.accessToken) {
    return { skipped: true, skippedReason: 'no_account' }
  }

  const token = decryptSocialAccessToken(account.accessToken)
  if (!token) return { skipped: true, skippedReason: 'no_token' }
  const parsed = parseSocialRefreshToken(account.refreshToken)

  const persistEscalation = async () => {
    if (result.agentMode !== 'ai_active') {
      const aiMode = normalizeConversationAiMode(result.agentMode) || result.agentMode
      await db.chatConversation.updateMany({
        where: {
          tenantId: args.tenantId,
          socialAccountId: args.socialAccountId,
          peerId: args.senderId,
        },
        data: { aiMode },
      })
      const existing = await db.tenantFeatureFlag.findFirst({
        where: {
          tenantId: args.tenantId,
          scope: args.tenantId,
          key: SOFT_TENANT_AI_V1_FLAG,
        },
        select: { id: true, config: true },
      })
      if (existing?.id) {
        const prev =
          existing.config && typeof existing.config === 'object' ? existing.config : {}
        const agentState =
          prev.agentState && typeof prev.agentState === 'object' ? { ...prev.agentState } : {}
        agentState[key] = {
          mode: aiMode,
          updatedAt: new Date().toISOString(),
          action: 'escalate',
          staffControlled: aiMode === 'human',
        }
        await db.tenantFeatureFlag.update({
          where: { id: existing.id },
          data: { config: { ...prev, agentState } },
        })
      }
    }
  }

  return {
    skipped: false,
    reply: result.reply,
    orderId: result.orderId || null,
    toolLog: result.toolLog,
    agentMode: result.agentMode,
    sendContext: {
      send: (text: string) =>
        sendMetaText({
          platform: args.platform,
          accessToken: token,
          phoneNumberId: account.accountId,
          pageId: parsed.pageId || (args.platform === 'instagram' ? account.accountId : null),
          recipient: args.senderId,
          text,
        }),
    },
    persistEscalation,
  }
}

/**
 * Persist a Soft AI automation job after inbound dual-write succeeds.
 * Returns null when flag is off or ids are missing. Never throws to webhook.
 */
export async function enqueueSoftAiAfterInbound(
  args: InboundHookArgs,
): Promise<{ jobId: string; duplicate: boolean } | { skippedReason: string } | null> {
  try {
    if (!args.conversationId || !args.messageId) {
      return { skippedReason: 'missing_conversation_or_message' }
    }
    const enabled = await shouldUseSoftTenantAiV1(args.tenantId)
    if (!enabled) return { skippedReason: 'flag_off' }

    const row = await persistJob({
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      messageId: args.messageId,
      socialAccountId: args.socialAccountId,
      peerId: args.senderId,
      platform: args.platform,
      content: args.content,
      senderName: args.senderName,
    })
    return { jobId: row.id, duplicate: row.duplicate }
  } catch (error) {
    console.error('[soft-ai/inbound-hook] enqueue failed', error)
    return null
  }
}

/**
 * Fire-and-forget safe: enqueue durable Soft AI job.
 * Prefer webhook path that persists before 200 and voids processJobById after.
 * This helper only enqueues (no inline Meta send) so callers stay durable.
 */
export async function maybeRunSoftAiAfterInbound(
  args: InboundHookArgs,
): Promise<{ ran: boolean; skippedReason?: string; jobId?: string }> {
  try {
    const enqueued = await enqueueSoftAiAfterInbound(args)
    if (!enqueued) return { ran: false, skippedReason: 'enqueue_error' }
    if ('skippedReason' in enqueued) {
      return { ran: false, skippedReason: enqueued.skippedReason }
    }
    return { ran: true, jobId: enqueued.jobId }
  } catch (error) {
    console.error('[soft-ai/inbound-hook]', error)
    return { ran: false, skippedReason: 'error' }
  }
}
