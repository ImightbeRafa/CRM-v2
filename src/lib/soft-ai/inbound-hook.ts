/**
 * Soft Tenant AI inbound hook — after CRM chat webhook stores an inbound,
 * optionally run the tenant AI worker and send a full reply.
 * Feature-flagged (soft_tenant_ai_v1). Never touches staff bot routes.
 */

import { prisma } from '@/lib/db'
import { shouldUseSoftTenantAiV1, readSoftTenantAiConfig } from '@/lib/feature-flags'
import { parseSoftAiConfig } from '@/lib/soft-ai/config'
import { runSoftAiTurn } from '@/lib/soft-ai/worker'
import { buildSoftAiServerDeps } from '@/lib/soft-ai/server-deps'
import type { SoftAiAgentMode } from '@/lib/soft-ai/types'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { parseSocialRefreshToken } from '@/lib/social-account-meta'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'

type InboundHookArgs = {
  tenantId: string
  socialAccountId: string
  senderId: string
  senderName?: string | null
  platform: string
  content: string
}

function conversationKey(socialAccountId: string, recipientId: string) {
  return `${socialAccountId}::${recipientId}`
}

function readAgentModeFromConfig(
  config: Record<string, unknown>,
  key: string,
): SoftAiAgentMode {
  const agentState = config.agentState
  if (!agentState || typeof agentState !== 'object') return 'ai_active'
  const row = (agentState as Record<string, { mode?: string }>)[key]
  const mode = row?.mode
  if (mode === 'paused' || mode === 'human' || mode === 'ai_active') return mode
  return 'ai_active'
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
 */
export async function maybeRunSoftAiAfterInbound(args: InboundHookArgs): Promise<void> {
  try {
    const enabled = await shouldUseSoftTenantAiV1(args.tenantId)
    if (!enabled) return

    const flag = await readSoftTenantAiConfig(args.tenantId)
    const config = parseSoftAiConfig(flag.config)
    const key = conversationKey(args.socialAccountId, args.senderId)
    const agentMode = readAgentModeFromConfig(flag.config, key)
    if (agentMode !== 'ai_active') return

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
        const peer =
          // inbound from sender or outbound to sender
          meta.from === args.senderId || meta.to === args.senderId
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
        agentMode,
        config,
        tags: [],
        orderId,
        demo: false,
      },
      buildSoftAiServerDeps(args.tenantId),
    )

    if (result.skipped || !result.reply) return

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
    if (!account?.accessToken) return

    const token = decryptSocialAccessToken(account.accessToken)
    if (!token) return
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

    // Persist escalated mode into flag.config.agentState
    if (result.agentMode !== 'ai_active') {
      const existing = await db.tenantFeatureFlag.findFirst({
        where: {
          tenantId: args.tenantId,
          scope: args.tenantId,
          key: 'soft_tenant_ai_v1',
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
        }
        await db.tenantFeatureFlag.update({
          where: { id: existing.id },
          data: { config: { ...prev, agentState } },
        })
      }
    }
  } catch (error) {
    console.error('[soft-ai/inbound-hook]', error)
  }
}
