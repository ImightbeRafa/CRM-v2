'use client'

import { useCallback, useEffect, useState } from 'react'
import { auroraConfirm } from '@/components/aurora/ui/AuroraConfirmHost'

type TicketRow = {
  id: string
  ref: string
  subject: string
  status: string
  category: string
  priority: string
  source: string
  assignee: string
  contactEmail: string
  tenantName: string | null
  createdAt: string
}
type Outbox = {
  pendingWebhook: number
  pendingEmail: number
  failedWebhook: number
  failedEmail: number
  recentFailed: { id: string; ticketId: string; type: string; webhookStatus: string; emailStatus: string; attempts: number; lastError: string | null }[]
}
type Detail = {
  id: string
  ref: string
  subject: string
  status: string
  category: string
  priority: string
  source: string
  assignee: string
  contactName: string | null
  contactEmail: string
  meta: Record<string, unknown>
  tenant: { id: string; name: string; plan: string } | null
  messages: { id: string; author: string; visibility: string; isDraft: boolean; body: string; createdAt: string }[]
  events: { id: string; type: string; webhookStatus: string; emailStatus: string; attempts: number; lastError: string | null }[]
}

const STATUSES = ['open', 'ai_answered', 'waiting_customer', 'escalated', 'resolved', 'closed', 'spam']
const SOURCES = ['contact_form', 'in_app', 'ai_chat', 'email', 'agent_request']
const PRIORITIES = ['low', 'normal', 'high', 'critical']

const AUTHOR: Record<string, string> = { customer: 'Cliente', grok_agent: 'Agente', rafael: 'Rafael', system: 'Sistema' }

