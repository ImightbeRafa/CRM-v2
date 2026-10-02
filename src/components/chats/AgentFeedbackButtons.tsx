'use client'

import { useState } from 'react'

const REASONS = [
  { code: 'wrong_fact', label: 'Dato incorrecto' },
  { code: 'wrong_tone', label: 'Tono' },
  { code: 'should_have_escalated', label: 'Debió pasarlo a una persona' },
] as const

/** Staff thumbs on an agent-sent message. Small, optional, and silent on failure. */
export function AgentFeedbackButtons({ turnId }: { turnId: string }) {
  const [state, setState] = useState<'idle' | 'up' | 'down' | 'sent'>('idle')
  const [busy, setBusy] = useState(false)

  async function send(rating: 1 | -1, reasonCode?: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/chat/agents/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId, rating, reasonCode }),
      })
      if (res.ok) setState('sent')
    } catch {
      /* feedback is optional */
    } finally {
      setBusy(false)
    }
  }

  if (state === 'sent') {
    return <span className="ml-1 text-[10px] text-emerald-600">Gracias</span>
  }
  return (
    <span className="ml-1 inline-flex items-center gap-1" data-testid="agent-feedback">
      <button
        type="button"
        disabled={busy}
        aria-label="Buena respuesta"
        onClick={() => void send(1)}
        className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100 disabled:opacity-40"
      >
        👍
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label="Mala respuesta"
        onClick={() => setState(state === 'down' ? 'idle' : 'down')}
        className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100 disabled:opacity-40"
      >
        👎
      </button>
      {state === 'down'
        ? REASONS.map((r) => (
            <button
              key={r.code}
              type="button"
              disabled={busy}
              onClick={() => void send(-1, r.code)}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-200 disabled:opacity-40"
            >
              {r.label}
            </button>
          ))
        : null}
    </span>
  )
}
