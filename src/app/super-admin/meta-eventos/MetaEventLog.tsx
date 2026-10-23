'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

type Row = {
  id: string
  tenantId: string
  tenantName: string | null
  channel: string
  status: string
  isTest: boolean
  eventName: string
  eventTime: string
  value: string | null
  currency: string | null
  orderId: string | null
  orderNumber: string | null
  conversationId: string | null
  adId: string | null
  adHeadline: string | null
  adClickedAt: string | null
  attempts: number
  createdAt: string
  sentAt: string | null
  fbtraceId: string | null
  lastErrorCode: string | null
  lastErrorAt: string | null
}

const STATUS: Record<string, { label: string; tone: string }> = {
  sent: { label: 'Enviado', tone: 'bg-emerald-50 text-emerald-700' },
  pending: { label: 'En cola', tone: 'bg-slate-100 text-slate-700' },
  processing: { label: 'Enviando', tone: 'bg-sky-50 text-sky-700' },
  failed: { label: 'Falló', tone: 'bg-red-50 text-red-700' },
  skipped: { label: 'Omitido', tone: 'bg-amber-50 text-amber-800' },
  expired: { label: 'Vencido', tone: 'bg-amber-50 text-amber-800' },
}

const fmt = new Intl.DateTimeFormat('es-CR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Costa_Rica' })
const when = (iso: string | null) => (iso ? fmt.format(new Date(iso)) : '—')

/** Super-admin: every Purchase event Betsy queued for Meta, newest first (read-only). */
export default function MetaEventLog() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (status) qs.set('status', status)
      if (channel) qs.set('channel', channel)
      const res = await fetch(`/api/super-admin/meta-events?${qs}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean
        data?: { rows: Row[]; tablesMissing: boolean }
        error?: string
      }
      if (!json.success || !json.data) throw new Error(json.error || 'No se pudo cargar')
      setRows(json.data.rows)
      setMissing(json.data.tablesMissing)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar')
    } finally {
      setLoading(false)
    }
  }, [status, channel])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4" data-testid="meta-event-log">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg px-2.5 py-1.5 ring-1 ring-slate-200"
          aria-label="Estado"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="rounded-lg px-2.5 py-1.5 ring-1 ring-slate-200"
          aria-label="Canal"
        >
          <option value="">WhatsApp e Instagram</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
        </select>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Actualizar
        </button>
        <span className="text-slate-500">Betsy envía cada 5 minutos · últimos 200</span>
      </div>

      {error ? <p className="text-[13px] text-red-700">{error}</p> : null}
      {missing ? <p className="text-[13px] text-amber-800">Las tablas de eventos todavía no existen en esta base.</p> : null}
      {rows && rows.length === 0 && !missing ? <p className="text-[13px] text-slate-500">Todavía no hay eventos.</p> : null}

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-slate-200/70">
          <table className="min-w-full text-[12.5px]">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Negocio</th>
                <th className="px-3 py-2">Canal</th>
                <th className="px-3 py-2">Anuncio (clic)</th>
                <th className="px-3 py-2">Pedido</th>
                <th className="px-3 py-2">Monto</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Enviado</th>
                <th className="px-3 py-2">fbtrace_id (soporte Meta)</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.status] ?? { label: r.status, tone: 'bg-slate-100 text-slate-700' }
                return (
                  <tr key={r.id} className="border-t border-slate-100 align-top" data-testid="meta-event-row">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{r.tenantName || '—'}</div>
                      <div className="text-[11px] text-slate-400">{r.tenantId}</div>
                    </td>
                    <td className="px-3 py-2 capitalize">{r.channel}</td>
                    <td className="px-3 py-2">
                      <div className="max-w-[220px] truncate" title={r.adHeadline || undefined}>
                        {r.adHeadline || (r.adId ? `Anuncio ${r.adId}` : '—')}
                      </div>
                      <div className="text-[11px] text-slate-400">{when(r.adClickedAt)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{r.orderNumber ? `#${r.orderNumber}` : '—'}</div>
                      <div className="text-[11px] text-slate-400">{when(r.eventTime)}</div>
                      {r.conversationId ? <div className="text-[11px] text-slate-400">chat …{r.conversationId.slice(-8)}</div> : null}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.value ?? '—'} {r.currency ?? ''}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.tone}`}>{st.label}</span>
                      {r.isTest ? (
                        <span className="ml-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">prueba</span>
                      ) : null}
                      <div className="mt-0.5 text-[11px] text-slate-400">{r.attempts} intento(s)</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{when(r.sentAt)}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{r.fbtraceId || '—'}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-600">
                      {r.lastErrorCode ? `${r.lastErrorCode} · ${when(r.lastErrorAt)}` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