function when(iso: string) {
  return new Date(iso).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Rafael's support inbox (internal only). Plain text everywhere: nothing is rendered as HTML. */
export default function SupportInbox({ initialId }: { initialId?: string }) {
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [rows, setRows] = useState<TicketRow[] | null>(null)
  const [outbox, setOutbox] = useState<Outbox | null>(null)
  const [ready, setReady] = useState(true)
  const [selected, setSelected] = useState<string | null>(initialId ?? null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [reply, setReply] = useState('')
  const [internal, setInternal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    const qs = new URLSearchParams()
    if (status) qs.set('status', status)
    if (source) qs.set('source', source)
    const res = await fetch(`/api/super-admin/support/tickets?${qs}`, { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) return setMessage('No se pudo cargar la lista.')
    const json = (await res.json()) as { ready: boolean; tickets: TicketRow[]; outbox: Outbox | null }
    setReady(json.ready)
    setRows(json.tickets)
    setOutbox(json.outbox)
  }, [status, source])

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/super-admin/support/tickets/${encodeURIComponent(id)}`, { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) {
      setDetail(null)
      return setMessage('Ticket no encontrado.')
    }
    setDetail(((await res.json()) as { ticket: Detail }).ticket)
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (selected) void loadDetail(selected)
  }, [selected, loadDetail])

  async function act(body: Record<string, unknown>, okText: string) {
    if (!detail) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/super-admin/support/tickets/${encodeURIComponent(detail.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) setMessage(json.error || 'No se pudo.')
      else {
        setMessage(okText)
        await Promise.all([loadDetail(detail.id), loadList()])
      }
    } finally {
      setBusy(false)
    }
  }

  if (!ready) {
    return (
      <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-[13px] text-amber-900">
        Las tablas de soporte todavía no existen: falta aplicar la SQL 059 (ver docs/runbooks/support-pipeline.md).
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {outbox && (
        <div className="flex flex-wrap gap-3 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-700" data-testid="support-outbox">
          <span>Webhook pendiente: {outbox.pendingWebhook}</span>
          <span>Correo pendiente: {outbox.pendingEmail}</span>
          <span className={outbox.failedWebhook ? 'text-red-700' : ''}>Webhook fallido: {outbox.failedWebhook}</span>
          <span className={outbox.failedEmail ? 'text-red-700' : ''}>Correo fallido: {outbox.failedEmail}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <select aria-label="Estado" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-[13px]">
          <option value="">Todos los estados</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Canal" value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1 text-[13px]">
          <option value="">Todos los canales</option>
          {SOURCES.map((s) => <option key={s} value={s}>{s === 'agent_request' ? 'agent_request (leads)' : s}</option>)}
        </select>
      </div>
      {message && <p className="text-[12.5px] text-slate-700" role="status">{message}</p>}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white">
          {(rows || []).map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setSelected(t.id)}
                className={`block w-full px-3 py-2 text-left text-[12.5px] hover:bg-slate-50 ${selected === t.id ? 'bg-indigo-50' : ''}`}
              >
                <span className="block truncate font-medium text-slate-900">{t.ref} · {t.subject}</span>
                <span className="block truncate text-slate-500">
                  {t.status} · {t.source} · {t.tenantName || t.contactEmail} · {when(t.createdAt)}
                </span>
              </button>
            </li>
          ))}
          {rows && rows.length === 0 && <li className="px-3 py-4 text-[12.5px] text-slate-500">Sin tickets.</li>}
        </ul>

        {detail ? (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-[13px]">
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900">{detail.ref} · {detail.subject}</h3>
              <p className="text-[12px] text-slate-500">
                {detail.contactName || '—'} &lt;{detail.contactEmail}&gt; · {detail.source} · {detail.tenant ? `${detail.tenant.name} (${detail.tenant.plan})` : 'sin negocio'} · asignado a {detail.assignee}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <select aria-label="Cambiar estado" value={detail.status} disabled={busy} onChange={(e) => void act({ action: 'update', status: e.target.value }, 'Estado actualizado.')} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select aria-label="Cambiar prioridad" value={detail.priority} disabled={busy} onChange={(e) => void act({ action: 'update', priority: e.target.value }, 'Prioridad actualizada.')} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
                {PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select aria-label="Asignar" value={detail.assignee} disabled={busy} onChange={(e) => void act({ action: 'update', assignee: e.target.value }, 'Asignación actualizada.')} className="rounded-lg border border-slate-300 px-2 py-1 text-[12px]">
                <option value="grok_agent">grok_agent</option>
                <option value="rafael">rafael</option>
              </select>
            </div>
            <ol className="max-h-[45vh] space-y-2 overflow-y-auto">
              {detail.messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-lg p-2 ${m.isDraft ? 'border border-dashed border-amber-400 bg-amber-50' : m.visibility === 'internal' ? 'bg-yellow-50' : m.author === 'customer' ? 'bg-slate-50' : 'bg-indigo-50'}`}
                >
                  <p className="mb-1 text-[11px] text-slate-500">
                    {AUTHOR[m.author] || m.author} · {m.isDraft ? 'BORRADOR' : m.visibility === 'internal' ? 'nota interna' : 'público'} · {when(m.createdAt)}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  {m.isDraft && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await auroraConfirm(
                          `¿Enviar este borrador a ${detail.contactEmail}?\nLo escribió el agente a partir de texto NO verificado del cliente: revisá enlaces, números y datos antes de enviarlo.`,
                        )
                        if (ok) void act({ action: 'publish_draft', messageId: m.id }, 'Borrador enviado al cliente.')
                      }}
                      className="mt-1 rounded-md bg-white px-2 py-0.5 text-[12px] ring-1 ring-amber-400 disabled:opacity-50"
                    >
                      Enviar al cliente
                    </button>
                  )}
                </li>
              ))}
            </ol>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!reply.trim()) return
                void act(internal ? { action: 'note', body: reply } : { action: 'reply', body: reply }, internal ? 'Nota guardada.' : 'Respuesta enviada.').then(() => setReply(''))
              }}
              className="space-y-2"
            >
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} aria-label="Respuesta" className="min-h-[90px] w-full rounded-lg border border-slate-300 p-2 text-[13px]" />
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-[12px] text-slate-600">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Nota interna
                </label>
                <button type="submit" disabled={busy || !reply.trim()} className="rounded-md bg-indigo-600 px-3 py-1 text-[12.5px] font-medium text-white disabled:opacity-50">
                  {internal ? 'Guardar nota' : 'Responder como Rafael'}
                </button>
              </div>
            </form>
            <div className="text-[12px] text-slate-600">
              <p className="mb-1 font-medium">Entregas</p>
              <ul className="space-y-1">
                {detail.events.map((ev) => (
                  <li key={ev.id} className="flex flex-wrap items-center gap-2">
                    <span>{ev.type}: webhook {ev.webhookStatus}, correo {ev.emailStatus} ({ev.attempts} intentos){ev.lastError ? ` — ${ev.lastError}` : ''}</span>
                    {(ev.webhookStatus === 'failed' || ev.emailStatus === 'failed') && (
                      <button type="button" disabled={busy} onClick={() => void act({ action: 'retry_event', eventId: ev.id }, 'Reintento programado.')} className="rounded-md bg-white px-2 py-0.5 ring-1 ring-slate-300 disabled:opacity-50">
                        Reintentar
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 p-6 text-[13px] text-slate-500">Elegí un ticket.</p>
        )}
      </div>
    </div>
  )
}
