'use client'

import { useEffect, useState } from 'react'

type SpecialPrice = { scope: 'item' | 'category'; ref: string; price: number }
type Promo = {
  active: boolean
  endsAt: string | null
  freeShipping: boolean
  freeShippingMethodIds: string[]
  specialPrices: SpecialPrice[]
  codHighlight: boolean
  headline: string | null
}

const EMPTY: Promo = { active: false, endsAt: null, freeShipping: false, freeShippingMethodIds: [], specialPrices: [], codHighlight: false, headline: null }

/**
 * "Promoción activa" (B1): the only promotion the agent may mention. Betsy applies it in code — shipping ₡0, special
 * prices — and the agent just repeats it. Anything else (discounts, 2x1, %) stays blocked.
 */
export function AgentPromoCard({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [promo, setPromo] = useState<Promo | null>(null)
  const [saved, setSaved] = useState<Promo | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, { cache: 'no-store' }).catch(() => null)
      if (!res?.ok) return
      const json = (await res.json()) as { promo?: Promo | null }
      if (cancelled) return
      const p = { ...EMPTY, ...(json.promo ?? {}) }
      setPromo(p)
      setSaved(p)
    })()
    return () => {
      cancelled = true
    }
  }, [agentId])

  async function save() {
    if (!promo) return
    setBusy(true)
    setMsg(null)
    const res = await fetch(`/api/chat/agents/${encodeURIComponent(agentId)}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promo }),
    }).catch(() => null)
    const json = res ? ((await res.json().catch(() => ({}))) as { promo?: Promo; error?: string }) : {}
    if (res?.ok && json.promo) {
      setPromo(json.promo)
      setSaved(json.promo)
      setMsg('Guardado. Volvé a “Probar y activar” para que el agente pase sus pruebas con la promoción.')
    } else setMsg(json.error || 'No se pudo guardar.')
    setBusy(false)
  }

  if (!promo) return null
  const dirty = JSON.stringify(promo) !== JSON.stringify(saved)
  const blankRow = Boolean(promo?.specialPrices.some((sp) => !sp.ref.trim() || !(sp.price > 0)))
  const set = (p: Partial<Promo>) => setPromo({ ...promo, ...p })
  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label className="flex items-start gap-2 text-[13px] text-slate-800">
      <input type="checkbox" checked={value} disabled={!canEdit} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#5B6CFF]" />
      <span>
        {label}
        {hint ? <span className="block text-[11px] text-slate-500">{hint}</span> : null}
      </span>
    </label>
  )

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-4 md:p-5" data-testid="agent-promo-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-semibold text-slate-900">Promoción activa</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${promo.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {promo.active ? 'Activa' : 'Sin promoción'}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-slate-500">Es la única promoción que el agente puede ofrecer. Betsy aplica los precios; el agente solo la menciona.</p>
      <div className="mt-3 space-y-2">
        {toggle('Promoción encendida', promo.active, (v) => set({ active: v }))}
        {promo.active ? (
          <div className="space-y-2 rounded-xl bg-slate-50 p-3">
            {toggle('Envío gratis', promo.freeShipping, (v) => set({ freeShipping: v }), 'Todos los envíos que ofrece este agente pasan a ₡0.')}
            {toggle('Destacar pago contra entrega', promo.codHighlight, (v) => set({ codHighlight: v }), 'Solo donde tus zonas de envío lo permiten.')}
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Frase de la promoción (sin precios)</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px]"
                maxLength={200}
                disabled={!canEdit}
                value={promo.headline ?? ''}
                placeholder="Ej: ¡Envío gratis a todo Costa Rica por tiempo limitado!"
                onChange={(e) => set({ headline: e.target.value || null })}
              />
            </label>
            <div className="space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Precio especial por categoría (opcional)</span>
              {promo.specialPrices.map((sp, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px]"
                    placeholder="Categoría (ej. ARNESS)"
                    disabled={!canEdit}
                    value={sp.ref}
                    onChange={(e) => set({ specialPrices: promo.specialPrices.map((x, j) => (j === i ? { ...x, scope: 'category', ref: e.target.value } : x)) })}
                  />
                  <input
                    className="w-28 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px]"
                    inputMode="numeric"
                    placeholder="₡"
                    disabled={!canEdit}
                    value={sp.price || ''}
                    onChange={(e) => set({ specialPrices: promo.specialPrices.map((x, j) => (j === i ? { ...x, price: Number(e.target.value.replace(/\D/g, '')) || 0 } : x)) })}
                  />
                  {canEdit ? (
                    <button type="button" className="text-[12px] text-red-600" onClick={() => set({ specialPrices: promo.specialPrices.filter((_, j) => j !== i) })}>
                      Quitar
                    </button>
                  ) : null}
                </div>
              ))}
              {canEdit && promo.specialPrices.length < 5 ? (
                <button
                  type="button"
                  className="text-[12px] font-medium text-au-ink-5b6cff"
                  onClick={() => set({ specialPrices: [...promo.specialPrices, { scope: 'category', ref: '', price: 0 }] })}
                >
                  + Precio especial
                </button>
              ) : null}
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-slate-600">Termina el (opcional)</span>
              <input
                type="date"
                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px]"
                disabled={!canEdit}
                value={promo.endsAt ?? ''}
                onChange={(e) => set({ endsAt: e.target.value || null })}
              />
            </label>
          </div>
        ) : null}
      </div>
      {canEdit ? (
        <>
        <button
          type="button"
          disabled={busy || !dirty || blankRow}
          onClick={() => void save()}
          className="mt-3 rounded-lg bg-[#5B6CFF] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Guardando…' : 'Guardar promoción'}
        </button>
        {blankRow ? <p className="mt-1 text-[11px] text-amber-800">Completá la categoría y el precio de cada precio especial (o quitá la fila).</p> : null}
        </>
      ) : null}
      {msg ? <p className="mt-2 text-[12px] text-slate-600">{msg}</p> : null}
    </div>
  )
}
