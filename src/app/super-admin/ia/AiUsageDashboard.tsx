'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Bucket = {
  calls: number
  errors: number
  inputTokens: number
  cachedTokens: number
  outputTokens: number
  audioSeconds: number
  costMicros: number
}
type Budget = { scope: string; monthlyUsdMicros: number; autoPause: boolean; alertedMonth: string | null; alertedPct: number }
type Payload = {
  days: number
  disclaimer: string
  pricingVersion: string
  featureLabels: Record<string, string>
  headline: { todayMicros: number; d7Micros: number; d30Micros: number; mtdMicros: number; projectedMonthMicros: number } | null
  tenants: Array<{ id: string; name: string }>
  budgets: { available: boolean; budgets: Budget[] }
  data:
    | { available: false }
    | {
        available: true
        totals: Bucket & { conversations: number }
        latency: { p50: number | null; p95: number | null }
        byDay: { feature: Array<{ day: string; key: string } & Bucket>; model: Array<{ day: string; key: string } & Bucket> }
        byTenant: Array<{ tenantId: string | null; name: string; conversations: number } & Bucket>
        byModel: Array<{ model: string; provider: string; p95: number | null } & Bucket>
        byFeature: Array<{ feature: string; label: string } & Bucket>
        byAgent: Array<{ agentId: string; name: string; tenantName: string; conversations: number } & Bucket>
        topConversations: Array<{ conversationId: string; tenantName: string } & Bucket>
        errors: Array<{ at: string; tenantName: string; feature: string; model: string; errorCode: string | null; latencyMs: number | null }>
      }
}

const nf = new Intl.NumberFormat('es-CR')
const usd = (micros: number) => {
  const v = micros / 1e6
  return `US$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`
}
const ms = (v: number | null) => (v == null ? '—' : `${(v / 1000).toFixed(1)} s`)
const SERIES_COLORS = ['#5B6CFF', '#16A34A', '#F59E0B', '#DC2626', '#0EA5E9', '#9333EA', '#64748B', '#DB2777', '#0D9488', '#A16207']

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[12px] text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  )
}

