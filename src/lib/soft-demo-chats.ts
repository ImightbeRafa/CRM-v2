/**
 * Soft Copilot local demo chats for WD scoring / empty-inbox polish.
 * Client-only (localStorage). Never writes ChatMessage / tenant production data.
 * Clearly marked DEMO and fully removable.
 */

import type { ChatInboxMessage } from '@/lib/chat-inbox'
import type { SoftConversation, SoftSocialAccount } from '@/lib/chat-soft-copilot'

export const SOFT_DEMO_CHATS_KEY = 'betsy.softCopilot.demoChats.v1'
export const SOFT_DEMO_ACCOUNT_WA = 'demo-soft-account-wa'
export const SOFT_DEMO_ACCOUNT_IG = 'demo-soft-account-ig'

export type SoftDemoMode = 'on' | 'off'

export function isSoftDemoAccountId(id: string | null | undefined): boolean {
  return id === SOFT_DEMO_ACCOUNT_WA || id === SOFT_DEMO_ACCOUNT_IG
}

export function isSoftDemoConversation(
  conversation: Pick<SoftConversation, 'socialAccountId' | 'isDemo'> | null | undefined,
): boolean {
  if (!conversation) return false
  return Boolean(conversation.isDemo) || isSoftDemoAccountId(conversation.socialAccountId)
}

export function readSoftDemoMode(): SoftDemoMode {
  if (typeof window === 'undefined') return 'on'
  try {
    const raw = window.localStorage.getItem(SOFT_DEMO_CHATS_KEY)
    if (raw === 'off') return 'off'
    return 'on'
  } catch {
    return 'on'
  }
}

export function writeSoftDemoMode(mode: SoftDemoMode) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SOFT_DEMO_CHATS_KEY, mode)
  } catch {
    // ignore quota
  }
}

function msg(
  id: string,
  direction: 'inbound' | 'outbound',
  content: string,
  sentAt: string,
): ChatInboxMessage {
  return {
    id,
    direction,
    content,
    sentAt,
    receivedAt: direction === 'inbound' ? sentAt : null,
  }
}

/** Two WA + one IG demo threads — labels always include DEMO. */
export function buildSoftDemoConversations(nowMs = Date.now()): SoftConversation[] {
  const t = (minsAgo: number) => new Date(nowMs - minsAgo * 60_000).toISOString()

  const waTracking: SoftConversation = {
    recipientId: 'demo-wa-50688880001',
    recipientName: 'Demo · María Soto',
    lastMessage: '¿Me pasás la guía del pedido?',
    lastMessageAt: t(4),
    unreadCount: 1,
    messages: [
      msg('demo-wa-1a', 'inbound', 'Hola, pedí el kit ayer', t(40)),
      msg('demo-wa-1b', 'outbound', '¡Hola María! Ya está en preparación.', t(35)),
      msg('demo-wa-1c', 'inbound', '¿Me pasás la guía del pedido ORDER-8842?', t(4)),
    ],
    socialAccountId: SOFT_DEMO_ACCOUNT_WA,
    platform: 'whatsapp',
    accountLabel: 'WA · DEMO',
    status: 'nuevo',
    tags: ['Envío', 'Nuevo'],
    orderId: null,
    isDemo: true,
  }

  const waPrice: SoftConversation = {
    recipientId: 'demo-wa-50688880002',
    recipientName: 'Demo · Carlos Ruiz',
    lastMessage: '¿Cuánto sale el kit completo?',
    lastMessageAt: t(18),
    unreadCount: 1,
    messages: [
      msg('demo-wa-2a', 'inbound', 'Buenas, vi el anuncio', t(50)),
      msg('demo-wa-2b', 'inbound', '¿Cuánto sale el kit completo?', t(18)),
    ],
    socialAccountId: SOFT_DEMO_ACCOUNT_WA,
    platform: 'whatsapp',
    accountLabel: 'WA · DEMO',
    status: 'nuevo',
    tags: ['Nuevo'],
    orderId: null,
    isDemo: true,
  }

  const igHello: SoftConversation = {
    recipientId: 'demo-ig-17841400001',
    recipientName: 'Demo · @cliente.demo',
    lastMessage: 'Hola! Quiero info del envío a Heredia',
    lastMessageAt: t(12),
    unreadCount: 2,
    messages: [
      msg('demo-ig-1a', 'inbound', 'Hola!', t(22)),
      msg('demo-ig-1b', 'inbound', 'Hola! Quiero info del envío a Heredia', t(12)),
    ],
    socialAccountId: SOFT_DEMO_ACCOUNT_IG,
    platform: 'instagram',
    accountLabel: 'IG · DEMO',
    status: 'nuevo',
    tags: ['Envío', 'Nuevo'],
    orderId: null,
    isDemo: true,
  }

  return [waTracking, waPrice, igHello].sort((a, b) =>
    (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''),
  )
}

export function softDemoSocialAccounts(): SoftSocialAccount[] {
  return [
    {
      id: SOFT_DEMO_ACCOUNT_WA,
      platform: 'whatsapp',
      accountId: 'demo-phone',
      isActive: true,
      phoneNumberId: 'demo-phone',
      whatsappBusinessAccountId: 'demo-waba',
    },
    {
      id: SOFT_DEMO_ACCOUNT_IG,
      platform: 'instagram',
      accountId: 'demo.ig',
      isActive: true,
      pageId: 'demo-page',
    },
  ]
}
