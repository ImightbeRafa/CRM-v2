'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Filter, Pause, Sparkles, User, Wrench } from 'lucide-react'
import type { InboxBucket, SoftAiMonitorStats, SoftTag } from '@/lib/chat-soft-copilot'
import { useCrmCatalog } from '@/components/chats/useCrmCatalog'

export const INBOX_VIEWS: Array<{ id: InboxBucket; label: string }> = [
  { id: 'tus_chats', label: 'Tus chats' },
  { id: 'abiertos', label: 'Abiertos' },
  { id: 'ia_manejando', label: 'IA manejando' },
  { id: 'sin_asignar', label: 'Sin asignar' },
  { id: 'hechos', label: 'Hechos' },
]

export function inboxViewLabel(bucket: InboxBucket | undefined): string {
  return INBOX_VIEWS.find((v) => v.id === bucket)?.label ?? 'Abiertos'
}

function useOutside(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])
  return ref
}

/** Desktop list title: "Abiertos · 23 ▾" opens the inbox views (+ agent summary). */
export function ChatViewMenu({
  bucket,
  onBucketChange,
  count,
  monitor,
}: {
  bucket: InboxBucket
  onBucketChange: (b: InboxBucket) => void
  count: number
  monitor?: SoftAiMonitorStats
}) {
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="-ml-1.5 flex max-w-full items-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-0.5 text-[15px] font-semibold text-slate-900 transition-colors hover:bg-slate-100"
        data-testid="chat-view-menu"
      >
        <span className="truncate">{inboxViewLabel(bucket)}</span>
        <span className="font-medium text-slate-400">· {count}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1.5 w-[240px] overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-slate-200"
        >
          {INBOX_VIEWS.map((v) => {
            const active = v.id === bucket
            return (
              <button
                key={v.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onBucketChange(v.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] ${
                  active ? 'bg-au-tint-eef0ff font-semibold text-au-ink-4a46e5' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="flex-1">{v.label}</span>
                {active ? <Check className="h-4 w-4" aria-hidden /> : null}
              </button>
            )
          })}
          {monitor ? (
            <div className="mt-1.5 grid grid-cols-2 gap-1 border-t border-slate-100 px-1.5 pb-1 pt-2 text-[11px] text-slate-500" data-testid="chat-agent-summary">
              <span className="flex items-center gap-1"><Sparkles className="h-3 w-3 text-au-ink-5b6cff" aria-hidden /> IA activa · {monitor.aiActive}</span>
              <span className="flex items-center gap-1"><Pause className="h-3 w-3" aria-hidden /> Pausada · {monitor.paused}</span>
              <span className="flex items-center gap-1"><User className="h-3 w-3" aria-hidden /> Humano · {monitor.human}</span>
              <span className="flex items-center gap-1"><Wrench className="h-3 w-3" aria-hidden /> Acciones · {monitor.toolActions}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Tag filter as one compact button (replaces the always-visible Etiquetas block). */
export function ChatTagFilter({
  tags,
  activeTag,
  onTagClick,
}: {
  tags: SoftTag[]
  activeTag: SoftTag | null
  onTagClick: (t: SoftTag) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  // Filters use the stored key; the button shows the name set in Config › Chats.
  const { tagLabel } = useCrmCatalog()
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors ${
          activeTag ? 'bg-amber-100 text-amber-900 ring-amber-200' : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50'
        }`}
        data-testid="chat-tag-filter"
      >
        <Filter className="h-3 w-3" aria-hidden />
        {activeTag ? tagLabel(activeTag) : 'Etiquetas'}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1.5 w-[160px] rounded-xl bg-white p-1 shadow-xl ring-1 ring-slate-200">
          {tags.map((t) => {
            const active = t === activeTag
            return (
              <button
                key={t}
                type="button"
                role="menuitemcheckbox"
                aria-checked={active}
                onClick={() => {
                  onTagClick(t)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] ${
                  active ? 'bg-amber-50 font-semibold text-amber-900' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="flex-1">{tagLabel(t)}</span>
                {active ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
