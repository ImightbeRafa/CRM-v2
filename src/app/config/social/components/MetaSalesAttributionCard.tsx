'use client'

import { useCallback, useEffect, useState } from 'react'
import { Megaphone, RefreshCw } from 'lucide-react'

type Line = { id: string; platform: 'whatsapp' | 'instagram'; name: string; status: string; checkedAt: string | null }
type Data = {
  enabled: boolean
  acknowledgedAt: string | null
  instagramNoticeAccepted: boolean
  testEventCode: string | null
  testEventCodeExpiresAt: string | null
  currency: 'CRC' | 'USD' | null
  serverReady: boolean
  sentLast30Days: number
  lines: Line[]
}

const TONE = {
  ok: 'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-800',
  bad: 'bg-red-50 text-red-700',
  idle: 'bg-slate-100 text-slate-600',
} as const

/** Plain status per line; the reconnect hint names the line's own app. */
export function lineStatusLabel(line: Pick<Line, 'platform' | 'status'>, instagramNoticeAccepted: boolean): { label: string; tone: string } {
  const app = line.platform === 'instagram' ? 'Instagram' : 'WhatsApp'
  if (line.platform === 'instagram' && !instagramNoticeAccepted && line.status !== 'missing_permission' && line.status !== 'token_invalid') {
    return { label: 'Falta aceptar el aviso de Instagram', tone: TONE.warn }
  }
  switch (line.status) {
    case 'ready':
      return { label: 'Listo', tone: TONE.ok }
    case 'missing_permission':
      return { label: `Falta permiso: reconectá ${app}`, tone: TONE.warn }
    case 'token_invalid':
      return { label: `Reconectar ${app}`, tone: TONE.bad }
    case 'error':
      return { label: 'No se pudo verificar', tone: TONE.idle }
    default:
      return { label: 'Sin verificar', tone: TONE.idle }
  }
}

const NOTICE_TEXT =
  'Entiendo que Betsy enviará a Meta, en nombre de mi negocio, solo cuando un pedido que llegó por un anuncio queda pagado: el monto y, para WhatsApp, el identificador del clic del anuncio; para Instagram, el identificador de Instagram del cliente en ese chat (sin nombres, teléfonos ni mensajes), y que informo a mis clientes según mi aviso de privacidad.'

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
  const hasInstagram = data.lines.some((l) => l.platform === 'instagram')
  const needsInstagramAck = data.enabled && hasInstagram && !data.instagramNoticeAccepted

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-5" data-testid="meta-sales-attribution">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
          <Megaphone className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-900">Ventas por anuncios (Meta)</h2>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-500">
            Cuando un cliente llega por un anuncio a WhatsApp o Instagram y su pedido queda <strong>pagado</strong>, Betsy le
            avisa a tu cuenta de anuncios de Meta. En WhatsApp, Meta puede optimizar tus anuncios para ventas reales; en
            Instagram, ves las ventas en tus reportes. No cambia nada de cómo funcionan tus chats.
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
          <span>{NOTICE_TEXT}</span>
        </label>
      ) : null}

      {needsInstagramAck ? (
        <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900" data-testid="meta-sales-ig-ack">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#5B6CFF]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>
              Para incluir Instagram, aceptá el aviso actualizado: {NOTICE_TEXT}
            </span>
          </label>
          <button
            type="button"
            disabled={busy !== null || !ack}
            onClick={() => void put({ action: 'save', enabled: true, acknowledge: true }, 'save')}
            className="mt-2 rounded-lg bg-white px-2.5 py-1.5 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            Aceptar e incluir Instagram
          </button>
        </div>
      ) : null}

      <div className="mt-4 space-y-2">
        {data.lines.length === 0 ? (
          <p className="text-[12px] text-slate-500">Conectá una línea de WhatsApp o una cuenta de Instagram para usarlo.</p>
        ) : (
          data.lines.map((line) => {
            const st = lineStatusLabel(line, data.enabled ? data.instagramNoticeAccepted : true)
            return (
              <div key={line.id} className="flex items-center justify-between gap-3 text-[12.5px]" data-testid={`meta-sales-line-${line.platform}`}>
                <span className="truncate text-slate-700">
                  <span className="mr-1.5 text-[11px] text-slate-400">{line.platform === 'instagram' ? 'Instagram' : 'WhatsApp'}</span>
                  {line.name}
                </span>
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
