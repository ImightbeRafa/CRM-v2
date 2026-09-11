/**
 * Soft Tenant AI inbound hook — after CRM chat webhook stores an inbound,
 * optionally run the tenant AI worker and send a full reply.
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
  resolvePersistedAgentMode,
  softAiConversationKey,
} from '@/lib/soft-ai/agent-mode-server'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'

type InboundHookArgs = {
  tenantId: string
  socialAccountId: string
  senderId: string
  senderName?: string | null
  platform: string
  content: string
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
}): Promise<{ ok: boolean; providerMessageId?: string; error?: string }> {
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
 * Fire-and-forget safe: never throws to webhook caller.
 * Returns status for tests / diagnostics.
 */
export async function maybeRunSoftAiAfterInbound(
  args: InboundHookArgs,
): Promise<{ ran: boolean; skippedReason?: string; metaSent?: boolean }> {
  try {
    const enabled = await shouldUseSoftTenantAiV1(args.tenantId)
    if (!enabled) return { ran: false, skippedReason: 'flag_off' }

    const key = softAiConversationKey(args.socialAccountId, args.senderId)
    let flagConfig = await loadSoftAiFlagConfig(args.tenantId)
    const agentMode = resolvePersistedAgentMode(flagConfig, key)

    // F37-02: missing key / non-explicit mode → fail closed (no Meta auto-reply)
    if (!maySoftAiMetaReply(agentMode)) {
      return {
        ran: false,
        skippedReason:
          agentMode === 'paused'
            ? 'paused'
            : agentMode === 'human'
              ? 'human'
              : 'missing_or_non_explicit_mode',
      }
    }

    const config = parseSoftAiConfig(flagConfig)
    const db = prisma as any
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

    const result = await runSoftAiTurn(
      {
        conversationKey: key,
        recipientId: args.senderId,
        recipientName: args.senderName || null,
        platform: args.platform,
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
      return { ran: false, skippedReason: result.skipReason || 'no_reply' }
    }

    // F37-02: re-read mode immediately before Meta send — fail closed if paused/human/missing
    flagConfig = await loadSoftAiFlagConfig(args.tenantId)
    const modeBeforeSend = resolvePersistedAgentMode(flagConfig, key)
    if (!maySoftAiMetaReply(modeBeforeSend)) {
      console.info('[soft-ai/inbound-hook] Meta send blocked — mode not ai_active', {
        conversationKey: key,
        modeBeforeSend,
      })
      return {
        ran: true,
        skippedReason:
          modeBeforeSend === 'paused'
            ? 'paused_before_send'
            : modeBeforeSend === 'human'
              ? 'human_before_send'
              : 'missing_mode_before_send',
        metaSent: false,
      }
    }

    const account = await db.socialAccount.findFirst({
      where: { id: args.socialAccountId, tenantId: args.tenantId },
      select: {
        id: true,
        platform: true,
        accessToken: true,
        refreshToken: true,
        accountId: true,
      },
    })
    if (!account?.accessToken) return { ran: true, skippedReason: 'no_account', metaSent: false }

    const token = decryptSocialAccessToken(account.accessToken)
    if (!token) return { ran: true, skippedReason: 'no_token', metaSent: false }
    const parsed = parseSocialRefreshToken(account.refreshToken)
    const send = await sendMetaText({
      platform: args.platform,
      accessToken: token,
      phoneNumberId: account.accountId,
      pageId: parsed.pageId || (args.platform === 'instagram' ? account.accountId : null),
      recipient: args.senderId,
      text: result.reply,
    })

    await db.chatMessage.create({
      data: {
        tenantId: args.tenantId,
        socialAccountId: args.socialAccountId,
        direction: 'outbound',
        content: result.reply,
        orderId: result.orderId || null,
        metadata: {
          softAi: true,
          toolLog: result.toolLog,
          agentMode: result.agentMode,
          to: args.senderId,
          platform: args.platform,
          providerMessageId: send.providerMessageId,
          sendOk: send.ok,
          sendError: send.error || null,
        },
        sentAt: new Date(),
      },
    })

    // Persist escalated mode into flag.config.agentState (server truth)
    if (result.agentMode !== 'ai_active') {
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
          mode: result.agentMode,
          updatedAt: new Date().toISOString(),
          action: 'escalate',
          staffControlled: result.agentMode === 'human',
        }
        await db.tenantFeatureFlag.update({
          where: { id: existing.id },
          data: { config: { ...prev, agentState } },
        })
      }
    }

    return { ran: true, metaSent: send.ok }
  } catch (error) {
    console.error('[soft-ai/inbound-hook]', error)
    return { ran: false, skippedReason: 'error' }
  }
}
