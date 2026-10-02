'use client'

import { useCallback, useEffect, useState } from 'react'
import { Megaphone, RefreshCw } from 'lucide-react'

type Line = { id: string; name: string; status: string; checkedAt: string | null }
type Data = {
  enabled: boolean
  acknowledgedAt: string | null
  testEventCode: string | null
  testEventCodeExpiresAt: string | null
  currency: 'CRC' | 'USD' | null
  serverReady: boolean
  sentLast30Days: number
  lines: Line[]
}

const LINE_STATUS: Record<string, { label: string; tone: string }> = {
  ready: { label: 'Listo', tone: 'bg-emerald-50 text-emerald-700' },
  missing_permission: { label: 'Falta permiso: reconectá WhatsApp', tone: 'bg-amber-50 text-amber-800' },
  token_invalid: { label: 'Reconectar WhatsApp', tone: 'bg-red-50 text-red-700' },
  error: { label: 'No se pudo verificar', tone: 'bg-slate-100 text-slate-600' },
  unknown: { label: 'Sin verificar', tone: 'bg-slate-100 text-slate-600' },
}

/**
 * Config › Cuentas conectadas: report paid ad sales to the business's own Meta ad account.
 * Off by default; turning it on needs the notice accepted. Never changes how WhatsApp works.
 */
export function MetaSalesAttributionCard() {
  const [data, setData] = useState<Data | null>(null)
  const [hidden, setHidden] = useState(false)
  const [ack, setAck] = useState(false)
  const [testCode, setTestCode] = useState('')
  const [busy, setBusy] = useState<null | 'save' | 'verify'>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/config/meta-attribution', { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      if (res.status === 403 || res.status === 401) {
        setHidden(true)
        return
      }
      const json = (await res.json()) as { success?: boolean; data?: Data }
      if (json.success && json.data) setData(json.data)
    } catch {
      /* optional card */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function put(body: Record<string, unknown>, kind: 'save' | 'verify') {
    setBusy(kind)
    setMessage(null)
    try {
      const res = await fetch('/api/config/meta-attribution', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      })
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: Data; error?: string }
      if (json.success && json.data) {
        setData(json.data)
        setMessage(kind === 'verify' ? 'Verificación lista.' : 'Guardado.')
      } else {
        setMessage(json.error || 'No se pudo guardar.')
      }
    } catch {
      setMessage('No se pudo conectar. Intentá de nuevo.')
    } finally {
      setBusy(null)
    }
  }

  if (hidden || !data) return null
  const needsAck = !data.acknowledgedAt

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-5" data-testid="meta-sales-attribution">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
          <Megaphone className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-900">Ventas por anuncios (Meta)</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
            Cuando un cliente llega por un anuncio de WhatsApp y su pedido queda <strong>pagado</strong>, Betsy le avisa a
            tu cuenta de anuncios de Meta. Así Meta puede optimizar tus anuncios para ventas reales. No cambia nada de
            cómo funciona tu WhatsApp.
          </p>
        </div>
        <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#5B6CFF]"
            checked={data.enabled}
            disabled={busy !== null || (!data.enabled && needsAck && !ack)}
            onChange={(e) => void put({ action: 'save', enabled: e.target.checked, acknowledge: ack }, 'save')}
            data-testid="meta-sales-toggle"
          />
          {data.enabled ? 'Activado' : 'Desactivado'}
        </label>
      </div>

      {!data.enabled && needsAck ? (
        <label className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-[12px] text-slate-600">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#5B6CFF]" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="meta-sales-ack" />
          <span>
            Entiendo que Betsy enviará a Meta, en nombre de mi negocio, el identificador del clic del anuncio y el monto de
            las ventas pagadas (sin nombres ni teléfonos), y que informo a mis clientes según mi aviso de privacidad.
          </span>
        </label>
      ) : null}

      <div className="mt-4 space-y-2">
        {data.lines.length === 0 ? (
          <p className="text-[12px] text-slate-500">Conectá una línea de WhatsApp para usarlo.</p>
        ) : (
          data.lines.map((line) => {
            const st = LINE_STATUS[line.status] ?? LINE_STATUS.unknown
            return (
              <div key={line.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="truncate text-slate-700">{line.name}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.tone}`}>{st.label}</span>
              </div>
            )
          })
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-slate-500">
        <button
          type="button"
          onClick={() => void put({ action: 'verify' }, 'verify')}
          disabled={busy !== null || data.lines.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy === 'verify' ? 'animate-spin' : ''}`} aria-hidden /> Verificar con Meta
        </button>
        <span>Moneda: {data.currency ?? 'no compatible (solo colones o dólares)'}</span>
        {data.enabled ? <span>Ventas enviadas (30 días): {data.sentLast30Days}</span> : null}
        {data.enabled && !data.serverReady ? <span className="text-amber-700">Activación en curso por Betsy.</span> : null}
      </div>

      {data.enabled ? (
        <details className="mt-3 text-[12px] text-slate-500">
          <summary className="cursor-pointer">Modo de prueba (Events Manager)</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              value={testCode}
              onChange={(e) => setTestCode(e.target.value)}
              placeholder={data.testEventCode ?? 'TEST12345'}
              className="w-40 rounded-lg px-2.5 py-1.5 text-[12px] ring-1 ring-slate-200"
            />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void put({ action: 'save', enabled: true, acknowledge: false, testEventCode: testCode.trim() || null }, 'save')}
              className="rounded-lg px-2.5 py-1.5 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
            >
              Guardar
            </button>
            {data.testEventCodeExpiresAt ? <span>Vence: {new Date(data.testEventCodeExpiresAt).toLocaleString('es-CR')}</span> : null}
          </div>
        </details>
      ) : null}

      {message ? <p className="mt-3 text-[12px] text-slate-600">{message}</p> : null}
    </section>
  )
}
