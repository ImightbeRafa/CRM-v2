'use client'

/**
 * Estadísticas › Clientes: who is about to run out (reorder reminders) and who buys again (repeat buyers).
 * Nothing is sent automatically: "Abrir chat" opens the inbox and the suggested message is copied (Lane E2).
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Check, Copy, MessageCircle, Plus, RefreshCw, Repeat, Trash2 } from 'lucide-react'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { StatsCard } from '@/components/aurora/estadisticas/StatsCard'
import { AuroraEmptyState } from '@/components/aurora/states'
import { hasSessionPermission } from '@/lib/session-permissions'
import { formatCompactMoney, formatDayLabel } from '@/lib/statistics-aurora'
import { REORDER_LIMITS, type ReorderRule } from '@/lib/insights/reorder'
import { InsightsHeader, SourceNote, nf, useInsightsJson } from './InsightsShared'

type DueRow = {
  key: string
  customerName: string
  phone: string | null
  ruleLabel: string
  lastOrderNumber: string
  lastOrderDate: string
  units: number
  runsOutOn: string
  daysLeft: number
  suggestedMessage: string
  chatHref: string | null
  whatsappHref: string | null
}
type DuePayload = { windowDays: number; overdueDays: number; todayKey: string; lookbackDays: number; rules: ReorderRule[]; rows: DueRow[] }

type RepeatRow = {
  clientId: string
  name: string
  phone: string | null
  totalOrders: number
  totalSpent: number
  lastOrder: string
  daysSinceLast: number
  chatHref: string | null
  whatsappHref: string | null
}
type RepeatPayload = { total: number; page: number; pageSize: number; rows: RepeatRow[] }

const WINDOWS = [7, 14, 30] as const
const SORTS = [
  { key: 'recientes', label: 'Compraron hace poco' },
  { key: 'gasto', label: 'Más gastaron' },
  { key: 'pedidos', label: 'Más pedidos' },
  { key: 'dormidos', label: 'Hace rato no compran' },
] as const

function dueLabel(daysLeft: number): string {
  if (daysLeft < 0) return `Se le acabó hace ${-daysLeft} ${daysLeft === -1 ? 'día' : 'días'}`
  if (daysLeft === 0) return 'Se le acaba hoy'
  return `Se le acaba en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}`
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true)
            setTimeout(() => setDone(false), 1800)
          },
          () => undefined,
        )
      }}
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
    >
      {done ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {done ? 'Copiado' : 'Copiar mensaje'}
    </button>
  )
}

function ChatLink({ href: rawHref, whatsappHref }: { href: string | null; whatsappHref?: string | null }) {
  // /chats needs update_sales: other roles get no inbox link.
  const { data: session } = useSession()
  const href = rawHref && hasSessionPermission(session, 'update_sales') ? rawHref : null
  if (!href && rawHref) return <span className="text-[11.5px] text-slate-400">Tiene chat en Betsy</span>
  if (!href && whatsappHref) {
    return (
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        title="Este cliente no tiene chat en Betsy: abre WhatsApp con su número"
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[12.5px] font-medium text-emerald-700"
      >
        <MessageCircle className="h-4 w-4" aria-hidden />
        Escribir por WhatsApp
      </a>
    )
  }
  if (!href) return <span className="text-[11.5px] text-slate-400">Sin chat en Betsy</span>
  return (
    <Link
      href={href}
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-au-tint-eef0ff px-3 text-[12.5px] font-medium text-au-ink-5b6cff"
    >
      <MessageCircle className="h-4 w-4" aria-hidden />
      Abrir chat
    </Link>
  )
}

// ── Rules editor ─────────────────────────────────────────────────────────────────────────────────

type DraftRule = ReorderRule & { mode: 'product' | 'text' }

function newId(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function RulesEditor({ onSaved }: { onSaved: () => void }) {
  const [res, reload] = useInsightsJson<{ rules: ReorderRule[]; products: Array<{ id: string; name: string; sku: string }> }>('/api/config/reorder-rules')
  const [draft, setDraft] = useState<DraftRule[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (res.data) setDraft(res.data.rules.map((r) => ({ ...r, mode: r.inventoryItemId ? 'product' : 'text' })))
  }, [res.data])

  const products = res.data?.products ?? []
  const update = (id: string, patch: Partial<DraftRule>) => setDraft((d) => (d ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)))

  async function save() {
    if (!draft) return
    setSaving(true)
    setMessage(null)
    try {
      const rules = draft.map((r) => ({
        id: r.id,
        label: r.label,
        inventoryItemId: r.mode === 'product' ? r.inventoryItemId : null,
        match: r.mode === 'text' ? r.match : null,
        daysPerUnit: Number(r.daysPerUnit),
      }))
      const out = await fetch('/api/config/reorder-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      })
      const json = (await out.json().catch(() => ({}))) as { error?: string }
      if (!out.ok) {
        setMessage({ ok: false, text: json.error || 'No se pudo guardar.' })
        return
      }
      setMessage({ ok: true, text: 'Guardado.' })
      reload()
      onSaved()
    } catch {
      setMessage({ ok: false, text: 'No se pudo guardar. Revisá tu conexión.' })
    } finally {
      setSaving(false)
    }
  }

  if (res.state === 'error') {
    return <p className="text-[12px] text-red-600">No se pudieron cargar las reglas.</p>
  }
  if (!draft) return <p className="text-[12px] text-slate-400">Cargando reglas…</p>

  return (
    <div className="space-y-3" data-testid="reorder-rules-editor">
      <p className="text-[12px] text-slate-500">
        Decile a Betsy cuánto dura cada producto. Ejemplo: una caja de 30 parches dura 30 días. Con eso calculamos cuándo se le acaba a cada
        cliente según su último pedido.
      </p>
      {draft.length === 0 ? <p className="text-[12px] text-slate-400">Todavía no hay productos con duración.</p> : null}
      <ul className="space-y-2">
        {draft.map((rule) => (
          <li key={rule.id} className="grid grid-cols-1 gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-[1fr_1fr_120px_auto] sm:items-end">
            <label className="text-[11px] text-slate-500">
              Nombre para el mensaje
              <input
                value={rule.label}
                maxLength={REORDER_LIMITS.label}
                onChange={(e) => update(rule.id, { label: e.target.value })}
                placeholder="los parches"
                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-2 text-[13px] text-slate-900"
              />
            </label>
            <div className="text-[11px] text-slate-500">
              <div className="flex gap-2">
                <button type="button" onClick={() => update(rule.id, { mode: 'product' })} className={rule.mode === 'product' ? 'font-semibold text-au-ink-5b6cff' : ''}>
                  Producto del inventario
                </button>
                <span aria-hidden>·</span>
                <button type="button" onClick={() => update(rule.id, { mode: 'text' })} className={rule.mode === 'text' ? 'font-semibold text-au-ink-5b6cff' : ''}>
                  Por nombre
                </button>
              </div>
              {rule.mode === 'product' ? (
                <select
                  value={rule.inventoryItemId ?? ''}
                  onChange={(e) => update(rule.id, { inventoryItemId: e.target.value || null })}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-[13px] text-slate-900"
                >
                  <option value="">Elegí un producto…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={rule.match ?? ''}
                  maxLength={REORDER_LIMITS.match}
                  onChange={(e) => update(rule.id, { match: e.target.value })}
                  placeholder="Texto que aparece en el pedido, ej. parches"
                  className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-2 text-[13px] text-slate-900"
                />
              )}
            </div>
            <label className="text-[11px] text-slate-500">
              Días que dura 1 unidad
              <input
                type="number"
                min={REORDER_LIMITS.minDays}
                max={REORDER_LIMITS.maxDays}
                value={Number.isFinite(rule.daysPerUnit) ? rule.daysPerUnit : ''}
                onChange={(e) => update(rule.id, { daysPerUnit: Number(e.target.value) })}
                className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-2 text-[13px] text-slate-900"
              />
            </label>
            <button
              type="button"
              onClick={() => setDraft((d) => (d ?? []).filter((r) => r.id !== rule.id))}
              className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-lg px-2 text-[12px] text-slate-500 hover:text-red-600"
              aria-label={`Quitar ${rule.label || 'regla'}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              <span className="sm:hidden">Quitar</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {draft.length < REORDER_LIMITS.rules ? (
          <button
            type="button"
            onClick={() => setDraft((d) => [...(d ?? []), { id: newId(), label: '', inventoryItemId: null, match: '', daysPerUnit: 30, mode: products.length ? 'product' : 'text' }])}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700"
          >
            <Plus className="h-4 w-4" aria-hidden /> Agregar producto
          </button>
        ) : null}
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="inline-flex min-h-[40px] items-center rounded-xl bg-[#5B6CFF] px-4 text-[12.5px] font-semibold text-white disabled:opacity-60"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        {message ? <span className={`text-[12px] ${message.ok ? 'text-emerald-600' : 'text-red-600'}`}>{message.text}</span> : null}
      </div>
      <p className="text-[11px] text-slate-400">“Por nombre” busca ese texto en el producto del pedido: puede confundirse con productos parecidos.</p>
    </div>
  )
}

// ── Reorder list ─────────────────────────────────────────────────────────────────────────────────

function ReorderSection({ canEditRules }: { canEditRules: boolean }) {
  const [days, setDays] = useState<number>(7)
  const [showRules, setShowRules] = useState(false)
  const [res, reload] = useInsightsJson<DuePayload>(`/api/estadisticas/clientes/recompra?dias=${days}`)
  const [openMsg, setOpenMsg] = useState<string | null>(null)
  const data = res.data
  const noRules = data ? data.rules.length === 0 : false

  return (
    <StatsCard
      title="Por recomprar"
      subtitle="Clientes a los que se les acaba el producto pronto"
      state={res.state}
      onRetry={reload}
      skeletonClass="h-[200px]"
      right={
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Próximos días">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              aria-pressed={days === w}
              onClick={() => setDays(w)}
              className={`min-h-[32px] rounded-md px-2.5 text-[12px] font-medium ${days === w ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
            >
              {w} días
            </button>
          ))}
        </div>
      }
    >
      {data ? (
        <>
          {noRules ? (
            <AuroraEmptyState
              icon={<RefreshCw className="h-6 w-6" />}
              title="Decinos cuánto dura cada producto"
              description="Con la duración (ej. 30 parches = 30 días) Betsy te avisa a quién se le está acabando, para escribirle antes."
              className="py-6"
              actions={
                canEditRules && !showRules ? (
                  <button type="button" onClick={() => setShowRules(true)} className="mt-3 inline-flex min-h-[40px] items-center rounded-xl bg-[#5B6CFF] px-4 text-[12.5px] font-semibold text-white">
                    Configurar duración
                  </button>
                ) : !canEditRules ? (
                  <p className="mt-2 text-[11.5px] text-slate-400">Pedile a quien administra Betsy que configure la duración.</p>
                ) : null
              }
            />
          ) : data.rows.length === 0 ? (
            <AuroraEmptyState
              tone="neutral"
              icon={<Check className="h-6 w-6" />}
              title={`Nadie se queda sin producto en los próximos ${data.windowDays} días`}
              description="Probá con un rango más largo o revisá la duración de tus productos."
              className="py-6"
            />
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="reorder-list">
              {data.rows.map((row) => (
                <li key={row.key} className="py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-slate-900">{row.customerName}</p>
                      <p className="text-[12px] text-slate-500">
                        {row.ruleLabel} · {nf.format(row.units)} {row.units === 1 ? 'unidad' : 'unidades'} · pedido #{row.lastOrderNumber} del{' '}
                        {formatDayLabel(row.lastOrderDate)}
                      </p>
                      <p className={`text-[12px] font-medium ${row.daysLeft < 0 ? 'text-red-600' : row.daysLeft <= 3 ? 'text-amber-600' : 'text-slate-600'}`}>
                        {dueLabel(row.daysLeft)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <ChatLink href={row.chatHref} whatsappHref={row.whatsappHref} />
                      <button
                        type="button"
                        onClick={() => setOpenMsg((k) => (k === row.key ? null : row.key))}
                        aria-expanded={openMsg === row.key}
                        className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700"
                      >
                        Mensaje sugerido
                      </button>
                    </div>
                  </div>
                  {openMsg === row.key ? (
                    <div className="mt-2 rounded-xl bg-slate-50 p-3">
                      <p className="whitespace-pre-wrap text-[12.5px] text-slate-700">{row.suggestedMessage}</p>
                      <div className="mt-2">
                        <CopyButton text={row.suggestedMessage} />
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEditRules && !noRules ? (
            <button type="button" onClick={() => setShowRules((s) => !s)} className="mt-3 text-[12px] font-medium text-au-ink-5b6cff">
              {showRules ? 'Ocultar duración de productos' : 'Editar duración de productos'}
            </button>
          ) : null}
          {showRules ? (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <RulesEditor onSaved={reload} />
            </div>
          ) : null}
          <SourceNote>
            último pedido de cada cliente con ese producto (pedidos de los últimos {nf.format(data.lookbackDays)} días, sin cancelados) + la
            duración que configuraste; también muestra a quienes se les acabó hace hasta {nf.format(data.overdueDays)} días. Nada se envía
            solo.
          </SourceNote>
        </>
      ) : null}
    </StatsCard>
  )
}

// ── Repeat buyers ────────────────────────────────────────────────────────────────────────────────

function RepeatSection() {
  const { settings } = useTenantSettings()
  const symbol = settings.currencySymbol || '₡'
  const [sort, setSort] = useState<string>('recientes')
  const [page, setPage] = useState(0)
  const [res, reload] = useInsightsJson<RepeatPayload>(`/api/estadisticas/clientes/recurrentes?orden=${sort}&pagina=${page}`)
  const data = res.data
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0
  const choose = useCallback((key: string) => {
    setSort(key)
    setPage(0)
  }, [])

  return (
    <StatsCard title="Clientes que repiten" subtitle="Compraron 2 veces o más" state={res.state} onRetry={reload} skeletonClass="h-[220px]">
      {data ? (
        <>
          <div className="-mx-1 mb-3 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]" role="group" aria-label="Ordenar">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={sort === s.key}
                onClick={() => choose(s.key)}
                className={`min-h-[34px] shrink-0 whitespace-nowrap rounded-lg px-3 text-[12px] font-medium ${sort === s.key ? 'bg-au-tint-eef0ff text-au-ink-5b6cff' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {data.rows.length === 0 ? (
            <AuroraEmptyState
              tone="neutral"
              icon={<Repeat className="h-6 w-6" />}
              title="Todavía nadie ha comprado dos veces"
              description="Cuando un cliente haga su segundo pedido, aparece aquí para que no se te pierda."
              className="py-6"
            />
          ) : (
            <>
              <p className="mb-2 text-[12px] text-slate-500">{nf.format(data.total)} clientes</p>
              <ul className="divide-y divide-slate-100" data-testid="repeat-list">
                {data.rows.map((row) => (
                  <li key={row.clientId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-slate-900">{row.name}</p>
                      <p className="text-[12px] text-slate-500">
                        {nf.format(row.totalOrders)} pedidos · {formatCompactMoney(row.totalSpent, symbol)} en total · último{' '}
                        {formatDayLabel(row.lastOrder)} ({row.daysSinceLast === 0 ? 'hoy' : `hace ${nf.format(row.daysSinceLast)} días`})
                      </p>
                    </div>
                    <div className="shrink-0">
                      <ChatLink href={row.chatHref} whatsappHref={row.whatsappHref} />
                    </div>
                  </li>
                ))}
              </ul>
              {pages > 1 ? (
                <div className="mt-3 flex items-center justify-between text-[12px]">
                  <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="min-h-[36px] rounded-lg px-3 font-medium text-slate-600 disabled:opacity-40">
                    Anterior
                  </button>
                  <span className="text-slate-400">
                    Página {page + 1} de {pages}
                  </span>
                  <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="min-h-[36px] rounded-lg px-3 font-medium text-slate-600 disabled:opacity-40">
                    Siguiente
                  </button>
                </div>
              ) : null}
            </>
          )}
          <SourceNote>ficha de cada cliente (pedidos y total gastado que Betsy lleva por cliente; puede no incluir pedidos sin cliente asignado)</SourceNote>
        </>
      ) : null}
    </StatsCard>
  )
}

function View() {
  const { data: session } = useSession()
  const canSeeCustomers = hasSessionPermission(session, 'view_sales')
  const canEditRules = hasSessionPermission(session, 'update_config')
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="insights-customers">
      <InsightsHeader title="Clientes" subtitle="A quién escribirle hoy para que vuelva a comprar" />
      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 pb-6 pt-5 md:px-7">
        {session && !canSeeCustomers ? (
          <AuroraEmptyState tone="neutral" icon="🔒" title="Sin acceso a clientes" description="Tu rol no puede ver datos de clientes." />
        ) : session ? (
          <>
            <ReorderSection canEditRules={canEditRules} />
            <RepeatSection />
          </>
        ) : null}
      </div>
    </div>
  )
}

export function CustomersView() {
  return (
    <Suspense fallback={null}>
      <View />
    </Suspense>
  )
}
