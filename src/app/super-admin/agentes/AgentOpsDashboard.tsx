'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import KillSwitchPanel from '@/app/super-admin/agentes/KillSwitchPanel'

type Bucket = {
  turns: number
  delivered: number
  suggested: number
  skipped: number
  fallback: number
  failed: number
  budgetBlocked: number
  windowClosed: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  costUsd: number
}

type Totals = Bucket & { fallbackRate: number; failureRate: number; p95LatencyMs: number | null }

type Payload = {
  days: number
  mode: 'live' | 'test' | 'all'
  disclaimer: string
  pricingVersions: string[]
  truncated: boolean
  tenantNames: Record<string, string>
  agentNames: Record<string, { name: string; status: string; version: number }>
  summary: {
    totals: Totals
    byModel: Array<{ model: string } & Bucket>
    byTenant: Array<{ tenantId: string } & Bucket>
    byAgent: Array<{ agentId: string; tenantId: string; model: string } & Bucket>
    byDay: Array<{ day: string } & Bucket>
  }
}

const DAY_OPTIONS = [7, 30, 90] as const
const MODES = [
  { key: 'live', label: 'Reales' },
  { key: 'test', label: 'Probar' },
  { key: 'all', label: 'Todo' },
] as const

const nf = new Intl.NumberFormat('es-CR')
const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const usd = (n: number) => `$${n < 1 ? n.toFixed(4) : n.toFixed(2)}`

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-[12px] text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  )
}

function Table({
  title,
  rows,
}: {
  title: string
  rows: Array<{ key: string; label: string; b: Bucket }>
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <h3 className="border-b border-slate-100 px-4 py-3 text-[14px] font-semibold text-slate-900">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-slate-500">Sin datos en este período.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Nombre</th>
                <th className="px-2 py-2 text-right">Turnos</th>
                <th className="px-2 py-2 text-right">Enviados</th>
                <th className="px-2 py-2 text-right">Sugeridos</th>
                <th className="px-2 py-2 text-right">A humano</th>
                <th className="px-2 py-2 text-right">Fallidos</th>
                <th className="px-2 py-2 text-right">Tokens</th>
                <th className="px-4 py-2 text-right">Costo est.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, label, b }) => (
                <tr key={key} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-900">{label}</td>
                  <td className="px-2 py-2 text-right">{nf.format(b.turns)}</td>
                  <td className="px-2 py-2 text-right">{nf.format(b.delivered)}</td>
                  <td className="px-2 py-2 text-right">{nf.format(b.suggested)}</td>
                  <td className="px-2 py-2 text-right">{nf.format(b.skipped + b.fallback)}</td>
                  <td className="px-2 py-2 text-right">{nf.format(b.failed)}</td>
                  <td className="px-2 py-2 text-right">
                    {nf.format(b.inputTokens + b.outputTokens)}
                  </td>
                  <td className="px-4 py-2 text-right">{usd(b.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Platform view of INBOX agent usage. Platform admins only; costs are estimates. */
export default function AgentOpsDashboard() {
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(30)
  const [mode, setMode] = useState<(typeof MODES)[number]['key']>('live')
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/super-admin/agent-usage?days=${days}&mode=${mode}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(45_000),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as Payload)
    } catch {
      setError('No se pudo cargar. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }, [days, mode])

  useEffect(() => {
    void load()
  }, [load])

  const t = data?.summary.totals
  return (
    <div className="space-y-4">
      <KillSwitchPanel />
      <div className="flex flex-wrap items-center gap-2">
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`rounded-lg px-3 py-1.5 text-[13px] ring-1 ${
              days === d ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200'
            }`}
          >
            {d} días
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200" />
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={`rounded-lg px-3 py-1.5 text-[13px] ring-1 ${
              mode === m.key ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200'
            }`}
          >
            {m.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[13px] text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </div>

      {error ? <p className="text-[13px] text-red-700">{error}</p> : null}

      {data && t ? (
        <>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 ring-1 ring-amber-200">
            {data.disclaimer} Versiones de tarifa: {data.pricingVersions.join(', ')}.
            {data.truncated ? ' Resultado recortado: acortá el período.' : ''}
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Turnos" value={nf.format(t.turns)} />
            <Tile label="Respuestas enviadas" value={nf.format(t.delivered)} />
            <Tile label="Sugerencias" value={nf.format(t.suggested)} />
            <Tile label="Costo estimado" value={usd(t.costUsd)} hint="Precio de lista" />
            <Tile label="Cayó a humano (fallback)" value={pct(t.fallbackRate)} />
            <Tile label="Fallidos" value={pct(t.failureRate)} />
            <Tile
              label="Latencia p95"
              value={t.p95LatencyMs === null ? '—' : `${(t.p95LatencyMs / 1000).toFixed(1)} s`}
            />
            <Tile
              label="Tokens"
              value={nf.format(t.inputTokens + t.outputTokens)}
              hint={`${nf.format(t.cachedInputTokens)} en caché`}
            />
          </div>

          <Table
            title="Por modelo"
            rows={data.summary.byModel.map((b) => ({ key: b.model, label: b.model, b }))}
          />
          <Table
            title="Por negocio"
            rows={data.summary.byTenant.map((b) => ({
              key: b.tenantId,
              label: data.tenantNames[b.tenantId] || b.tenantId,
              b,
            }))}
          />
          <Table
            title="Por agente"
            rows={data.summary.byAgent.map((b) => {
              const info = data.agentNames[b.agentId]
              return {
                key: `${b.agentId}:${b.model}`,
                label: `${info?.name || b.agentId} · ${b.model}${info ? ` · v${info.version}` : ''}`,
                b,
              }
            })}
          />
          <Table
            title="Por día"
            rows={data.summary.byDay.map((b) => ({ key: b.day, label: b.day, b }))}
          />
        </>
      ) : loading ? (
        <p className="text-[13px] text-slate-500">Cargando…</p>
      ) : null}
    </div>
  )
}
