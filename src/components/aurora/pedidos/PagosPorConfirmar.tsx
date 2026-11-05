'use client'

import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Banknote, Check, ChevronDown, CheckCircle2, Loader2, RefreshCw, Smartphone, Wallet, X } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { ShipPill } from '@/components/aurora/pedidos/PedidoChips'
import { emitBetsySignal } from '@/components/brand/betsy-signals'
import { useToast } from '@/app/hooks/use-toast'
import type { Sale } from '@/app/produccion/types/sales'
import { shipChip } from '@/lib/pedidos-aurora'
import { formatOrderItems } from '@/lib/orders/order-items'
import { orderLabel, orderLabelHash } from '@/lib/orders/order-label'
import { daysWaiting, pendingPaymentKind, type PendingPaymentKind } from '@/lib/orders/pending-payments'

type Filter = 'todos' | PendingPaymentKind

const KIND_LABEL: Record<PendingPaymentKind, string> = { contra_entrega: 'Contra entrega', sinpe: 'SINPE' }
const COLLAPSED_ROWS = 6

function initials(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase()
}

function waitingLabel(days: number | null): { text: string; tone: string } {
  if (days === null) return { text: '—', tone: 'text-slate-500' }
  const text = days === 0 ? 'Hoy' : days === 1 ? 'Ayer' : `Hace ${days} días`
  const tone = days >= 14 ? 'text-red-600 font-semibold' : days >= 7 ? 'text-amber-600 font-medium' : 'text-slate-500'
  return { text, tone }
}

function itemsSummary(sale: Sale): string {
  const lines = formatOrderItems(sale).map((line) => line.label)
  if (lines.length === 0) return sale.product || '—'
  return lines.length > 1 ? `${lines[0]} +${lines.length - 1}` : lines[0]
}

export type PendingPaymentRow = { sale: Sale; kind: PendingPaymentKind; days: number | null }

/** Oldest first: whoever has waited longest gets chased first. */
export function toPendingPaymentRows(sales: Sale[], now: Date = new Date()): PendingPaymentRow[] {
  return sales
    .map((sale) => ({ sale, kind: pendingPaymentKind(sale), days: daysWaiting(sale.timestamp, now) }))
    .filter((row): row is PendingPaymentRow => row.kind !== null)
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
}

/**
 * Pedidos › "Pagos por confirmar": every order whose money still needs a person, whatever day it was
 * sold (the list below only shows the chosen range). Contra entrega + SINPE waiting for the receipt,
 * one click to confirm, same endpoint as the order drawer.
 */
