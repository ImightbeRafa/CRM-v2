'use client'

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
  return (
    <aside className="hidden h-full w-[220px] shrink-0 flex-col overflow-y-auto border-r border-slate-100 bg-[#fafbfd] px-3 py-4 lg:flex">
      <h2 className="px-1 text-lg font-semibold text-slate-900">Inbox</h2>

      <label className="relative mt-3 block">
        <span className="sr-only">Buscar</span>
        <input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar…  ⌘K"
          className="w-full rounded-[10px] border-0 bg-white px-3 py-2 text-xs text-slate-800 shadow-sm outline-none ring-1 ring-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-[#5b6cff]/40"
        />
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
                  ? 'bg-[#eef1ff] font-medium text-indigo-700'
                  : 'text-slate-600 hover:bg-white'
              }`}
            >
              {item.label}
              {item.id === 'ia_manejando' && monitor.aiActive > 0 ? (
                <span className="ml-1 text-[11px] text-indigo-500">· {monitor.aiActive}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      <p className="mt-6 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        Canales
      </p>
      <div className="mt-1 space-y-1 px-1 text-xs">
        <p className="text-green-800">WhatsApp · {whatsappCount}</p>
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
                active ? 'bg-amber-100 text-amber-900' : 'text-slate-600 hover:bg-white'
              }`}
            >
              {tag}
            </button>
          )
        })}
      </div>

      <div className="mt-6 rounded-xl bg-[#f8faff] p-3">
        <p className="text-[11px] font-semibold text-[#5b6cff]">✦ Monitor agente</p>
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
            Acciones tool · {monitor.toolActions}
          </li>
        </ul>
      </div>
    </aside>
  )
}