function UsageTable({
  title,
  rows,
  showChats,
}: {
  title: string
  rows: Array<{ key: string; label: string; sub?: string; b: Bucket; chats?: number }>
  showChats?: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-4 py-3 text-[14px] font-semibold text-slate-900">{title}</h3>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">Sin datos en este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium"> </th>
                <th className="px-3 py-2 text-right font-medium">Llamadas</th>
                <th className="px-3 py-2 text-right font-medium">Errores</th>
                <th className="px-3 py-2 text-right font-medium">Tokens (ent / caché / sal)</th>
                {showChats ? <th className="px-3 py-2 text-right font-medium">Chats · costo por chat</th> : null}
                <th className="px-4 py-2 text-right font-medium">Costo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-900">
                    {r.label}
                    {r.sub ? <span className="block text-[11px] text-slate-500">{r.sub}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-700">{nf.format(r.b.calls)}</td>
                  <td className="px-3 py-2 text-right text-slate-700">{r.b.errors ? nf.format(r.b.errors) : '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-700">
                    {r.b.audioSeconds > 0 && r.b.inputTokens === 0
                      ? `${nf.format(Math.round(r.b.audioSeconds / 60))} min audio`
                      : `${nf.format(r.b.inputTokens)} / ${nf.format(r.b.cachedTokens)} / ${nf.format(r.b.outputTokens)}`}
                  </td>
                  {showChats ? (
                    <td className="px-3 py-2 text-right text-slate-700">
                      {r.chats ? `${nf.format(r.chats)} · ${usd(Math.round(r.b.costMicros / r.chats))}` : '—'}
                    </td>
                  ) : null}
                  <td className="px-4 py-2 text-right font-medium text-slate-900">{usd(r.b.costMicros)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function BudgetEditor({
  tenants,
  budgets,
  onSaved,
}: {
  tenants: Array<{ id: string; name: string }>
  budgets: Budget[]
  onSaved: () => void
}) {
  const [scope, setScope] = useState('global')
  const [amount, setAmount] = useState('')
  const [autoPause, setAutoPause] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const name = (s: string) => (s === 'global' ? 'Toda la plataforma' : tenants.find((t) => t.id === s)?.name || s)

  async function save(monthlyUsd: number | null, forScope = scope, pause = autoPause) {
    setMsg(null)
    if (monthlyUsd !== null && !(Number.isFinite(monthlyUsd) && monthlyUsd > 0)) {
      setMsg('Escribí un monto válido en dólares (por ejemplo 25 o 12.50).')
      return
    }
    const res =
      monthlyUsd === null
        ? await fetch(`/api/super-admin/ai-usage?scope=${encodeURIComponent(forScope)}`, { method: 'DELETE' })
        : await fetch('/api/super-admin/ai-usage', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope: forScope, monthlyUsd, autoPause: pause }),
          })
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) setMsg(json.error || 'No se pudo guardar.')
    else {
      setAmount('')
      onSaved()
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-[14px] font-semibold text-slate-900">Presupuestos del mes</h3>
      <p className="mt-0.5 text-[12px] text-slate-500">
        Te avisamos (correo y campanita) al 80% y al 100%. Con “pausar”, los agentes de ese negocio se detienen al 100% y
        su equipo recibe un aviso para atender a mano. La pausa sigue hasta que la quites en Agent Ops. Meses en hora de
        Costa Rica.
      </p>
      {budgets.length ? (
        <ul className="mt-3 space-y-1 text-[13px]">
          {budgets.map((b) => (
            <li key={b.scope} className="flex items-center justify-between gap-2">
              <span className="text-slate-800">
                {name(b.scope)} · {usd(b.monthlyUsdMicros)}/mes{b.autoPause ? ' · pausa al 100%' : ''}
              </span>
              <button type="button" className="text-[12px] text-red-700 hover:underline" onClick={() => void save(null, b.scope, false)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-900"
          aria-label="Alcance del presupuesto"
        >
          <option value="global">Toda la plataforma</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="US$ por mes"
          inputMode="decimal"
          aria-label="Monto mensual en dólares"
          className="w-32 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-900"
        />
        {scope !== 'global' ? (
          <label className="flex items-center gap-1 text-[12.5px] text-slate-700">
            <input type="checkbox" checked={autoPause} onChange={(e) => setAutoPause(e.target.checked)} /> pausar al 100%
          </label>
        ) : null}
        <button
          type="button"
          disabled={!amount}
          onClick={() => void save(Number(amount))}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
        >
          Guardar
        </button>
      </div>
      {msg ? <p className="mt-2 text-[12px] text-red-700">{msg}</p> : null}
    </div>
  )
}

export default function AiUsageDashboard() {
  const [days, setDays] = useState(30)
  const [tenantId, setTenantId] = useState('')
  const [feature, setFeature] = useState('')
  const [model, setModel] = useState('')
  const [stackBy, setStackBy] = useState<'feature' | 'model'>('feature')
  const [metric, setMetric] = useState<'cost' | 'calls'>('cost')
  const [payload, setPayload] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams({ days: String(days) })
    if (tenantId) p.set('tenantId', tenantId)
    if (feature) p.set('feature', feature)
    if (model) p.set('model', model)
    return p.toString()
  }, [days, tenantId, feature, model])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/super-admin/ai-usage?${query}`, { cache: 'no-store' })
      const json = (await res.json()) as Payload & { error?: string }
      if (!res.ok) throw new Error(json.error || 'Error al cargar')
      setPayload(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    void load()
  }, [load])

  const data = payload?.data && payload.data.available ? payload.data : null
  const series = useMemo(() => {
    if (!data) return { rows: [] as Array<Record<string, number | string>>, keys: [] as string[] }
    const src = stackBy === 'feature' ? data.byDay.feature : data.byDay.model
    const keys = [...new Set(src.map((r) => r.key))]
    const byDay = new Map<string, Record<string, number | string>>()
    for (const r of src) {
      const row = byDay.get(r.day) || { day: r.day.slice(5) }
      row[r.key] = metric === 'cost' ? Number(((r.costMicros as number) / 1e6).toFixed(4)) : r.calls
      byDay.set(r.day, row)
    }
    return { rows: [...byDay.values()], keys }
  }, [data, stackBy, metric])
  const label = (k: string) => (stackBy === 'feature' ? payload?.featureLabels[k] || k : k)

  return (
    <div className="space-y-4" data-testid="ai-usage-dashboard">
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`rounded-full px-3 py-1.5 text-[12.5px] ring-1 ${days === d ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200'}`}
          >
            {d} días
          </button>
        ))}
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label="Negocio" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-900">
          <option value="">Todos los negocios</option>
          {(payload?.tenants || []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={feature} onChange={(e) => setFeature(e.target.value)} aria-label="Función" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-900">
          <option value="">Todas las funciones</option>
          {Object.entries(payload?.featureLabels || {}).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select value={model} onChange={(e) => setModel(e.target.value)} aria-label="Modelo" className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[13px] text-slate-900">
          <option value="">Todos los modelos</option>
          {(data?.byModel || []).map((m) => (
            <option key={m.model} value={m.model}>
              {m.model}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[12.5px] text-slate-800 ring-1 ring-slate-200">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
        <a href={`/api/super-admin/ai-usage?${query}&format=csv`} className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[12.5px] text-slate-800 ring-1 ring-slate-200">
          <Download className="h-3.5 w-3.5" /> CSV
        </a>
      </div>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-800">{error}</p> : null}
      {payload && !payload.data.available ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          El medidor de IA todavía no está activo (falta aplicar la tabla de uso). Los datos aparecen desde que se activa.
        </p>
      ) : null}

      {payload?.headline ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Hoy · toda la plataforma" value={usd(payload.headline.todayMicros)} />
          <Tile label="Últimos 7 días" value={usd(payload.headline.d7Micros)} />
          <Tile label="Últimos 30 días" value={usd(payload.headline.d30Micros)} />
          <Tile label="Este mes · toda la plataforma" value={usd(payload.headline.mtdMicros)} />
          <Tile label="Proyección fin de mes" value={usd(payload.headline.projectedMonthMicros)} hint="Al ritmo actual" />
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label={`Llamadas (${days} días)`} value={nf.format(data.totals.calls)} />
            <Tile
              label="Errores"
              value={data.totals.calls ? `${((data.totals.errors / data.totals.calls) * 100).toFixed(1)}%` : '—'}
              hint={`${nf.format(data.totals.errors)} llamadas`}
            />
            <Tile label="Velocidad (mediana)" value={ms(data.latency.p50)} hint={`El 95% en menos de ${ms(data.latency.p95)}`} />
            <Tile label={`Costo (${days} días)`} value={usd(data.totals.costMicros)} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[14px] font-semibold text-slate-900">{metric === 'cost' ? 'Costo por día (US$)' : 'Llamadas por día'}</h3>
              <div className="flex gap-1">
                {(['cost', 'calls'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setMetric(k)}
                    className={`rounded-full px-2.5 py-1 text-[12px] ring-1 ${metric === k ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200'}`}
                  >
                    {k === 'cost' ? 'Costo' : 'Llamadas'}
                  </button>
                ))}
                {(['feature', 'model'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setStackBy(k)}
                    className={`rounded-full px-2.5 py-1 text-[12px] ring-1 ${stackBy === k ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200'}`}
                  >
                    {k === 'feature' ? 'Por función' : 'Por modelo'}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 h-64">
              {series.rows.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series.rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="day" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip formatter={(v: number, k: string) => [metric === 'cost' ? `US${Number(v).toFixed(4)}` : nf.format(Number(v)), label(k)]} />
                    <Legend formatter={(k: string) => label(k)} wrapperStyle={{ fontSize: 12 }} />
                    {series.keys.map((k, i) => (
                      <Area
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stackId="1"
                        stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                        fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                        fillOpacity={0.35}
                      />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-[13px] text-slate-500">Sin datos en este período.</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <UsageTable title="Por negocio" showChats rows={data.byTenant.map((r) => ({ key: r.tenantId || 'none', label: r.name, b: r, chats: r.conversations }))} />
            <UsageTable title="Por función" rows={data.byFeature.map((r) => ({ key: r.feature, label: r.label, b: r }))} />
            <UsageTable
              title="Por modelo"
              rows={data.byModel.map((r) => ({ key: r.model, label: r.model, sub: `${r.provider} · 95% < ${ms(r.p95)}`, b: r }))}
            />
            <UsageTable title="Por agente" showChats rows={data.byAgent.map((r) => ({ key: r.agentId, label: r.name, sub: r.tenantName, b: r, chats: r.conversations }))} />
            <UsageTable
              title="Chats más caros"
              rows={data.topConversations.map((r) => ({ key: r.conversationId, label: `Chat …${r.conversationId.slice(-6)}`, sub: r.tenantName, b: r }))}
            />
            <div className="rounded-xl border border-slate-200 bg-white">
              <h3 className="border-b border-slate-100 px-4 py-3 text-[14px] font-semibold text-slate-900">Errores recientes</h3>
              {data.errors.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-slate-500">Sin errores en este período.</p>
              ) : (
                <ul className="max-h-72 overflow-y-auto text-[12.5px]">
                  {data.errors.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="border-t border-slate-100 px-4 py-2 text-slate-800">
                      {new Date(e.at).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' })} · {e.tenantName} · {e.feature}
                      <span className="block text-[11px] text-slate-500">
                        {e.model} · {e.errorCode || 'error'} · {ms(e.latencyMs)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      ) : null}

      {payload?.budgets.available ? (
        <BudgetEditor tenants={payload.tenants} budgets={payload.budgets.budgets} onSaved={() => void load()} />
      ) : payload ? (
        <p className="text-[12px] text-slate-500">Los presupuestos se activan con la próxima actualización.</p>
      ) : null}

      {payload ? (
        <p className="text-[11px] text-slate-500">
          {payload.disclaimer} Precios: {payload.pricingVersion}.
        </p>
      ) : null}
    </div>
  )
}
