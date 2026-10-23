'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Loader2, PauseCircle, Sparkles } from 'lucide-react'
import { ConfigPanelHeader } from '@/components/aurora/config/panels/ConfigPanelHeader'
import { auroraBtnPrimary, auroraBtnSecondary, auroraInputClass, auroraLabelClass } from '@/components/aurora/ui/aurora-form'
import { notify } from '@/lib/ui-notify'
import { formatMarkup, formatUsdMicros, type AiBillingRate, type CreditDecision } from '@/lib/ai-billing/math'
import type { UsageReport } from '@/lib/ai-billing/report'
import { formatUsdCents } from '@/lib/pricing/plan'

type Quote = { packId: string; priceCents: number; ivaCents: number; totalCents: number; creditMicros: number }
type Purchase = { id: string; packId: string; creditMicros: number; totalCents: number; status: string; createdAt: string }
type Ledger = { id: string; kind: string; amountMicros: number; periodKey: string | null; createdAt: string }

type UsageData = {
  ready: boolean
  periodKey: string
  viewPeriod: string
  renewsAt: string
  ivaBps: number
  rate: AiBillingRate
  nextRate: AiBillingRate | null
  listMicros: number
  balanceMicros: number
  ownLimitMicros: number | null
  ceilingMicros: number | null
  agentEnabled: boolean
  exempt: boolean
  enforce: boolean
  decision: CreditDecision
  canManage: boolean
  packs: Quote[]
  report: UsageReport
  agentNames: Record<string, string>
  ledger: Ledger[]
  purchases: Purchase[]
}

const card = 'rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm'
const money = formatUsdMicros
const dateFmt = new Intl.DateTimeFormat('es-CR', { day: 'numeric', month: 'short' })
const monthFmt = new Intl.DateTimeFormat('es-CR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function monthLabel(periodKey: string) {
  const [y, m] = periodKey.split('-').map(Number)
  return monthFmt.format(new Date(Date.UTC(y, m - 1, 15)))
}

function lastMonths(periodKey: string, n: number) {
  const out: string[] = []
  let [y, m] = periodKey.split('-').map(Number)
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m -= 1
    if (m === 0) {
      m = 12
      y -= 1
    }
  }
  return out
}

const KIND_LABEL: Record<string, string> = { purchase: 'Compra de créditos', refund: 'Reembolso', adjustment: 'Ajuste de Betsy', usage_settle: 'Uso del mes' }

