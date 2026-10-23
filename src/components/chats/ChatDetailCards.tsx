'use client'

import Link from 'next/link'
import { ChevronRight, Package } from 'lucide-react'
import type { SoftConversation } from '@/lib/chat-soft-copilot'
import { initialsFromName } from '@/lib/chat-soft-copilot'
import { conversationDisplayName } from '@/lib/chat-peer-display'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import { PeerAvatar } from '@/components/chats/PeerAvatar'
import {
  customerHandle,
  lineChannelLabel,
  ORDER_TONE_CLASS,
  orderStatusTone,
  orderTotalLabel,
  shortOrderNumber,
  withoutEmoji,
} from '@/lib/chat-row-display'

/**
 * Chat detail (Rafael 2026-10-22): who the customer is, which business line + channel the chat is on, and the
 * linked order (short number, status, total, items). Shared by the thread header and the details panel.
 */

/** Linked order: inline pill for the header, full card (with items) for the details panel. */
export function LinkedOrderCard({ conversation, variant = 'card' }: { conversation: SoftConversation; variant?: 'inline' | 'card' }) {
  if (!conversation.orderId) return null
  const number = conversation.orderNumber ? shortOrderNumber(conversation.orderNumber) : 'Pedido'
  const tone = orderStatusTone(conversation.orderStatus)
  const status = conversation.orderStatus ? withoutEmoji(conversation.orderStatus) : null
  const total = orderTotalLabel(conversation.orderTotal)
  const href = `/ventas?pedido=${encodeURIComponent(conversation.orderId)}`
  const title = `Pedido ${conversation.orderNumber || ''}`.trim()
  if (variant === 'inline') {
    return (
      <Link
        href={href}
        title={title}
        className="inline-flex max-w-[22rem] items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
        data-testid="soft-thread-order-link"
      >
        <Package className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
        <span className="font-semibold tabular-nums text-slate-900">{number}</span>
        {status ? (
          <span className={`shrink-0 rounded-md px-1.5 py-px text-[10.5px] font-semibold ring-1 ${ORDER_TONE_CLASS[tone]}`}>{status}</span>
        ) : null}
        {total ? <span className="shrink-0 tabular-nums text-slate-600">{total}</span> : null}
      </Link>
    )
  }
  return (
    <Link
      href={href}
      title={title}
      className="group block rounded-xl bg-white p-3 ring-1 ring-slate-200/80 transition-colors hover:ring-[#5B6CFF]/40"
      data-testid="chat-order-card"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-600 ring-1 ring-slate-200">
          <Package className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-slate-400">Pedido vinculado</p>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold tabular-nums text-slate-900">
            {number}
            {status ? (
              <span className={`rounded-md px-1.5 py-px text-[10.5px] font-semibold ring-1 ${ORDER_TONE_CLASS[tone]}`}>{status}</span>
            ) : null}
          </p>
        </div>
        {total ? <span className="shrink-0 text-[13px] font-semibold tabular-nums text-slate-900">{total}</span> : null}
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-slate-500" aria-hidden />
      </div>
      {conversation.orderItems ? (
        <p className="mt-2 line-clamp-2 border-t border-slate-100 pt-2 text-[12px] leading-snug text-slate-600" data-testid="chat-order-items">
          {conversation.orderItems}
        </p>
      ) : null}
    </Link>
  )
}

/** Customer identity + the business line / channel the chat is on (details panel top). */
export function ChatIdentityCard({ conversation }: { conversation: SoftConversation }) {
  const handle = customerHandle(conversation)
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-slate-200/80" data-testid="chat-identity-card">
      <PeerAvatar
        src={conversation.isDemo ? null : conversation.recipientAvatarUrl}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-au-tint-eef0ff text-[14px] font-bold text-au-ink-4a46e5"
      >
        {initialsFromName(conversation.recipientName)}
      </PeerAvatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold text-slate-900">{conversationDisplayName(conversation)}</p>
        {handle ? <p className="truncate text-[12px] tabular-nums text-slate-500">{handle}</p> : null}
        <p className="mt-1 flex min-w-0 items-center gap-1 text-[11.5px] text-slate-600">
          <ChannelLogo platform={conversation.platform} size={12} className="shrink-0" />
          <span className="truncate">{lineChannelLabel(conversation.accountLabel, conversation.platform)}</span>
        </p>
      </div>
    </div>
  )
}
