'use client'

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { hasSessionPermission } from '@/lib/session-permissions'
import { parseOrder } from '@/app/hooks/useSalesStream'
import type { Sale } from '@/app/produccion/types/sales'
import Link from 'next/link'
import { Check, ExternalLink, FileText, Link2, Loader2, Search, Send, ShoppingBag, Star, Unlink, UserRound } from 'lucide-react'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { pedidoHref } from '@/lib/pedido-url'
import { nextOrderStep, type ChatFlowOrder } from '@/lib/chat-order-flow'
import { auroraConfirm } from '@/components/aurora/ui/AuroraConfirmHost'
import { ChatNotesPanel } from '@/components/chats/ChatNotesPanel'
import { stageChipClass, useCrmCatalog } from '@/components/chats/useCrmCatalog'

type ClientInfo = {
  id: string
  name: string
  phone: string
  email: string | null
  username: string | null
  province: string
  canton: string
  totalOrders: number
  totalSpent: number
  lastOrder: string
  isFavorite: boolean
  /** Legacy free-text note (read-only "Nota original"). */
  notes?: string | null
}

type ClientStage = {
  key: string
  label: string
  category: 'open' | 'won' | 'lost'
  color: string | null
  source: 'auto' | 'manual'
  reason: string
  enteredAt: string | null
  repeatCustomer?: boolean
  editable?: boolean
}

type PanelData = {
  client: ClientInfo | null
  stage: ClientStage | null
  orders: ChatFlowOrder[]
  suggestions: ClientInfo[]
  results: ClientInfo[]
}

// Same generator as Producción: delivery type, address verification, GAM rules, generate.
const GuiaGenerator = lazy(() =>
  import('@/app/produccion/components/GuiaGenerator').then((m) => ({ default: m.GuiaGenerator })),
)

function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: '2-digit' })
}

/**
 * Chats › Cliente: who this person is (linked client, purchase history) and the chat's
 * pedidos with the next step: Generar guía → Enviar guía al cliente.
 */
