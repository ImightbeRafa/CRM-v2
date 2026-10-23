'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatMarkup, formatUsdMicros, type AiBillingRate } from '@/lib/ai-billing/math'
import { formatUsdCents } from '@/lib/pricing/plan'

type Settings = { packs: Array<{ id: string; creditCents: number }>; ceilingMicros: number | null; enforce: boolean; cutoverPeriod: string | null }
type Payload = {
  ready: boolean
  periodKey: string
  current: AiBillingRate
  rates: AiBillingRate[]
  settings: Settings
  packQuotes: Array<{ packId: string; priceCents: number; totalCents: number }>
}

const input = 'w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-900'
const btn = 'rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50'

/** Owner only: what businesses pay for AI (markup, free credit, packs, ceiling, enforcement) + manual credits. */
export function AiBillingSettingsCard({ tenants }: { tenants: Array<{ id: string; name: string }> }) {
  const [p, setP] = useState<Payload | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ markup: '1.5', free: '0', packs: '10, 25, 50', ceiling: '', enforce: false, effectiveNow: false })
  const [adj, setAdj] = useState({ tenantId: '', amount: '', note: '' })

  const load = useCallback(async () => {
    const res = await fetch('/api/super-admin/ai-billing', { cache: 'no-store' })
    if (!res.ok) return
    const json = (await res.json()) as Payload
    setP(json)
    const next = json.rates.find((r) => r.periodKey > json.periodKey) ?? json.current
    setForm((f) => ({
      ...f,
      markup: String(next.markupBps / 10_000),
      free: String(next.freeMonthlyMicros / 1_000_000),
      packs: json.settings.packs.map((x) => x.creditCents / 100).join(', '),
      ceiling: json.settings.ceilingMicros ? String(json.settings.ceilingMicros / 1_000_000) : '',
      enforce: json.settings.enforce,
    }))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/super-admin/ai-billing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markup: Number(form.markup),
          freeMonthlyUsd: Number(form.free),
          effectiveNow: form.effectiveNow,
          packsUsd: form.packs.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0),
          ceilingUsd: form.ceiling.trim() ? Number(form.ceiling) : null,
          enforce: form.enforce,
        }),
      })
      const json = await res.json().catch(() => ({}))
      setMsg(res.ok ? `Guardado. La tarifa rige desde ${json.ratePeriod}.` : json.error || 'No se pudo guardar')
      if (res.ok) {
        // One-shot: a later save (e.g. packs) must not reprice the current month again.
        setForm((f) => ({ ...f, effectiveNow: false }))
        await load()
      }
    } finally {
      setBusy(false)
    }
  }

  async function adjust() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/super-admin/ai-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: adj.tenantId, amountUsd: Number(adj.amount), note: adj.note, requestId: crypto.randomUUID() }),
      })
      const json = await res.json().catch(() => ({}))
      setMsg(res.ok ? 'Ajuste guardado.' : json.error || 'No se pudo guardar')
      if (res.ok) setAdj({ tenantId: '', amount: '', note: '' })
    } finally {
      setBusy(false)
    }
  }

  if (!p) return null
  const markupNow = formatMarkup(p.current.markupBps)

  return (
    <section className="rounded-xl border border-slate-200 bg-white" aria-labelledby="ai-billing-owner">
      <h3 id="ai-billing-owner" className="border-b border-slate-100 px-4 py-3 text-[14px] font-semibold text-slate-900">
        Cobro de IA a los negocios
      </h3>
      <div className="space-y-4 p-4 text-[13px]">
        {!p.ready && <p className="text-amber-700">Falta aplicar SQL 060: se muestran los valores por defecto y no se puede guardar.</p>}
        <p className="text-slate-600">
          Este mes ({p.periodKey}): margen {markupNow}, {formatUsdMicros(p.current.freeMonthlyMicros)} gratis por negocio.{' '}
          {p.settings.enforce ? 'Los topes PAUSAN los agentes.' : 'Los topes son solo informativos (no pausan).'}
          {p.settings.cutoverPeriod ? ` Saldo descontado desde ${p.settings.cutoverPeriod}.` : ''}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-slate-600">Margen (×)</span>
            <input className={input} inputMode="decimal" value={form.markup} onChange={(e) => setForm({ ...form, markup: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-slate-600">Crédito gratis / mes (USD)</span>
            <input className={input} inputMode="decimal" value={form.free} onChange={(e) => setForm({ ...form, free: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-slate-600">Paquetes (USD, antes de IVA)</span>
            <input className={input} value={form.packs} onChange={(e) => setForm({ ...form, packs: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-slate-600">Tope máximo por negocio (USD)</span>
            <input className={input} inputMode="decimal" placeholder="Sin tope" value={form.ceiling} onChange={(e) => setForm({ ...form, ceiling: e.target.value })} />
          </label>
        </div>
        <p className="text-slate-500">
          Paquetes hoy: {p.packQuotes.map((q) => `${formatUsdCents(q.priceCents)} → cobra ${formatUsdCents(q.totalCents)} con IVA`).join(' · ')}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.enforce} onChange={(e) => setForm({ ...form, enforce: e.target.checked })} />
            Pausar los agentes al llegar al tope o sin saldo
          </label>
          {Number(form.free) === 0 && (
            <p className="w-full text-[12px] text-amber-800">
              Con crédito gratis en $0, al activar la pausa los negocios con agente que no tengan saldo se pausan de inmediato.
              Antes, cargales crédito (ajuste manual) o agregalos a AI_ALLOWANCE_EXEMPT_TENANTS.
            </p>
          )}
          <label className="flex items-center gap-2 text-amber-800">
            <input type="checkbox" checked={form.effectiveNow} onChange={(e) => setForm({ ...form, effectiveNow: e.target.checked })} />
            Aplicar la tarifa a ESTE mes (solo emergencias)
          </label>
          <button type="button" className={btn} disabled={busy || !p.ready} onClick={save}>
            Guardar
          </button>
        </div>
        <p className="text-[12px] text-slate-500">
          Un cambio de margen o crédito gratis rige desde el mes siguiente, así no se recalcula un mes empezado. Tus negocios en
          AI_ALLOWANCE_EXEMPT_TENANTS nunca tienen tope. La pausa solo actúa sobre los agentes y cuando el corte de Lane D esté
          conectado (docs/plans/ai-credits-allowance-spec.md). El primer guardado fija el mes desde el que se descuenta el saldo.
          La venta de paquetes además necesita AI_CREDIT_PACKS_ENABLED=true.
        </p>

        <div className="border-t border-slate-100 pt-4">
          <p className="mb-2 font-medium text-slate-900">Ajuste manual de saldo</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_0.6fr_1.4fr_auto]">
            <select aria-label="Negocio" className={input} value={adj.tenantId} onChange={(e) => setAdj({ ...adj, tenantId: e.target.value })}>
              <option value="">Negocio…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input aria-label="Monto USD" className={input} inputMode="decimal" placeholder="+10 / -2" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} />
            <input aria-label="Motivo" className={input} placeholder="Motivo (ej. pago por SINPE)" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} />
            <button type="button" className={btn} disabled={busy || !p.ready || !adj.tenantId || !adj.amount || adj.note.trim().length < 3} onClick={adjust}>
              Ajustar
            </button>
          </div>
        </div>
        {msg && <p className="text-slate-700" role="status">{msg}</p>}
      </div>
    </section>
  )
}
