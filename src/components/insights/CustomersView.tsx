'use client'

/**
 * Estadísticas › Clientes: who is about to run out (reorder reminders) and who buys again (repeat buyers).
 * Nothing is sent automatically: "Abrir chat" opens the inbox and the suggested message is copied (Lane E2).
 */
import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Lock,
  MessageCircle,
  MessageSquareText,
  Moon,
  Plus,
  RefreshCw,
  Repeat,
  Settings2,
  ShoppingBag,
  Trash2,
} from 'lucide-react'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { AuroraEmptyState } from '@/components/aurora/states'
import { hasSessionPermission } from '@/lib/session-permissions'
import { formatCompactMoney, formatDayLabel } from '@/lib/statistics-aurora'
import { daysBetweenKeys, REORDER_LIMITS, type ReorderRule } from '@/lib/insights/reorder'
import { InsightsHeader, SourceNote, nf, useInsightsJson } from './InsightsShared'
import { InsightCard, Meter, SERIES, Segmented, StatTile, StatusChip, type ChipTone } from './charts'

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

const WINDOWS = [
  { key: '7', label: '7 días' },
  { key: '14', label: '14 días' },
  { key: '30', label: '30 días' },
] as const
type WindowKey = (typeof WINDOWS)[number]['key']
const SORTS = [
  { key: 'recientes', label: 'Compraron hace poco' },
  { key: 'gasto', label: 'Más gastaron' },
  { key: 'pedidos', label: 'Más pedidos' },
  { key: 'dormidos', label: 'Hace rato no compran' },
] as const
type SortKey = (typeof SORTS)[number]['key']

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

function dueTone(daysLeft: number): ChipTone {
  if (daysLeft < 0) return 'critical'
  if (daysLeft <= 3) return 'warning'
  return 'info'
}

/** How much of the supply is used up (1 = ran out), for the meter. */
function supplyUsed(row: DueRow, todayKey: string): number {
  const total = daysBetweenKeys(row.lastOrderDate, row.runsOutOn)
  const used = daysBetweenKeys(row.lastOrderDate, todayKey)
  return total > 0 ? Math.min(1, Math.max(0, used / total)) : 1
}

function Initial({ name }: { name: string }) {
  const letter = name.replace(/^@/, '').trim().charAt(0).toUpperCase() || '?'
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-au-tint-eef0ff text-[13px] font-semibold text-au-ink-5b6cff" aria-hidden>
      {letter}
    </span>
  )
}