export const PagosPorConfirmar = forwardRef<HTMLElement, {
  rows: PendingPaymentRow[]
  loading: boolean
  error: string | null
  open: boolean
  onToggle: () => void
  onRetry: () => void
  onConfirmed: () => void
  onOpenOrder: (orderId: string) => void
  canConfirm: boolean
  formatCurrency: (n: number) => string
  initialFilter?: PendingPaymentKind
}>(function PagosPorConfirmar(
  { rows, loading, error, open, onToggle, onRetry, onConfirmed, onOpenOrder, canConfirm, formatCurrency, initialFilter },
  ref,
) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<Filter>(initialFilter ?? 'todos')
  useEffect(() => {
    if (initialFilter) setFilter(initialFilter)
  }, [initialFilter])
  const [asking, setAsking] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<Set<string>>(() => new Set())

  const live = useMemo(() => rows.filter((row) => !done.has(row.sale.orderId)), [rows, done])
  const totals = useMemo(() => {
    const sum = (kind?: PendingPaymentKind) =>
      live.filter((r) => !kind || r.kind === kind).reduce((acc, r) => acc + (Number(r.sale.total) || 0), 0)
    return {
      all: { n: live.length, amount: sum() },
      contra_entrega: { n: live.filter((r) => r.kind === 'contra_entrega').length, amount: sum('contra_entrega') },
      sinpe: { n: live.filter((r) => r.kind === 'sinpe').length, amount: sum('sinpe') },
      overdue: live.filter((r) => (r.days ?? 0) >= 7).length,
    }
  }, [live])
  const [showAll, setShowAll] = useState(false)
  const filtered = filter === 'todos' ? live : live.filter((r) => r.kind === filter)
  // Oldest first, a handful at a time: the section never buries the day's orders below it.
  const shown = showAll ? filtered : filtered.slice(0, COLLAPSED_ROWS)

  const confirm = async (row: PendingPaymentRow) => {
    const { orderId } = row.sale
    setBusy(orderId)
    try {
      const res = await fetch('/api/orders/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(row.kind === 'sinpe' ? { orderId, paymentType: 'sinpe' } : { orderId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'No se pudo confirmar el pago')
      }
      setDone((prev) => new Set(prev).add(orderId))
      emitBetsySignal('yes')
      toast({
        variant: 'success' as any,
        title: 'Pago confirmado',
        description: `${orderLabel(row.sale)} · ${formatCurrency(Number(row.sale.total) || 0)}`,
      })
      onConfirmed()
      // Inicio's "pagos por confirmar" card (its server cache can still lag ~30 s).
      void queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] })
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'No se pudo confirmar el pago',
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setBusy(null)
      setAsking(null)
    }
  }

  const hasPending = totals.all.n > 0

  return (
    <section
      ref={ref}
      id="pagos-por-confirmar"
      aria-labelledby="pagos-title"
      data-testid="pagos-por-confirmar"
      className="scroll-mt-4 overflow-hidden rounded-2xl border border-slate-200/70 bg-white"
    >
      <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between lg:px-5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="pagos-body"
          className="group flex min-w-0 items-center gap-3 text-left"
        >
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              hasPending ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'
            }`}
            aria-hidden
          >
            {hasPending ? <Wallet className="h-[18px] w-[18px]" /> : <CheckCircle2 className="h-[18px] w-[18px]" />}
          </span>
          <span className="min-w-0">
            <span id="pagos-title" className="flex items-center gap-2 text-[14px] font-semibold text-slate-900">
              Pagos por confirmar
              {hasPending ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-700">
                  {totals.all.n}
                </span>
              ) : null}
              {hasPending ? (
                <ChevronDown
                  className={`h-4 w-4 text-slate-500 transition-transform group-hover:text-slate-600 ${open ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              ) : null}
            </span>
            <span className="block text-[12px] text-slate-500">
              {loading && rows.length === 0
                ? 'Buscando pagos pendientes…'
                : error
                  ? 'No pudimos revisar los pagos'
                  : hasPending
                    ? `${formatCurrency(totals.all.amount)} por cobrar de cualquier día${
                        totals.overdue > 0 ? ` · ${totals.overdue} con más de 7 días` : ''
                      }`
                    : 'Todo al día: no hay contra entregas ni SINPE esperando confirmación'}
            </span>
          </span>
        </button>

        {hasPending ? (
          <div role="tablist" aria-label="Tipo de pago" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1">
            {(
              [
                { key: 'todos', label: 'Todos', n: totals.all.n },
                { key: 'contra_entrega', label: 'Contra entrega', n: totals.contra_entrega.n },
                { key: 'sinpe', label: 'SINPE', n: totals.sinpe.n },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={filter === t.key}
                onClick={() => {
                  setFilter(t.key)
                  if (!open) onToggle()
                }}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                  filter === t.key ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                <span className={`text-[11px] tabular-nums ${filter === t.key ? 'text-amber-600' : 'text-slate-500'}`}>{t.n}</span>
              </button>
            ))}
          </div>
        ) : error ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-9 items-center gap-1.5 self-start rounded-lg border border-slate-200 px-3 text-[13px] text-slate-600 hover:bg-slate-50 sm:self-auto"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Reintentar
          </button>
        ) : null}
      </div>

      {open && hasPending ? (
        <div id="pagos-body" className="border-t border-slate-100">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-2.5 font-semibold">Pedido</th>
                  <th className="px-3 py-2.5 font-semibold">Cliente</th>
                  <th className="px-3 py-2.5 font-semibold">Productos</th>
                  <th className="px-3 py-2.5 font-semibold">Pago</th>
                  <th className="px-3 py-2.5 font-semibold">Envío</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Monto</th>
                  <th className="px-3 py-2.5 font-semibold">Esperando</th>
                  <th className="px-5 py-2.5 text-right font-semibold">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((row) => {
                  const { sale } = row
                  const wait = waitingLabel(row.days)
                  return (
                    <tr key={sale.orderId} className="text-[13px] transition-colors hover:bg-slate-50/70">
                      <td className="whitespace-nowrap px-5 py-3">
                        <button
                          type="button"
                          onClick={() => onOpenOrder(sale.orderId)}
                          className="font-semibold text-slate-900 hover:text-au-ink-5b6cff"
                        >
                          {orderLabelHash(sale)}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10.5px] font-semibold text-slate-600" aria-hidden>
                            {initials(sale.customerName)}
                          </span>
                          <span className="min-w-0">
                            <span className="block max-w-[180px] truncate font-medium text-slate-800">{sale.customerName || 'Sin nombre'}</span>
                            {sale.phone ? <span className="block text-[11.5px] text-slate-500">{sale.phone}</span> : null}
                          </span>
                        </div>
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-3 text-slate-600" title={itemsSummary(sale)}>
                        {itemsSummary(sale)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <Chip tone={row.kind === 'sinpe' ? 'info' : 'warning'} icon={row.kind === 'sinpe' ? Smartphone : Banknote}>
                          {KIND_LABEL[row.kind]}
                        </Chip>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <ShipPill chip={shipChip(sale)} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                        {formatCurrency(Number(sale.total) || 0)}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-3 text-[12.5px] ${wait.tone}`}>{wait.text}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <ConfirmControl
                          row={row}
                          canConfirm={canConfirm}
                          asking={asking === sale.orderId}
                          busy={busy === sale.orderId}
                          amount={formatCurrency(Number(sale.total) || 0)}
                          onAsk={() => setAsking(sale.orderId)}
                          onCancel={() => setAsking(null)}
                          onConfirm={() => confirm(row)}
                          onOpen={() => onOpenOrder(sale.orderId)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {shown.map((row) => {
              const { sale } = row
              const wait = waitingLabel(row.days)
              return (
                <li key={sale.orderId} className="space-y-2.5 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => onOpenOrder(sale.orderId)} className="min-w-0 text-left">
                      <span className="block truncate text-[14px] font-semibold text-slate-900">{sale.customerName || 'Sin nombre'}</span>
                      <span className="block truncate text-[12px] text-slate-500">
                        {orderLabelHash(sale)} · {itemsSummary(sale)}
                      </span>
                    </button>
                    <span className="shrink-0 text-right">
                      <span className="block text-[15px] font-semibold tabular-nums text-slate-900">
                        {formatCurrency(Number(sale.total) || 0)}
                      </span>
                      <span className={`block text-[11.5px] ${wait.tone}`}>{wait.text}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex flex-wrap gap-1.5">
                      <Chip tone={row.kind === 'sinpe' ? 'info' : 'warning'} icon={row.kind === 'sinpe' ? Smartphone : Banknote}>
                        {KIND_LABEL[row.kind]}
                      </Chip>
                      <ShipPill chip={shipChip(sale)} />
                    </span>
                    <ConfirmControl
                      row={row}
                      canConfirm={canConfirm}
                      asking={asking === sale.orderId}
                      busy={busy === sale.orderId}
                      amount={formatCurrency(Number(sale.total) || 0)}
                      onAsk={() => setAsking(sale.orderId)}
                      onCancel={() => setAsking(null)}
                      onConfirm={() => confirm(row)}
                      onOpen={() => onOpenOrder(sale.orderId)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>

          {filtered.length > COLLAPSED_ROWS ? (
            <div className="border-t border-slate-100 px-5 py-2">
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="inline-flex h-9 items-center gap-1.5 text-[13px] font-medium text-au-ink-5b6cff"
              >
                {showAll ? 'Ver menos' : `Ver los ${filtered.length}`}
                <ChevronDown className={`h-4 w-4 transition-transform ${showAll ? 'rotate-180' : ''}`} aria-hidden />
              </button>
            </div>
          ) : null}
          <p className="border-t border-slate-100 px-5 py-2.5 text-[12px] text-slate-500">
            Confirmá solo cuando el dinero ya esté en la cuenta. Contra entrega: cuando el mensajero o Correos te pague.
            SINPE: cuando veas el comprobante (últimos 60 días).
          </p>
        </div>
      ) : null}
    </section>
  )
})

function ConfirmControl({
  row,
  canConfirm,
  asking,
  busy,
  amount,
  onAsk,
  onCancel,
  onConfirm,
  onOpen,
}: {
  row: PendingPaymentRow
  canConfirm: boolean
  asking: boolean
  busy: boolean
  amount: string
  onAsk: () => void
  onCancel: () => void
  onConfirm: () => void
  onOpen: () => void
}) {
  if (!canConfirm) {
    return (
      <button type="button" onClick={onOpen} className="inline-flex h-9 items-center rounded-lg px-3 text-[13px] font-medium text-au-ink-5b6cff hover:bg-slate-50">
        Ver
      </button>
    )
  }
  if (asking || busy) {
    return (
      <span className="inline-flex items-center gap-1.5" role="group" aria-label={`¿Recibiste ${amount} de ${orderLabel(row.sale)}?`}>
        <button
          type="button"
          title={`¿Recibiste ${amount}?`}
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-emerald-600 px-3 text-[13px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}
          Sí, recibido
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          aria-label="Cancelar"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-60"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={onOpen} className="hidden h-9 items-center rounded-lg px-2.5 text-[13px] text-slate-500 hover:bg-slate-50 hover:text-slate-800 lg:inline-flex">
        Ver
      </button>
      <button
        type="button"
        onClick={onAsk}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[13px] font-semibold text-emerald-700 hover:bg-emerald-100"
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
        Confirmar pago
      </button>
    </span>
  )
}