export function ChatClientPanel({
  conversationId,
  platform,
  revision,
  onCreateOrder,
  onGuiaSent,
}: {
  conversationId: string
  platform: 'whatsapp' | 'instagram'
  /** Bumps when the chat changes server-side (e.g. an order was linked) to refetch. */
  revision?: string | number
  onCreateOrder?: () => void
  onGuiaSent?: () => void
}) {
  const { formatCurrency } = useTenantSettings()
  const [data, setData] = useState<PanelData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const { data: session, status: sessionStatus } = useSession()
  const canGenerateGuia = hasSessionPermission(session, 'update_production')
  // No "your role cannot" hint while the session is still loading (it flashed for Producción users).
  const sessionReady = sessionStatus !== 'loading'
  const [guiaSale, setGuiaSale] = useState<Sale | null>(null)
  const requestSeq = useRef(0)

  const load = useCallback(
    async (q = '') => {
      const seq = ++requestSeq.current
      try {
        const res = await fetch(
          `/api/chat/conversations/${encodeURIComponent(conversationId)}/client${q ? `?q=${encodeURIComponent(q)}` : ''}`,
          { credentials: 'same-origin', cache: 'no-store' },
        )
        const json = (await res.json().catch(() => null)) as (PanelData & { success?: boolean }) | null
        if (seq !== requestSeq.current) return
        if (!res.ok || !json?.success) {
          setLoadError(true)
          return
        }
        setLoadError(false)
        setData({ client: json.client, stage: json.stage ?? null, orders: json.orders ?? [], suggestions: json.suggestions ?? [], results: json.results ?? [] })
      } catch {
        if (seq === requestSeq.current) setLoadError(true)
      }
    },
    [conversationId],
  )

  useEffect(() => {
    setData(null)
    setQuery('')
    setSearchOpen(false)
    setNotice(null)
    void load()
  }, [load, revision])

  useEffect(() => {
    if (!searchOpen) return
    const t = window.setTimeout(() => void load(query.trim()), 250)
    return () => window.clearTimeout(t)
  }, [query, searchOpen, load])

  async function link(clientId: string | null, confirmPhoneMismatch = false) {
    setBusy(clientId ? `link:${clientId}` : 'unlink')
    setNotice(null)
    try {
      const res = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/client`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, confirmPhoneMismatch }),
      })
      const json = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
        code?: string
        clientPhoneMasked?: string | null
      } | null
      if (res.status === 409 && json?.code === 'phone_mismatch' && clientId && !confirmPhoneMismatch) {
        setBusy(null)
        const ok = await auroraConfirm('¿Vincular a un cliente con otro teléfono?', {
          description: `El teléfono del cliente (${json.clientPhoneMasked || 'sin teléfono'}) no es el de este chat. Vinculá solo si confirmaste que es la misma persona: vas a ver sus pedidos y podrás enviarle sus guías.`,
          confirmLabel: 'Sí, es la misma persona',
        })
        if (ok) await link(clientId, true)
        return
      }
      if (!res.ok || !json?.success) {
        setNotice({ tone: 'error', text: json?.error || 'No se pudo vincular el cliente.' })
        return
      }
      setSearchOpen(false)
      setQuery('')
      setNotice({ tone: 'ok', text: clientId ? 'Chat vinculado al cliente.' : 'Chat desvinculado.' })
      await load()
    } finally {
      setBusy(null)
    }
  }

  /** Loads the full order (same loader as Pedidos) and opens the Producción guía generator. */
  async function openGuiaGenerator(order: ChatFlowOrder) {
    setBusy(`guia:${order.id}`)
    setNotice(null)
    try {
      const res = await fetch(`/api/orders/details?id=${encodeURIComponent(order.id)}`, { credentials: 'same-origin', cache: 'no-store' })
      const json = (await res.json().catch(() => null)) as { data?: unknown } | null
      const sale = res.ok && json?.data ? parseOrder(json.data) : null
      if (!sale) {
        setNotice({ tone: 'error', text: 'No se pudo abrir el pedido para generar la guía.' })
        return
      }
      setGuiaSale(sale)
    } catch {
      setNotice({ tone: 'error', text: 'Sin conexión. Probá de nuevo.' })
    } finally {
      setBusy(null)
    }
  }

  async function updateOrder(orderId: string, updatedData: Partial<Sale>): Promise<Sale> {
    const response = await fetch('/api/orders/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ orderId, ...updatedData }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el pedido')
    return data.data || data
  }

  async function sendGuia(order: ChatFlowOrder, resend = false) {
    // The label carries the customer's name, address and phone: a different phone needs a look.
    if (!order.phoneMatchesChat) {
      const ok = await auroraConfirm('¿Enviar esta guía a este chat?', {
        description: `El pedido #${order.orderId} es de ${order.customerName || 'otro cliente'} (${order.phoneMasked || 'sin teléfono'}), y este chat es de otro número. La guía incluye nombre, dirección y teléfono.`,
        confirmLabel: 'Enviar guía',
      })
      if (!ok) return
    }
    setBusy(`send:${order.id}`)
    setNotice(null)
    try {
      const res = await fetch('/api/chat/send-guia', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, orderId: order.id, confirm: !order.phoneMatchesChat, resend }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; duplicate?: boolean; error?: string } | null
      if (!res.ok || !json?.success) {
        setNotice({ tone: 'error', text: json?.error || 'No se pudo enviar la guía.' })
        return
      }
      setNotice({ tone: 'ok', text: json.duplicate ? 'Esta guía ya se había enviado a este chat.' : 'Guía enviada al cliente.' })
      onGuiaSent?.()
      await load()
    } catch {
      setNotice({ tone: 'error', text: 'Sin conexión. Probá de nuevo.' })
    } finally {
      setBusy(null)
    }
  }

  if (loadError && !data) {
    return (
      <div className="rounded-xl bg-white p-3 text-xs text-slate-500 ring-1 ring-slate-100">
        No se pudo cargar el cliente.{' '}
        <button type="button" onClick={() => void load()} className="font-semibold text-au-ink-5b6cff hover:underline">
          Reintentar
        </button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-2" aria-busy="true">
        <div className="h-24 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
      </div>
    )
  }

  const { client, stage, orders, suggestions, results } = data
  const pickList = (list: ClientInfo[], label: string) =>
    list.length ? (
      <div>
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <ul className="space-y-1.5">
          {list.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-100">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-slate-800">{c.name}</span>
                <span className="block truncate text-[11px] text-slate-500">
                  {c.phone} · {c.totalOrders} {c.totalOrders === 1 ? 'pedido' : 'pedidos'}
                </span>
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void link(c.id)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-au-tint-eef0ff px-2 py-1 text-[11px] font-semibold text-au-ink-4a46e5 hover:bg-au-tint-e2e5ff disabled:opacity-50"
              >
                {busy === `link:${c.id}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Link2 className="h-3 w-3" aria-hidden />}
                Vincular
              </button>
            </li>
          ))}
        </ul>
      </div>
    ) : null

  return (
    <div className="aurora-light space-y-4 text-slate-900" data-testid="chat-client-panel">
      {notice ? (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-[11.5px] ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}
        >
          {notice.text}
        </p>
      ) : null}

      {client ? (
        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-100" data-testid="chat-client-linked">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-au-tint-eef0ff text-au-ink-5b6cff">
              <UserRound className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-[13px] font-semibold text-slate-900">
                <span className="truncate">{client.name}</span>
                {client.isFavorite ? <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Favorito" /> : null}
              </span>
              <span className="block truncate text-[11.5px] text-slate-500">{client.phone}</span>
              {client.province ? (
                <span className="block truncate text-[11px] text-slate-400">
                  {[client.canton, client.province].filter(Boolean).join(', ')}
                </span>
              ) : null}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-1.5 text-center">
            <div className="rounded-lg bg-slate-50 px-1 py-1.5">
              <p className="text-[14px] font-semibold text-slate-900">{client.totalOrders}</p>
              <p className="text-[10px] text-slate-500">Pedidos</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-1 py-1.5">
              <p className="truncate text-[12px] font-semibold text-slate-900">{formatCurrency(client.totalSpent)}</p>
              <p className="text-[10px] text-slate-500">Compró</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-1 py-1.5">
              <p className="text-[12px] font-semibold text-slate-900">{shortDate(client.lastOrder) || '—'}</p>
              <p className="text-[10px] text-slate-500">Último</p>
            </div>
          </div>
          {stage ? (
            <ClientStageChip
              clientId={client.id}
              stage={stage}
              onChanged={(next) => setData((prev) => (prev ? { ...prev, stage: next } : prev))}
            />
          ) : null}
          <div className="mt-2 flex items-center justify-between">
            <Link
              href={`/ventas?buscar=${encodeURIComponent(client.phone || client.name)}`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-au-ink-5b6cff hover:underline"
            >
              Ver pedidos <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void link(null)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-red-600 disabled:opacity-50"
            >
              <Unlink className="h-3 w-3" aria-hidden /> Desvincular
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl bg-white p-3 ring-1 ring-slate-100" data-testid="chat-client-unlinked">
          <div>
            <p className="text-[12.5px] font-semibold text-slate-800">Sin cliente vinculado</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              Vinculá el chat a un cliente para ver sus compras y que cuente en estadísticas.
            </p>
          </div>
          {pickList(suggestions, platform === 'whatsapp' ? 'Coincide por teléfono' : 'Sugerido')}
          {searchOpen ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-100">
                <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Nombre, usuario o teléfono"
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-slate-900 outline-none placeholder:text-slate-400"
                  aria-label="Buscar cliente"
                />
              </label>
              {query.trim().length >= 2 && results.length === 0 ? (
                <p className="px-1 text-[11px] text-slate-400">Sin coincidencias.</p>
              ) : null}
              {pickList(results, 'Resultados')}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-100 py-2 text-[11.5px] font-semibold text-slate-700 hover:bg-slate-200"
            >
              <Search className="h-3.5 w-3.5" aria-hidden /> Buscar cliente existente
            </button>
          )}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-medium text-slate-400">Pedidos {client ? 'del cliente' : 'de este chat'}</p>
          {onCreateOrder ? (
            <button
              type="button"
              onClick={onCreateOrder}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-au-ink-5b6cff hover:underline"
            >
              <ShoppingBag className="h-3 w-3" aria-hidden /> Crear pedido
            </button>
          ) : null}
        </div>
        {orders.length === 0 ? (
          <p className="rounded-lg bg-white px-3 py-3 text-[11.5px] text-slate-400 ring-1 ring-slate-100">
            Todavía no hay pedidos. Creá uno desde el chat y acá vas a poder generar y enviar la guía.
          </p>
        ) : (
          <ul className="space-y-2">
            {orders.map((order) => {
              const step = nextOrderStep(order)
              return (
                <li key={order.id} className="rounded-xl bg-white p-3 ring-1 ring-slate-100" data-testid="chat-flow-order">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={pedidoHref(order.orderId)} className="min-w-0 hover:underline">
                      <span className="block text-[12.5px] font-semibold text-slate-900">#{order.orderId}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {[order.product, shortDate(order.timestamp)].filter(Boolean).join(' · ')}
                      </span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {order.customerName}
                        {order.phoneMasked ? ` · ${order.phoneMasked}` : ''}
                        {!order.phoneMatchesChat ? ' · otro número' : ''}
                      </span>
                    </Link>
                    <span className="shrink-0 text-right">
                      <span className="block text-[12px] font-semibold text-slate-800">{formatCurrency(order.total)}</span>
                      <span className="mt-0.5 inline-block rounded-md bg-slate-100 px-1.5 py-px text-[10px] font-medium text-slate-600">
                        {order.status}
                      </span>
                    </span>
                  </div>

                  <ol className="mt-2.5 flex items-center gap-1 text-[10px] font-medium text-slate-400" aria-label="Pasos del pedido">
                    <li className="flex items-center gap-1 text-emerald-700">
                      <Check className="h-3 w-3" aria-hidden /> Pedido
                    </li>
                    {step !== 'retiro' ? (
                      <>
                        <li aria-hidden>›</li>
                        <li className={`flex items-center gap-1 ${order.guia ? 'text-emerald-700' : ''}`}>
                          {order.guia ? <Check className="h-3 w-3" aria-hidden /> : null} Guía
                        </li>
                        <li aria-hidden>›</li>
                        <li className={`flex items-center gap-1 ${order.guiaSentAt ? 'text-emerald-700' : ''}`}>
                          {order.guiaSentAt ? <Check className="h-3 w-3" aria-hidden /> : null} Enviada
                        </li>
                      </>
                    ) : (
                      <li className="ml-1 text-slate-500">· Retiro en tienda</li>
                    )}
                  </ol>

                  {step === 'guia' ? (
                    canGenerateGuia ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void openGuiaGenerator(order)}
                        data-testid="chat-open-guia-generator"
                        className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-lg bg-[#5B6CFF] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                      >
                        {busy === `guia:${order.id}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <FileText className="h-3 w-3" aria-hidden />}
                        Generar guía
                      </button>
                    ) : !sessionReady ? null : (
                      <p className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-500">
                        Tu rol no genera guías: pedísela a Producción. Cuando esté lista, la enviás desde acá.
                      </p>
                    )
                  ) : null}
                  {step === 'enviar-guia' || step === 'listo' ? (
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] text-slate-500">
                        {order.guia?.number ? `Guía ${order.guia.number}` : 'Guía lista'}
                        {order.guiaSentAt ? ` · enviada ${shortDate(order.guiaSentAt)}` : ''}
                      </span>
                      {platform === 'whatsapp' ? (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void sendGuia(order, step === 'listo')}
                          className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50 ${
                            step === 'listo' ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-[#5B6CFF] text-white'
                          }`}
                        >
                          {busy === `send:${order.id}` ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Send className="h-3 w-3" aria-hidden />}
                          {step === 'listo' ? 'Reenviar' : 'Enviar guía'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Keyed on the client: linking / unlinking reloads the notes (client notes join the chat's). */}
      <ChatNotesPanel key={client?.id ?? 'none'} conversationId={conversationId} hasClient={Boolean(client)} legacyNote={client?.notes ?? null} />

      {guiaSale ? (
        <Suspense fallback={null}>
          <GuiaGenerator
            open
            orders={[guiaSale]}
            onClose={() => {
              setGuiaSale(null)
              // The order now has its guía: the next step here is "Enviar guía".
              void load()
            }}
            onUpdateOrder={updateOrder}
            surface="chats"
          />
        </Suspense>
      ) : null}
    </div>
  )
}

/**
 * Lifecycle stage of the client (computed from orders; see src/lib/crm-client-stage.ts). The team
 * can pin another stage: it sticks until new evidence (order, payment, guía) moves the client.
 */
function ClientStageChip({
  clientId,
  stage,
  onChanged,
}: {
  clientId: string
  stage: ClientStage
  onChanged: (stage: ClientStage) => void
}) {
  const { activeClientStages } = useCrmCatalog()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function choose(key: string) {
    if (key === stage.key) {
      setOpen(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/clients/${encodeURIComponent(clientId)}/stage`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageKey: key }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; stage?: ClientStage; error?: string } | null
      if (!res.ok || !json?.success || !json.stage) {
        setError(json?.error || 'No se pudo cambiar la etapa.')
        return
      }
      onChanged(json.stage)
      setOpen(false)
    } catch {
      setError('Sin conexión.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2" data-testid="client-stage">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            disabled={stage.editable === false}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:cursor-default ${stageChipClass(stage.color)}`}
            title={stage.reason}
          >
            {stage.label}
            {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          </button>
          {stage.repeatCustomer && stage.key !== 'recurrente' ? (
            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700" data-testid="client-repeat-badge">
              Cliente recurrente
            </span>
          ) : null}
        </span>
        <span className="truncate text-[10.5px] text-slate-400">
          {stage.source === 'manual' ? 'Elegida por el equipo' : stage.reason}
        </span>
      </div>
      {open && stage.editable !== false ? (
        <div className="mt-1.5 flex flex-wrap gap-1 rounded-lg bg-slate-50 p-1.5 ring-1 ring-slate-100" role="listbox" aria-label="Etapa del cliente">
          {activeClientStages.map((s) => (
            <button
              key={s.key}
              type="button"
              role="option"
              aria-selected={s.key === stage.key}
              disabled={saving}
              onClick={() => void choose(s.key)}
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${stageChipClass(s.color, s.key === stage.key)}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-1 text-[11px] text-red-600">{error}</p> : null}
    </div>
  )
}
