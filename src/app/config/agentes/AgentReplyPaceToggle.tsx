'use client'

import { useEffect, useState } from 'react'
import { parseReplyPace, REPLY_PACE_EVENT, REPLY_PACE_OPTIONS, type ReplyPace } from '@/lib/soft-ai/reply-pace'

/** "Velocidad de respuesta" — how fast the reply goes out in a real chat. Per agent; default Natural. */
export function AgentReplyPaceToggle({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [pace, setPace] = useState<ReplyPace | null>(null)
  const [typing, setTyping] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, { cache: 'no-store' }).catch(() => null)
      if (!res?.ok) return
      const json = (await res.json()) as { replyPace?: unknown; typingIndicator?: unknown }
      if (!cancelled) {
        setPace(parseReplyPace(json.replyPace))
        setTyping(json.typingIndicator !== false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [agentId])

  async function save(next: ReplyPace) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyPace: next }),
    }).catch(() => null)
    if (res?.ok) {
      setPace(next)
      // The Probar note ("En WhatsApp se envía con ritmo …") follows the saved value.
      window.dispatchEvent(new CustomEvent(REPLY_PACE_EVENT, { detail: { agentId, pace: next } }))
    } else setError('No se pudo guardar.')
    setBusy(false)
  }

  async function saveTyping(next: boolean) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typingIndicator: next }),
    }).catch(() => null)
    if (res?.ok) setTyping(next)
    else setError('No se pudo guardar.')
    setBusy(false)
  }

  if (!pace) return null
  return (
    <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200/70" data-testid="agent-reply-pace">
      <p className="text-[12px] font-medium text-slate-700">Velocidad de respuesta</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Velocidad de respuesta">
        {REPLY_PACE_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={pace === o.key}
            disabled={!canEdit || busy}
            onClick={() => void save(o.key)}
            className={`rounded-full px-3 py-1 text-[12px] font-medium disabled:opacity-60 ${
              pace === o.key ? 'bg-[#5B6CFF] text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{REPLY_PACE_OPTIONS.find((o) => o.key === pace)?.hint}</p>
      {pace !== 'instant' ? (
        <label className="mt-1.5 flex items-center gap-1.5 text-[12px] text-slate-700" data-testid="agent-typing-indicator">
          <input type="checkbox" checked={typing} disabled={!canEdit || busy} onChange={(e) => void saveTyping(e.target.checked)} />
          Mostrar “escribiendo…” en WhatsApp
          <span className="text-[11px] text-slate-500">· Marca el mensaje como leído (✓✓ azul)</span>
        </label>
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-red-700">{error}</p> : null}
    </div>
  )
}
