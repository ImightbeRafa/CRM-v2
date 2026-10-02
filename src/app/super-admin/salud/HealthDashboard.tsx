'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Database, RefreshCw } from 'lucide-react'

type ErrorGroup = {
  id: string
  source: string
  route: string | null
  name: string
  message: string
  stack: string | null
  count: number
  firstSeen: string
  lastSeen: string
  status: string
}

type Health = {
  backup: { status: string; fullHoursAgo: number | null; hotHoursAgo: number | null; recommendations: Array<{ type: string; message: string }> }
  errors: { groups: ErrorGroup[]; tableReady: boolean }
}

const FILTERS = [
  { key: 'open', label: 'Abiertos' },
  { key: 'muted', label: 'Silenciados' },
  { key: 'resolved', label: 'Resueltos' },
  { key: 'all', label: 'Todos' },
] as const

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 90) return 'hace 1 min'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return `hace ${Math.round(s / 86400)} d`
}

/** Backups + grouped errors (server and browser) for Betsy platform admins. */
export default function HealthDashboard() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('open')
  const [source, setSource] = useState<'server' | 'client' | 'all'>('server')
  const [data, setData] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/super-admin/health?status=${filter}&source=${source}`, { cache: 'no-store', signal: AbortSignal.timeout(45_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData((await res.json()) as Health)
    } catch {
      setError('No se pudo cargar. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }, [filter, source])

  useEffect(() => {
    void load()
  }, [load])

  async function setStatus(id: string, status: 'open' | 'muted' | 'resolved') {
    const res = await fetch(`/api/super-admin/errors/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) void load()
  }

  const backupOk = data?.backup.status === 'healthy'

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="health-dashboard">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Errores agrupados de servidor y navegador. Detalle completo en Cloudflare → Workers Logs.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Actualizar
        </button>
      </div>

      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {data ? (
        <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200" data-testid="health-backup">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-slate-500" aria-hidden />
            <h2 className="text-sm font-semibold text-slate-900">Respaldos</h2>
            <span
              className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                backupOk ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {backupOk ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
              {data.backup.status}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            Completo: {data.backup.fullHoursAgo === null ? '—' : `hace ${data.backup.fullHoursAgo} h`} · Parcial:{' '}
            {data.backup.hotHoursAgo === null ? '—' : `hace ${data.backup.hotHoursAgo} h`} ·{' '}
            <Link href="/backups" className="font-medium text-indigo-600 hover:underline">
              Ver detalle
            </Link>
          </p>
          {data.backup.recommendations.map((r, i) => (
            <p key={i} className="mt-1 text-xs text-red-700">
              {r.message}
            </p>
          ))}
        </section>
      ) : null}

      <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200" data-testid="health-errors">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Errores</h2>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as 'server' | 'client' | 'all')}
            className="rounded-lg px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200"
            aria-label="Origen"
          >
            <option value="server">Servidor</option>
            <option value="client">Navegador</option>
            <option value="all">Todos</option>
          </select>
          <div className="ml-auto flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-lg px-2.5 py-1 text-xs ${filter === f.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {data && !data.errors.tableReady ? (
          <p className="mt-3 text-sm text-amber-700">
            La tabla de errores todavía no existe (aplicar SQL 040). Mientras tanto, los errores están en Workers Logs.
          </p>
        ) : null}
        {data && data.errors.tableReady && data.errors.groups.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Sin errores en esta vista.</p>
        ) : null}
        <ul className="mt-3 divide-y divide-slate-100">
          {data?.errors.groups.map((g) => (
            <li key={g.id} className="py-2.5">
              <button type="button" onClick={() => setOpen(open === g.id ? null : g.id)} className="w-full text-left">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600">{g.source}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {g.name}: {g.message}
                    </p>
                    <p className="text-xs text-slate-500">
                      {g.route ?? '—'} · {g.count}× · último {ago(g.lastSeen)} · primero {ago(g.firstSeen)}
                    </p>
                  </div>
                </div>
              </button>
              {open === g.id ? (
                <div className="mt-2 space-y-2 pl-8">
                  {g.stack ? <pre className="max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-700">{g.stack}</pre> : null}
                  <div className="flex gap-2">
                    {g.status !== 'resolved' ? (
                      <button type="button" onClick={() => void setStatus(g.id, 'resolved')} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white">
                        Marcar resuelto
                      </button>
                    ) : null}
                    {g.status !== 'muted' ? (
                      <button type="button" onClick={() => void setStatus(g.id, 'muted')} className="rounded-lg px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                        Silenciar
                      </button>
                    ) : null}
                    {g.status !== 'open' ? (
                      <button type="button" onClick={() => void setStatus(g.id, 'open')} className="rounded-lg px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
                        Reabrir
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
