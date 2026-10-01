'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Megaphone } from 'lucide-react'
import type { ChatAdAttributionDto, ChatAdTouchDto } from '@/lib/meta-attribution/read'

/** Only real https links are clickable (the server already drops anything else). */
export function safeAdHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })
}

function touchTitle(t: ChatAdTouchDto): string {
  if (t.headline) return t.headline
  if (t.sourceType === 'ad') return t.platform === 'instagram' ? 'Anuncio de Instagram' : 'Anuncio de WhatsApp'
  return 'Publicación'
}

/**
 * "Llegó por un anuncio" card in the chat side panel. Renders nothing for chats that did not
 * come from an ad (or before the feature's table exists).
 */
export function ChatAdOriginCard({ conversationId }: { conversationId: string }) {
  const [data, setData] = useState<ChatAdAttributionDto | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    void (async () => {
      try {
        const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/attribution`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        })
        if (!res.ok) return
        const json = (await res.json()) as { success?: boolean; attribution?: ChatAdAttributionDto | null }
        if (!cancelled && json.success) setData(json.attribution ?? null)
      } catch {
        /* optional panel: stay hidden */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [conversationId])

  if (!data) return null
  const last = data.lastTouch
  const href = safeAdHref(last.sourceUrl)
  const sameAd = data.touches === 1 || data.firstTouch.sourceId === last.sourceId

  return (
    <div className="rounded-xl bg-violet-50/70 px-3 py-2.5 ring-1 ring-violet-100" data-testid="chat-ad-origin">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-violet-700">
        <Megaphone className="h-3.5 w-3.5" aria-hidden />
        Llegó por un anuncio
      </p>
      <p className="mt-1 line-clamp-2 text-[12px] font-semibold text-slate-800">{touchTitle(last)}</p>
      {last.body ? <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{last.body}</p> : null}
      <p className="mt-1 text-[10.5px] text-slate-400">
        {formatWhen(last.occurredAt)}
        {data.touches > 1 ? ` · ${data.touches} clics` : ''}
        {!sameAd ? ` · primero: ${touchTitle(data.firstTouch)}` : ''}
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:underline"
        >
          Ver anuncio <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      ) : null}
    </div>
  )
}