function ReorderSection({ canEditRules }: { canEditRules: boolean }) {
  const [days, setDays] = useState<WindowKey>('7')
  const [showRules, setShowRules] = useState(false)
  const [res, reload] = useInsightsJson<DuePayload>(`/api/estadisticas/clientes/recompra?dias=${days}`)
  const [openMsg, setOpenMsg] = useState<string | null>(null)
  const data = res.data
  const noRules = data ? data.rules.length === 0 : false
  const overdue = data ? data.rows.filter((r) => r.daysLeft < 0).length : 0
  const soon = data ? data.rows.length - overdue : 0

  return (
    <InsightCard
      icon={RefreshCw}
      title="Por recomprar"
      subtitle="Clientes a los que se les acaba el producto pronto"
      state={res.state}
      onRetry={reload}
      skeletonClass="h-[220px]"
      right={<Segmented value={days} options={WINDOWS} onChange={setDays} label="Próximos días" />}
      footer={
        data ? (
          <SourceNote>
            último pedido de cada cliente con ese producto (pedidos de los últimos {nf.format(data.lookbackDays)} días, sin cancelados) + la
            duración que configuraste; también muestra a quienes se les acabó hace hasta {nf.format(data.overdueDays)} días. Nada se envía
            solo.
          </SourceNote>
        ) : undefined
      }
      testId="reorder-card"
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
                  <button type="button" onClick={() => setShowRules(true)} className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#5B6CFF] px-4 text-[12.5px] font-semibold text-white">
                    <Settings2 className="h-4 w-4" aria-hidden /> Configurar duración
                  </button>
                ) : !canEditRules ? (
                  <p className="mt-2 text-[11.5px] text-slate-400">Pedile a quien administra Betsy que configure la duración.</p>
                ) : null
              }
            />
          ) : data.rows.length === 0 ? (
            <AuroraEmptyState
              tone="neutral"
              icon={<CheckCircle2 className="h-6 w-6" />}
              title={`Nadie se queda sin producto en los próximos ${data.windowDays} días`}
              description="Probá con un rango más largo o revisá la duración de tus productos."
              className="py-6"
            />
          ) : (
            <>
              <dl className="mb-4 grid grid-cols-2 gap-2.5">
                <StatTile icon={AlertTriangle} tone="pink" label="Ya se les acabó" value={nf.format(overdue)} hint={`hasta ${nf.format(data.overdueDays)} días atrás`} />
                <StatTile icon={Clock} tone="amber" label="Se les acaba pronto" value={nf.format(soon)} hint={`en los próximos ${nf.format(data.windowDays)} días`} />
              </dl>
              <ul className="divide-y divide-slate-100" data-testid="reorder-list">
                {data.rows.map((row) => (
                  <li key={row.key} className="py-3.5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <Initial name={row.customerName} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[13.5px] font-semibold text-slate-900">{row.customerName}</p>
                            <StatusChip tone={dueTone(row.daysLeft)}>{dueLabel(row.daysLeft)}</StatusChip>
                          </div>
                          <p className="mt-0.5 text-[12px] text-slate-500">
                            {row.ruleLabel} · {nf.format(row.units)} {row.units === 1 ? 'unidad' : 'unidades'} · pedido #{row.lastOrderNumber} del{' '}
                            {formatDayLabel(row.lastOrderDate)}
                          </p>
                          <div className="mt-2 max-w-[320px]">
                            <Meter
                              value={supplyUsed(row, data.todayKey)}
                              tone={row.daysLeft < 0 ? 'critical' : row.daysLeft <= 3 ? 'warning' : 'brand'}
                              label={`Producto usado de ${row.customerName}`}
                            />
                            <p className="mt-1 text-[10.5px] text-slate-400">Se acaba el {formatDayLabel(row.runsOutOn)}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2 pl-12 sm:pl-0">
                        <ChatLink href={row.chatHref} whatsappHref={row.whatsappHref} />
                        <button
                          type="button"
                          onClick={() => setOpenMsg((k) => (k === row.key ? null : row.key))}
                          aria-expanded={openMsg === row.key}
                          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <MessageSquareText className="h-4 w-4" aria-hidden />
                          Mensaje sugerido
                        </button>
                      </div>
                    </div>
                    {openMsg === row.key ? (
                      <div className="ml-0 mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:ml-12">
                        <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700">{row.suggestedMessage}</p>
                        <div className="mt-2">
                          <CopyButton text={row.suggestedMessage} />
                        </div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
          {canEditRules && !noRules ? (
            <button type="button" onClick={() => setShowRules((s) => !s)} className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-au-ink-5b6cff">
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
              {showRules ? 'Ocultar duración de productos' : 'Editar duración de productos'}
            </button>
          ) : null}
          {showRules ? (
            <div className="mt-3 border-t border-slate-100 pt-3">
              <RulesEditor onSaved={reload} />
            </div>
          ) : null}
        </>
      ) : null}
    </InsightCard>
  )
}

// ── Repeat buyers ────────────────────────────────────────────────────────────────────────────────

function RepeatSection() {
  const { settings } = useTenantSettings()
  const symbol = settings.currencySymbol || '₡'
  const [sort, setSort] = useState<SortKey>('recientes')
  const [page, setPage] = useState(0)
  const [res, reload] = useInsightsJson<RepeatPayload>(`/api/estadisticas/clientes/recurrentes?orden=${sort}&pagina=${page}`)
  const data = res.data
  const pages = data ? Math.ceil(data.total / data.pageSize) : 0
  const maxSpent = data ? data.rows.reduce((m, r) => Math.max(m, r.totalSpent), 0) : 0
  const choose = useCallback((key: SortKey) => {
    setSort(key)
    setPage(0)
  }, [])

  return (
    <InsightCard
      icon={Repeat}
      title="Clientes que repiten"
      subtitle={data ? `${nf.format(data.total)} clientes compraron 2 veces o más` : 'Compraron 2 veces o más'}
      state={res.state}
      onRetry={reload}
      skeletonClass="h-[240px]"
      right={<Segmented value={sort} options={SORTS} onChange={choose} label="Ordenar" />}
      footer={<SourceNote>ficha de cada cliente (pedidos y total gastado que Betsy lleva por cliente; puede no incluir pedidos sin cliente asignado)</SourceNote>}
      testId="repeat-card"
    >
      {data ? (
        data.rows.length === 0 ? (
          <AuroraEmptyState
            tone="neutral"
            icon={<Repeat className="h-6 w-6" />}
            title="Todavía nadie ha comprado dos veces"
            description="Cuando un cliente haga su segundo pedido, aparece aquí para que no se te pierda."
            className="py-6"
          />
        ) : (
          <>
            <ul className="divide-y divide-slate-100" data-testid="repeat-list">
              {data.rows.map((row) => (
                <li key={row.clientId} className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Initial name={row.name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13.5px] font-semibold text-slate-900">{row.name}</p>
                        <StatusChip tone="info" icon={ShoppingBag}>
                          {nf.format(row.totalOrders)} pedidos
                        </StatusChip>
                        {row.daysSinceLast > 60 ? (
                          <StatusChip tone="neutral" icon={Moon}>
                            Hace rato no compra
                          </StatusChip>
                        ) : null}
                      </div>
                      <div className="mt-2 max-w-[360px]">
                        <div className="flex items-baseline justify-between text-[12px]">
                          <span className="text-slate-500">Total gastado</span>
                          <span className="font-semibold tabular-nums text-slate-900">{formatCompactMoney(row.totalSpent, symbol)}</span>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-r-[4px] bg-slate-100/80">
                          <div
                            className={`${SERIES[1]} h-full rounded-r-[4px] bg-current`}
                            style={{ width: `${maxSpent > 0 ? Math.max(row.totalSpent > 0 ? 2 : 0, (row.totalSpent / maxSpent) * 100) : 0}%` }}
                          />
                        </div>
                        <p className="mt-1 text-[10.5px] text-slate-400">
                          Último pedido el {formatDayLabel(row.lastOrder)} ({row.daysSinceLast === 0 ? 'hoy' : `hace ${nf.format(row.daysSinceLast)} días`})
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 pl-12 sm:pl-0">
                    <ChatLink href={row.chatHref} whatsappHref={row.whatsappHref} />
                  </div>
                </li>
              ))}
            </ul>
            {pages > 1 ? (
              <div className="mt-3 flex items-center justify-between text-[12px]">
                <button
                  type="button"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-3 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden /> Anterior
                </button>
                <span className="tabular-nums text-slate-400">
                  Página {page + 1} de {pages}
                </span>
                <button
                  type="button"
                  disabled={page + 1 >= pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-3 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  Siguiente <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : null}
          </>
        )
      ) : null}
    </InsightCard>
  )
}

function View() {
  const { data: session } = useSession()
  const canSeeCustomers = hasSessionPermission(session, 'view_sales')
  const canEditRules = hasSessionPermission(session, 'update_config')
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="insights-customers">
      <InsightsHeader title="Clientes" subtitle="A quién escribirle hoy para que vuelva a comprar" />
      <div className="mx-auto w-full max-w-[1200px] space-y-4 px-4 pb-8 pt-5 md:px-7">
        {session && !canSeeCustomers ? (
          <AuroraEmptyState tone="neutral" icon={<Lock className="h-6 w-6" />} title="Sin acceso a clientes" description="Tu rol no puede ver datos de clientes." />
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
