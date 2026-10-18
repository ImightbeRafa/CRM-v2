'use client'

import { INBOX_VIEW_DEFS, type InboxView, type InboxViewCounts } from '@/lib/chat-inbox-views'

const TONE: Record<InboxView, { on: string; off: string }> = {
  todos: { on: 'bg-slate-900 text-white ring-slate-900', off: 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50' },
  persona: { on: 'bg-violet-600 text-white ring-violet-600', off: 'bg-violet-50 text-violet-800 ring-violet-200 hover:bg-violet-100' },
  pago: { on: 'bg-rose-600 text-white ring-rose-600', off: 'bg-rose-50 text-rose-800 ring-rose-200 hover:bg-rose-100' },
  pedido: { on: 'bg-orange-500 text-white ring-orange-500', off: 'bg-orange-50 text-orange-900 ring-orange-200 hover:bg-orange-100' },
  ia: { on: 'bg-au-ink-5b6cff text-white ring-[#5B6CFF]', off: 'bg-au-tint-eef0ff text-au-ink-4a46e5 ring-[#5B6CFF]/25 hover:bg-au-tint-f5f6ff' },
  seguimientos: { on: 'bg-slate-600 text-white ring-slate-600', off: 'bg-slate-50 text-slate-700 ring-slate-200 hover:bg-slate-100' },
}

/**
 * /chats quick views (chat-inbox-views.ts): a row of chips with counts, desktop and mobile.
 * "Bandeja" is the normal list; the others show every open chat of that kind on the selected channel / line.
 */
export function InboxViewTabs({
  view,
  counts,
  onChange,
  wrap = false,
}: {
  view: InboxView
  counts: InboxViewCounts | null
  onChange: (view: InboxView) => void
  /** Desktop column: wrap onto two rows instead of a sideways swipe. */
  wrap?: boolean
}) {
  return (
    <div
      role="tablist"
      aria-label="Vistas de la bandeja"
      className={`mx-4 mt-3 flex gap-1.5 ${wrap ? 'flex-wrap' : 'overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'}`}
      data-testid="chat-view-tabs"
    >
      {INBOX_VIEW_DEFS.map((def) => {
        const active = view === def.id
        const count = def.id === 'todos' || !counts ? null : counts[def.id]
        const tone = TONE[def.id]
        return (
          <button
            key={def.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={def.label}
            aria-label={count != null ? `${def.label}: ${count}` : def.label}
            onClick={() => onChange(def.id)}
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 transition-colors ${
              active ? tone.on : tone.off
            }`}
            data-testid={`chat-view-${def.id}`}
          >
            {def.emoji ? <span aria-hidden>{def.emoji}</span> : null}
            {def.short}
            {count != null ? (
              <span
                className={`rounded-full px-1.5 py-px text-[10.5px] font-bold ${
                  active ? 'bg-static-white/25 text-white' : count > 0 ? 'bg-white text-slate-900' : 'bg-white/60 text-slate-400'
                }`}
              >
                {count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
