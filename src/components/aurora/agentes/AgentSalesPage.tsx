'use client'

import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, Clock, Loader2, MessageCircle, ShoppingBag, Users } from 'lucide-react'
import {
  auroraBtnPrimary,
  auroraBtnSecondary,
  auroraInputClass,
  auroraLabelClass,
} from '@/components/aurora/ui/aurora-form'

const CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'messenger', label: 'Messenger' },
  { id: 'web', label: 'Sitio web' },
] as const

const VALUE_PROPS = [
  { icon: Clock, title: 'Responde 24/7', text: 'Contesta WhatsApp e Instagram al instante, también de noche y fines de semana.' },
  { icon: ShoppingBag, title: 'Toma pedidos', text: 'Pregunta lo necesario, arma el pedido y lo deja listo en Betsy.' },
  { icon: Users, title: 'Escala a tu equipo', text: 'Cuando algo necesita una persona, te pasa la conversación con el contexto.' },
]

const USE_CASES = [
  'Precios, horarios y disponibilidad sin que tengas que contestar lo mismo cada día.',
  'Pedidos con envío o retiro, con el método de pago que usás.',
  'Seguimiento de clientes que preguntaron y no compraron.',
]

/**
 * Agents tab for businesses without a custom agent (SPEC §7.3): sales page + "Quiero mi agente"
 * lead form → POST /api/support/agent-request. No access to any agent tooling from here.
 */
export function AgentSalesPage() {
  const [open, setOpen] = useState(false)
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null)
  const [form, setForm] = useState({ businessType: '', message: '', phone: '' })
  const [channels, setChannels] = useState<string[]>(['whatsapp'])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneRef, setDoneRef] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/support/contact-config')
      .then((r) => r.json())
      .then((d: { whatsapp?: { url: string } | null }) => {
        if (alive) setWhatsappUrl(d.whatsapp?.url ?? null)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  function toggleChannel(id: string) {
    setChannels((list) => (list.includes(id) ? list.filter((c) => c !== id) : [...list, id]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (form.message.trim().length < 10) {
      setError('Contanos un poco más de lo que querés que haga (mínimo 10 caracteres).')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/support/agent-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessType: form.businessType || null,
          channels,
          message: form.message,
          phone: form.phone || null,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ticketNumber?: string; error?: string }
      if (!res.ok) {
        setError(data.error || 'No pudimos enviar tu solicitud. Intentá de nuevo.')
        return
      }
      setDoneRef(data.ticketNumber || '')
    } catch {
      setError('No pudimos enviar tu solicitud. Revisá tu conexión.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-10">
      <div className="mb-8 rounded-2xl bg-gradient-to-r from-[#5B6CFF] to-[#7C5CFF] p-6 text-white shadow-sm md:p-8">
        <Bot className="mb-3 h-8 w-8" aria-hidden />
        <h1 className="mb-2 text-[22px] font-semibold md:text-[26px]">¿Querés un agente de IA en tu negocio?</h1>
        <p className="max-w-2xl text-[14px] text-white/85">
          Lo armamos por vos, con tus productos, precios y forma de vender. Vos seguís a cargo: el agente atiende y tu equipo cierra cuando hace falta.
        </p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-3">
        {VALUE_PROPS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
            <Icon className="mb-2 h-5 w-5 text-[#5B6CFF]" aria-hidden />
            <p className="mb-1 text-[14px] font-semibold text-slate-900">{title}</p>
            <p className="text-[13px] text-slate-500">{text}</p>
          </div>
        ))}
      </div>

      <div className="mb-8 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
        <p className="mb-3 text-[14px] font-semibold text-slate-900">Ejemplos de lo que hace</p>
        <ul className="space-y-2">
          {USE_CASES.map((u) => (
            <li key={u} className="flex gap-2 text-[13px] text-slate-600">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              {u}
            </li>
          ))}
        </ul>
      </div>

      {doneRef !== null ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900" role="status">
          <CheckCircle2 className="mb-2 h-6 w-6" aria-hidden />
          <p className="text-[15px] font-semibold">¡Listo! Te contactamos pronto{doneRef ? ` (${doneRef})` : ''}.</p>
        </div>
      ) : open ? (
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
          <p className="text-[15px] font-semibold text-slate-900">Contanos de tu negocio</p>
          <label className="block">
            <span className={auroraLabelClass}>Tipo de negocio</span>
            <input
              className={auroraInputClass}
              value={form.businessType}
              onChange={(e) => setForm((f) => ({ ...f, businessType: e.target.value }))}
              maxLength={120}
              placeholder="Ej.: tienda de ropa, colchones, clínica dental"
            />
          </label>
          <fieldset>
            <legend className={auroraLabelClass}>Canales</legend>
            <div className="flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={channels.includes(c.id)}
                  onClick={() => toggleChannel(c.id)}
                  className={`rounded-full border px-3 py-1 text-[13px] ${channels.includes(c.id) ? 'border-[#7C5CFF] bg-[#7C5CFF]/10 text-[#5B3FE0]' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className={auroraLabelClass}>¿Qué querés que haga?</span>
            <textarea
              className={`${auroraInputClass} min-h-[110px]`}
              value={form.message}
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              maxLength={3000}
              required
            />
          </label>
          <label className="block">
            <span className={auroraLabelClass}>Teléfono (opcional)</span>
            <input
              className={auroraInputClass}
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/[^+\d\s()-]/g, '') }))}
              maxLength={30}
              inputMode="tel"
            />
          </label>
          {error && <p className="text-[13px] text-red-600" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={auroraBtnPrimary} disabled={sending}>
              {sending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Enviar solicitud
            </button>
            <button type="button" className={auroraBtnSecondary} onClick={() => setOpen(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={auroraBtnPrimary} onClick={() => setOpen(true)}>
            Quiero mi agente
          </button>
          {whatsappUrl && (
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className={auroraBtnSecondary}>
              <MessageCircle className="h-4 w-4" aria-hidden />
              Escribinos por WhatsApp
            </a>
          )}
        </div>
      )}
    </div>
  )
}
