'use client'

import { useEffect, useState } from 'react'
import type { SoftAiMonitorStats, SoftTag, InboxBucket } from '@/lib/chat-soft-copilot'

interface SoftInboxBucketsProps {
  bucket: InboxBucket
  onBucketChange: (bucket: InboxBucket) => void
  search: string
  onSearchChange: (value: string) => void
  whatsappCount: number
  instagramCount: number
  monitor: SoftAiMonitorStats
  tags: SoftTag[]
  onTagClick?: (tag: SoftTag) => void
  activeTag?: SoftTag | null
}

const BUCKETS: Array<{ id: InboxBucket; label: string }> = [
  { id: 'tus_chats', label: 'Tus chats' },
  { id: 'abiertos', label: 'Abiertos' },
  { id: 'ia_manejando', label: 'IA manejando' },
  { id: 'sin_asignar', label: 'Sin asignar' },
  { id: 'hechos', label: 'Hechos' },
]

export function SoftInboxBuckets({
  bucket,
  onBucketChange,
  search,
  onSearchChange,
  whatsappCount,
  instagramCount,
  monitor,
  tags,
  onTagClick,
  activeTag,
}: SoftInboxBucketsProps) {
  // Real shortcut (see SoftCopilotInboxV2): ⌘K on Mac, Ctrl K elsewhere. Set after mount
  // so server and client render the same markup.
  const [shortcut, setShortcut] = useState('Ctrl K')
  useEffect(() => {
    if (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setShortcut('⌘K')
  }, [])

  return (
    <aside className="hidden h-full w-[220px] shrink-0 flex-col overflow-y-auto border-r border-slate-200/70 bg-white px-3 py-4 lg:flex">
      <h2 className="px-1 text-[15px] font-semibold text-slate-900">Bandeja</h2>

      <label className="relative mt-3 block">
        <span className="sr-only">Buscar chats</span>
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar…"
          data-chat-search
          aria-keyshortcuts="Control+K Meta+K"
          className="peer w-full rounded-xl border-0 bg-slate-50 py-2 pl-3 pr-14 text-xs text-slate-800 outline-none ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-[#5B6CFF]/40"
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-sans text-[10px] font-medium text-slate-400 transition-opacity peer-focus:opacity-0"
        >
          {shortcut}
        </kbd>
      </label>

      <div className="mt-4 space-y-1">
        {BUCKETS.map((item) => {
          const active = bucket === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onBucketChange(item.id)}
              className={`w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                active
                  ? 'bg-au-tint-eef0ff font-semibold text-au-ink-4a46e5'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {item.label}
              {item.id === 'ia_manejando' && monitor.aiActive > 0 ? (
                <span className="ml-1 text-[11px] text-au-ink-5b6cff">· {monitor.aiActive}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      <p className="mt-6 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        Canales
      </p>
      <div className="mt-1 space-y-1 px-1 text-xs">
        <p className="text-emerald-700">WhatsApp · {whatsappCount}</p>
        <p className="text-pink-800">Instagram · {instagramCount}</p>
      </div>

      <p className="mt-5 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        Etiquetas
      </p>
      <div className="mt-1 flex flex-wrap gap-1 px-1">
        {tags.map((tag) => {
          const active = activeTag === tag
          return (
            <button
              key={tag}
              type="button"
              onClick={() => onTagClick?.(tag)}
              className={`rounded-md px-2 py-0.5 text-[11px] ${
                active ? 'bg-amber-100 text-amber-900' : 'text-slate-600 ring-1 ring-slate-200/70 hover:bg-slate-50'
              }`}
            >
              {tag}
            </button>
          )
        })}
      </div>

      <div className="mt-6 rounded-xl bg-au-tint-f5f6ff p-3 ring-1 ring-[#5B6CFF]/10">
        <p className="text-[11px] font-semibold text-au-ink-5b6cff">✦ Agentes</p>
        <ul className="mt-2 space-y-1 text-[11px] text-slate-600">
          <li>
            <span className="mr-1 inline-block w-3">●</span>
            IA activa · {monitor.aiActive}
          </li>
          <li>
            <span className="mr-1 inline-block w-3">❚❚</span>
            Pausada · {monitor.paused}
          </li>
          <li>
            <span className="mr-1 inline-block w-3">👤</span>
            Humano · {monitor.human}
          </li>
          <li>
            <span className="mr-1 inline-block w-3">⚒</span>
            Acciones de agentes · {monitor.toolActions}
          </li>
        </ul>
      </div>
    </aside>
  )
}