/** Config › Uso de IA: what this business's AI costs, how it is calculated, its limit and credits. */
export function AiUsagePanel() {
  const [data, setData] = useState<UsageData | null>(null)
  const [period, setPeriod] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [limitInput, setLimitInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [buying, setBuying] = useState<string | null>(null)

  const load = useCallback(async (p: string | null) => {
    setError(null)
    try {
      const res = await fetch(`/api/billing/ai-usage${p ? `?period=${p}` : ''}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'No pudimos cargar el uso de IA.')
      setData(json as UsageData)
      setLimitInput(json.ownLimitMicros ? String(json.ownLimitMicros / 1_000_000) : '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos cargar el uso de IA.')
    }
  }, [])

  useEffect(() => {
    void load(period)
  }, [load, period])

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('credits')
    if (q === 'ok') notify('Pago enviado. El saldo se acredita cuando Tilopay confirma el pago (suele tardar unos segundos).')
  }, [])

  async function saveLimit(clear = false) {
    const value = clear ? null : Number(limitInput.replace(',', '.'))
    if (!clear && !(Number.isFinite(value) && (value as number) >= 1)) {
      notify('Escribí un monto de al menos $1.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/billing/ai-limit', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyLimitUsd: value }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || 'No se pudo guardar el límite.')
      notify(json.clamped ? `Límite guardado en el máximo permitido (${money(json.ceilingMicros)}).` : clear ? 'Límite quitado.' : 'Límite guardado.')
      await load(period)
    } catch (e) {
      notify(`${e instanceof Error ? e.message : 'No se pudo guardar el límite.'}`)
    } finally {
      setSaving(false)
    }
  }

  async function buy(packId: string) {
    setBuying(packId)
    try {
      const res = await fetch('/api/billing/ai-credits/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.checkoutUrl) throw new Error(json?.error || 'No se pudo abrir el pago.')
      window.location.href = json.checkoutUrl
    } catch (e) {
      notify(`${e instanceof Error ? e.message : 'No se pudo abrir el pago.'}`)
      setBuying(null)
    }
  }

  const maxDay = useMemo(() => Math.max(1, ...(data?.report.days.map((d) => d.billedMicros) ?? [1])), [data])

  if (error && !data) {
    return (
      <>
        <ConfigPanelHeader title="Uso de IA" />
        <div className={`${card} text-[14px] text-red-700`} role="alert">{error}</div>
      </>
    )
  }
  if (!data) {
    return (
      <>
        <ConfigPanelHeader title="Uso de IA" />
        <div className="flex items-center gap-2 text-[14px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…
        </div>
      </>
    )
  }

  const d = data.decision
  const ivaPct = data.ivaBps / 100
  const viewingCurrent = data.viewPeriod === data.periodKey
  const capLabel = d.cap === 'limit' ? 'tu límite mensual' : 'tu crédito disponible'
  const capMicros = d.cap === 'limit' ? (d.limitMicros ?? 0) : d.creditMicros
  const pct = Math.min(100, Math.max(0, d.usedPct))
  // Only the inbox agent is paused by the allowance (Lane D); helpers for accounts without an agent are not.
  const agentPauses = data.enforce && data.agentEnabled && !data.exempt
  const creditLeft = Math.max(0, d.creditMicros - d.billedMicros)

  return (
    <div className="space-y-5">
      <ConfigPanelHeader
        title="Uso de IA"
        subtitle="Cuánto gasta la IA de tu negocio, cómo se calcula y hasta dónde puede llegar."
        actions={
          <select
            aria-label="Mes"
            className={`${auroraInputClass} w-auto`}
            value={data.viewPeriod}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {lastMonths(data.periodKey, 6).map((p) => (
              <option key={p} value={p}>
                {monthLabel(p)}
              </option>
            ))}
          </select>
        }
      />

      {error && (
        <div className={`${card} flex flex-wrap items-center justify-between gap-2 text-[14px] text-red-700`} role="alert">
          {error}
          <button type="button" className={auroraBtnSecondary} onClick={() => void load(period)}>
            Reintentar
          </button>
        </div>
      )}

      {!data.ready && (
        <div className={`${card} text-[14px] text-slate-600`}>
          Los créditos y límites de IA se activan pronto. Mientras tanto ves tu uso con la tarifa base.
        </div>
      )}

      {data.exempt ? (
        <div className={`${card} text-[14px] text-slate-600`}>Esta cuenta no tiene límite de IA.</div>
      ) : (
        d.alert > 0 && (
          <div
            role="status"
            className={`flex items-start gap-3 rounded-2xl border p-4 text-[14px] ${
              d.alert === 100 ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'
            }`}
          >
            {d.alert === 100 ? <PauseCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />}
            <p>
              {d.alert === 100
                ? agentPauses
                  ? `Llegaste al 100 % de ${capLabel}. Tu agente de IA está en pausa y tu equipo sigue atendiendo los chats.`
                  : `Llegaste al 100 % de ${capLabel}.`
                : `Ya usaste el ${Math.floor(d.usedPct)} % de ${capLabel} este mes.`}{' '}
              {data.agentEnabled && data.packs.length > 0 ? 'Podés recargar créditos abajo.' : d.cap === 'limit' ? 'Podés subir tu límite abajo.' : ''}
            </p>
          </div>
        )
      )}

      {/* Summary */}
      <section aria-label="Resumen del mes" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={card}>
          <p className="text-[12px] font-medium text-slate-500">Uso de {monthLabel(data.periodKey)}</p>
          <p className="mt-1 text-[26px] font-semibold tracking-tight text-slate-900">{money(d.billedMicros)}</p>
          <p className="text-[12px] text-slate-500">+ IVA · se renueva el {dateFmt.format(new Date(data.renewsAt))}</p>
        </div>
        <div className={card}>
          <p className="text-[12px] font-medium text-slate-500">Crédito que te queda</p>
          <p className="mt-1 text-[26px] font-semibold tracking-tight text-slate-900">{money(creditLeft)}</p>
          <p className="text-[12px] text-slate-500">
            de {money(d.creditMicros)}: {money(data.rate.freeMonthlyMicros)} gratis este mes
            {data.balanceMicros > 0 ? ` + ${money(data.balanceMicros)} prepago` : ''}
          </p>
        </div>
        <div className={card}>
          <p className="text-[12px] font-medium text-slate-500">Tu límite mensual</p>
          <p className="mt-1 text-[26px] font-semibold tracking-tight text-slate-900">{d.limitMicros !== null ? money(d.limitMicros) : 'Sin límite'}</p>
          <p className="text-[12px] text-slate-500">
            {data.ceilingMicros !== null ? `Máximo permitido: ${money(data.ceilingMicros)}` : 'Lo definís vos'}
          </p>
        </div>
      </section>

      {!data.exempt && (
        <div className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
            <span className="font-medium text-slate-700">
              {money(d.billedMicros)} de {money(capMicros)} ({capLabel})
            </span>
            <span className="text-slate-500">{Math.floor(d.usedPct)} %</span>
          </div>
          <div
            className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label="Uso del mes"
          >
            <div
              className={`h-full rounded-full ${d.alert === 100 ? 'bg-red-500' : d.alert === 80 ? 'bg-amber-500' : 'bg-indigo-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-2 text-[12px] text-slate-500">
            {agentPauses
              ? 'Si llegás al 100 %, tu agente de IA se pausa solo y tu equipo sigue atendiendo. Nunca se corta una respuesta a medias.'
              : 'Por ahora es informativo: la IA no se pausa por este tope.'}
          </p>
        </div>
      )}

      {/* The math */}
      <section aria-labelledby="ai-math" className={card}>
        <h2 id="ai-math" className="text-[15px] font-semibold text-slate-900">
          Cómo se calcula
        </h2>
        <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-[14px]">
          <dt className="text-slate-600">Costo del modelo (OpenAI) este mes</dt>
          <dd className="text-right font-medium tabular-nums text-slate-900">{money(data.listMicros)}</dd>
          <dt className="text-slate-600">Margen de Betsy</dt>
          <dd className="text-right font-medium tabular-nums text-slate-900">{formatMarkup(data.rate.markupBps)}</dd>
          <dt className="border-t border-slate-100 pt-2 text-slate-900">Uso del mes (antes de IVA)</dt>
          <dd className="border-t border-slate-100 pt-2 text-right font-semibold tabular-nums text-slate-900">{money(d.billedMicros)}</dd>
          <dt className="text-slate-600">Crédito gratis del mes</dt>
          <dd className="text-right tabular-nums text-slate-900">− {money(Math.min(d.billedMicros, data.rate.freeMonthlyMicros))}</dd>
        </dl>
        <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
          El IVA ({ivaPct} %) se cobra una sola vez, al comprar créditos. El asistente del equipo, las pruebas del agente y las
          plantillas de WhatsApp están incluidos y no gastan crédito.
          {data.nextRate &&
            ` Desde ${monthLabel(data.nextRate.periodKey)}: margen ${formatMarkup(data.nextRate.markupBps)} y ${money(data.nextRate.freeMonthlyMicros)} gratis por mes.`}
        </p>
      </section>

      {/* Credits / agent CTA + limit */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {data.agentEnabled ? (
          <section aria-labelledby="ai-packs" className={card}>
            <h2 id="ai-packs" className="text-[15px] font-semibold text-slate-900">
              Recargar créditos
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">Pagás con tarjeta por Tilopay. El crédito no vence.</p>
            {data.packs.length === 0 ? (
              <p className="mt-3 text-[13px] text-slate-500">Las recargas se activan pronto.</p>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {data.packs.map((p) => (
                  <button
                    key={p.packId}
                    type="button"
                    disabled={!data.canManage || buying !== null}
                    onClick={() => buy(p.packId)}
                    className="rounded-xl border border-slate-200 p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-60"
                  >
                    <span className="block text-[16px] font-semibold text-slate-900">{formatUsdCents(p.priceCents)}</span>
                    <span className="block text-[12px] text-slate-500">
                      + IVA = {formatUsdCents(p.totalCents)}
                    </span>
                    {buying === p.packId && <Loader2 className="mt-1 h-4 w-4 animate-spin text-indigo-500" aria-hidden />}
                  </button>
                ))}
              </div>
            )}
            {!data.canManage && <p className="mt-2 text-[12px] text-slate-500">Solo el dueño puede recargar.</p>}
          </section>
        ) : (
          <section aria-labelledby="ai-agent-cta" className={card}>
            <h2 id="ai-agent-cta" className="flex items-center gap-2 text-[15px] font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-indigo-500" aria-hidden /> ¿Querés un agente de ventas?
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Tu plan incluye {money(data.rate.freeMonthlyMicros)} de IA al mes para las funciones de ayuda. Para un agente que atienda tus
              chats, lo construimos con vos y pagás solo lo que usa.
            </p>
            <Link href="/config?tab=agentes" className={`${auroraBtnSecondary} mt-3`}>
              Quiero mi agente
            </Link>
          </section>
        )}

        {!data.exempt && (
          <section aria-labelledby="ai-limit" className={card}>
            <h2 id="ai-limit" className="text-[15px] font-semibold text-slate-900">
              Límite mensual
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">Un tope en dólares (antes de IVA) para no gastar más de lo que querés.</p>
            {data.canManage ? (
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  void saveLimit()
                }}
              >
                <label className="min-w-0 flex-1 basis-40">
                  <span className={auroraLabelClass}>Monto por mes (USD)</span>
                  <input
                    className={auroraInputClass}
                    inputMode="decimal"
                    placeholder="Sin límite"
                    value={limitInput}
                    onChange={(e) => setLimitInput(e.target.value)}
                  />
                </label>
                <button type="submit" className={auroraBtnPrimary} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Guardar
                </button>
                {data.ownLimitMicros !== null && (
                  <button type="button" className={auroraBtnSecondary} disabled={saving} onClick={() => saveLimit(true)}>
                    Quitar
                  </button>
                )}
              </form>
            ) : (
              <p className="mt-3 text-[13px] text-slate-500">Solo el dueño puede cambiar el límite.</p>
            )}
          </section>
        )}
      </div>

      {/* Daily */}
      <section aria-labelledby="ai-daily" className={card}>
        <h2 id="ai-daily" className="text-[15px] font-semibold text-slate-900">
          Por día · {monthLabel(data.viewPeriod)}
        </h2>
        {data.report.days.length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-500">Sin uso de IA {viewingCurrent ? 'este mes todavía' : 'ese mes'}.</p>
        ) : (
          <>
            <div className="mt-4 flex h-32 items-end gap-[2px]" aria-hidden>
              {data.report.days.map((day) => (
                <div
                  key={day.day}
                  title={`${day.day}: ${money(day.billedMicros)} + IVA (${day.events} usos)`}
                  className="flex-1 rounded-t-[4px] bg-indigo-500/80 hover:bg-indigo-600"
                  style={{ height: `${Math.max(2, (day.billedMicros / maxDay) * 100)}%` }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-slate-400" aria-hidden>
              <span>{data.report.days[0].day.slice(8)}</span>
              <span>{data.report.days[data.report.days.length - 1].day.slice(8)}</span>
            </div>
            <details className="mt-3 text-[13px]">
              <summary className="cursor-pointer text-slate-600">Ver tabla por día</summary>
              <table className="mt-2 w-full text-left">
                <thead className="text-[12px] text-slate-500">
                  <tr>
                    <th className="py-1 font-medium">Día</th>
                    <th className="py-1 text-right font-medium">Usos</th>
                    <th className="py-1 text-right font-medium">Uso (antes de IVA)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.report.days.map((day) => (
                    <tr key={day.day} className="border-t border-slate-100">
                      <td className="py-1.5">{day.day}</td>
                      <td className="py-1.5 text-right tabular-nums">{day.events}</td>
                      <td className="py-1.5 text-right tabular-nums">{money(day.billedMicros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>

      {/* By feature / agent */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section aria-labelledby="ai-by-feature" className={card}>
          <h2 id="ai-by-feature" className="text-[15px] font-semibold text-slate-900">
            Por función
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 text-[13px]">
            {data.report.byFeature.length === 0 && <li className="py-2 text-slate-500">Sin uso.</li>}
            {data.report.byFeature.map((f) => (
              <li key={f.feature} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-slate-700">
                  {f.label} <span className="text-slate-400">· {f.events}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-900">{f.billable ? money(f.billedMicros) : <span className="text-emerald-700">Incluido</span>}</span>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="ai-by-agent" className={card}>
          <h2 id="ai-by-agent" className="text-[15px] font-semibold text-slate-900">
            Por agente
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 text-[13px]">
            {data.report.byAgent.length === 0 && <li className="py-2 text-slate-500">Ningún agente gastó crédito.</li>}
            {data.report.byAgent.map((a) => (
              <li key={a.agentId} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-slate-700">
                  {data.agentNames[a.agentId] ?? 'Agente'} <span className="text-slate-400">· {a.events}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-900">{money(a.billedMicros)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {(data.ledger.some((l) => l.amountMicros !== 0) || data.purchases.some((p) => p.status === 'pending' || p.status === 'failed')) && (
        <section aria-labelledby="ai-moves" className={card}>
          <h2 id="ai-moves" className="text-[15px] font-semibold text-slate-900">
            Movimientos del saldo
          </h2>
          <ul className="mt-2 divide-y divide-slate-100 text-[13px]">
            {data.purchases
              .filter((p) => p.status === 'pending' || p.status === 'failed')
              .map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-slate-700">
                    Compra {formatUsdCents(p.totalCents)} · {p.status === 'pending' ? 'esperando pago' : 'no se completó'}
                  </span>
                  <span className="text-slate-400">{dateFmt.format(new Date(p.createdAt))}</span>
                </li>
              ))}
            {data.ledger.filter((l) => l.amountMicros !== 0).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-slate-700">
                  {KIND_LABEL[l.kind] ?? l.kind}
                  {l.periodKey ? ` · ${monthLabel(l.periodKey)}` : ''}
                </span>
                <span className={`shrink-0 tabular-nums ${l.amountMicros >= 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                  {l.amountMicros >= 0 ? '+' : ''}
                  {money(l.amountMicros)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
