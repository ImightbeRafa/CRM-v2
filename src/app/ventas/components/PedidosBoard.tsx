'use client'

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, Edit3, Loader2, Package, RefreshCw, Search } from 'lucide-react'
import { parseOrder, useSalesStream } from '@/app/hooks/useSalesStream'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { useUpdateOrderStatus } from '@/app/hooks/useOrderMutations'
import { useToast } from '@/app/hooks/use-toast'
import { MobileOrderCard } from '@/app/components/ui/MobileOrderCard'
import { SwipeableRow } from '@/app/components/ui/SwipeableRow'
import type { Sale } from '@/app/produccion/types/sales'
import {
  AuroraEmptyState,
  AuroraErrorState,
  AuroraListSkeleton,
  auroraButtonSecondary,
} from '@/components/aurora/states'
import { PedidosKpiCards } from '@/components/aurora/pedidos/PedidosKpiCards'
import { PedidosTable } from '@/components/aurora/pedidos/PedidosTable'
import { PedidosPager } from '@/components/aurora/pedidos/PedidosPager'
import { PedidoDetailDrawer } from '@/components/aurora/pedidos/PedidoDetailDrawer'
import { useOrderLines } from '@/app/ventas/components/useOrderLines'
import {
  LINE_FILTER_ALL,
  LINE_FILTER_MANUAL,
  distinctLines,
  filterByLine,
} from '@/lib/order-channel-line'
import { resolvePedidoRef } from '@/lib/pedido-url'
import {
  PEDIDOS_TABS,
  countByTab,
  matchesTab,
  paginate,
  searchPedidos,
  summarizePedidos,
  type PedidosTab,
} from '@/lib/pedidos-aurora'

// Classic dialogs reused unchanged for editing and guía generation; loaded on demand.
const OrderDetails = lazy(() =>
  import('@/app/produccion/components/OrderDetail').then((m) => ({ default: m.OrderDetails })),
)
const GuiaGenerator = lazy(() =>
  import('@/app/produccion/components/GuiaGenerator').then((m) => ({ default: m.GuiaGenerator })),
)

const CR_TZ = 'America/Costa_Rica'
const PAGE_SIZE = 10

type RangeKey = 'hoy' | '7d' | '30d'
const RANGES: Array<{ key: RangeKey; label: string; kpiLabel: string; days: number }> = [
  { key: 'hoy', label: 'Hoy', kpiLabel: 'hoy', days: 1 },
  { key: '7d', label: 'Últimos 7 días', kpiLabel: '7 días', days: 7 },
  { key: '30d', label: 'Últimos 30 días', kpiLabel: '30 días', days: 30 },
]

/** Costa Rica is UTC-6 year-round: local midnight = 06:00Z. */
function getRangeCR(days: number) {
  const [year, month, day] = new Date()
    .toLocaleDateString('en-CA', { timeZone: CR_TZ })
    .split('-')
    .map(Number)
  const todayStart = Date.UTC(year, month - 1, day, 6, 0, 0, 0)
  const start = todayStart - (days - 1) * 24 * 60 * 60 * 1000
  const end = todayStart + 24 * 60 * 60 * 1000 - 1
  return { dateFrom: new Date(start).toISOString(), dateTo: new Date(end).toISOString() }
}

async function fetchSaleList(path: string): Promise<Sale[]> {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) throw new Error(String(res.status))
  const json = await res.json()
  const rows = Array.isArray(json?.data) ? json.data : []
  return rows.map(parseOrder).filter((s: Sale | null): s is Sale => s !== null)
}

export const PedidosBoard = React.memo(function PedidosBoard({
  onCreate,
  initialSearch,
  pedidoRef,
  onPedidoChange,
}: {
  onCreate: () => void
  /** `?buscar=` deep link seeds the Pedidos search. */
  initialSearch?: string | null
  /** `?pedido=` deep link (public orderId or Order.id). */
  pedidoRef?: string | null
  /** Keep the URL in sync when the drawer opens / closes. */
  onPedidoChange?: (ref: string | null) => void
}) {
  const [range, setRange] = useState<RangeKey>(initialSearch ? '30d' : 'hoy')
  const [tab, setTab] = useState<PedidosTab>('todos')
  const [searchTerm, setSearchTerm] = useState(initialSearch ?? '')
  const [lineFilter, setLineFilter] = useState<string>(LINE_FILTER_ALL)
  const [page, setPage] = useState(1)
  const [selectedRef, setSelectedRef] = useState<string | null>(pedidoRef ?? null)
  const [resolvedSale, setResolvedSale] = useState<Sale | null>(null)
  const [editing, setEditing] = useState(false)
  const [guiaOpen, setGuiaOpen] = useState(false)
  const resolvingRef = useRef<string | null>(null)
  const { formatCurrency } = useTenantSettings()
  const { toast } = useToast()
  const updateStatus = useUpdateOrderStatus()

  const rangeMeta = RANGES.find((r) => r.key === range) ?? RANGES[0]
  const filters = useMemo(() => getRangeCR(rangeMeta.days), [rangeMeta.days])
  const { sales, isLoading, error, refresh } = useSalesStream({
    pollingInterval: 30000,
    filters,
  })

  const lines = useOrderLines(useMemo(() => sales.map((s) => s.id).filter(Boolean), [sales]))
  const lineOptions = useMemo(() => distinctLines(lines), [lines])

  const kpis = useMemo(() => summarizePedidos(sales), [sales])
  const tabCounts = useMemo(() => countByTab(sales), [sales])
  const visible = useMemo(
    () => filterByLine(searchPedidos(sales.filter((s) => matchesTab(s, tab)), searchTerm), lines, lineFilter),
    [sales, tab, searchTerm, lines, lineFilter],
  )
  const paged = paginate(visible, page, PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [tab, searchTerm, range, lineFilter])

  // /ventas?buscar=<q> while already on this page.
  useEffect(() => {
    if (initialSearch) {
      setSearchTerm(initialSearch)
      setRange('30d')
    }
  }, [initialSearch])

  // Keep the drawer in sync with `?pedido=` (deep link, browser back).
  useEffect(() => {
    setSelectedRef(pedidoRef ?? null)
  }, [pedidoRef])
  useEffect(() => {
    if (!selectedRef) resolvingRef.current = null
  }, [selectedRef])

  const selectedSale = useMemo(() => {
    if (!selectedRef) return null
    return sales.find((s) => s.orderId === selectedRef || s.id === selectedRef) ?? (
      resolvedSale && (resolvedSale.orderId === selectedRef || resolvedSale.id === selectedRef) ? resolvedSale : null
    )
  }, [sales, selectedRef, resolvedSale])

  // Deep link to an order outside the loaded range: search by public id, then details by cuid.
  useEffect(() => {
    if (!selectedRef || isLoading || selectedSale || resolvingRef.current === selectedRef) return
    resolvingRef.current = selectedRef
    resolvePedidoRef<Sale>(selectedRef, {
      loaded: sales,
      search: (ref) => fetchSaleList(`/api/orders?search=${encodeURIComponent(ref)}&limit=5`),
      details: async (ref) => {
        const res = await fetch(`/api/orders/details?id=${encodeURIComponent(ref)}`, { credentials: 'include' })
        if (!res.ok) return null
        const json = await res.json()
        return parseOrder(json?.data) ?? null
      },
    }).then((sale) => {
      if (sale) {
        setResolvedSale(sale)
      } else {
        toast({ variant: 'destructive', title: 'No encontramos ese pedido' })
        setSelectedRef(null)
        onPedidoChange?.(null)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRef, isLoading, selectedSale])

  const handleOrderUpdate = async (orderId: string, updatedData: Partial<Sale>): Promise<Sale> => {
    const response = await fetch('/api/orders/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ orderId, ...updatedData }),
    })
    const errorData = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(errorData.error || 'No se pudo actualizar el pedido')
    }
    refresh()
    toast({ title: 'Pedido actualizado', description: 'Los cambios se guardaron.' })
    return errorData.data || errorData
  }

  const handleStatusUpdate = async (newStatus: string) => {
    if (!selectedSale) return
    await handleOrderUpdate(selectedSale.orderId, { status: newStatus } as Partial<Sale>)
  }

  const openOrder = useCallback(
    (orderId: string) => {
      setSelectedRef(orderId)
      onPedidoChange?.(orderId)
    },
    [onPedidoChange],
  )

  const closeOrder = useCallback(() => {
    setSelectedRef(null)
    setEditing(false)
    setGuiaOpen(false)
    onPedidoChange?.(null)
  }, [onPedidoChange])

  const filtersActive = tab !== 'todos' || searchTerm.trim() !== '' || lineFilter !== LINE_FILTER_ALL
  const clearFilters = () => {
    setTab('todos')
    setSearchTerm('')
    setLineFilter(LINE_FILTER_ALL)
  }

  return (
    <div className="space-y-4" data-testid="pedidos-board">
      {!isLoading && !error ? (
        <PedidosKpiCards kpis={kpis} rangeLabel={rangeMeta.kpiLabel} formatCurrency={formatCurrency} />
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">
        <div className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between lg:px-5">
          <div
            role="tablist"
            aria-label="Filtrar pedidos"
            className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1"
          >
            {PEDIDOS_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                  tab === t.key
                    ? 'bg-white font-semibold text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                <span className={`text-[11px] ${tab === t.key ? 'text-[#5B6CFF]' : 'text-slate-400'}`}>
                  {tabCounts[t.key]}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto lg:w-64 lg:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar nombre, pedido o teléfono"
                aria-label="Buscar pedidos"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-9 pr-3 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#5B6CFF] focus:bg-white"
              />
            </label>
            {lineOptions.length > 0 ? (
              <select
                value={lineFilter}
                onChange={(e) => setLineFilter(e.target.value)}
                aria-label="Filtrar por línea"
                className="h-9 min-w-0 max-w-[170px] flex-1 rounded-lg sm:flex-none border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 outline-none focus:border-[#5B6CFF]"
              >
                <option value={LINE_FILTER_ALL}>Todas las líneas</option>
                {lineOptions.map((line) => (
                  <option key={line.socialAccountId} value={line.socialAccountId}>
                    {line.title}
                  </option>
                ))}
                <option value={LINE_FILTER_MANUAL}>Manual</option>
              </select>
            ) : null}
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKey)}
              aria-label="Rango de fechas"
              className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 outline-none focus:border-[#5B6CFF] sm:flex-none"
            >
              {RANGES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={refresh}
              disabled={isLoading}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
              aria-label="Actualizar pedidos"
              title="Actualizar"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {isLoading ? (
          <AuroraListSkeleton rows={6} label="Cargando pedidos" />
        ) : error ? (
          <AuroraErrorState
            title="No pudimos cargar los pedidos"
            description={error}
            onRetry={refresh}
          />
        ) : visible.length === 0 ? (
          <AuroraEmptyState
            icon={<Package className="h-6 w-6" />}
            title={filtersActive ? 'Sin resultados' : `Sin pedidos ${rangeMeta.key === 'hoy' ? 'hoy' : 'en este rango'}`}
            description={
              filtersActive
                ? 'Ningún pedido coincide con los filtros actuales.'
                : 'Cuando entre un pedido aparecerá aquí.'
            }
            actions={
              filtersActive ? (
                <button type="button" onClick={clearFilters} className={auroraButtonSecondary}>
                  Limpiar filtros
                </button>
              ) : (
                <button type="button" onClick={onCreate} className={auroraButtonSecondary}>
                  Crear pedido
                </button>
              )
            }
          />
        ) : (
          <>
            <PedidosTable
              rows={paged.items}
              formatCurrency={formatCurrency}
              selectedId={selectedSale?.orderId}
              onOpen={openOrder}
              lines={lines}
            />

            {/* Mobile: swipeable cards (same behaviour as before the skin) */}
            <div className="space-y-2 px-3 pb-3 md:hidden">
              {paged.items.map((sale) => (
                <div key={sale.orderId}>
                <SwipeableRow
                  leftAction={{
                    label: 'Completar',
                    icon: <CheckCircle className="h-5 w-5" />,
                    color: '#10b981',
                    onAction: () =>
                      updateStatus.mutate({
                        orderId: sale.orderId,
                        status: 'Completado',
                        expectedStatus: sale.status,
                        expectedUpdatedAt: sale.updatedAt,
                      }),
                  }}
                  rightAction={{
                    label: 'Detalles',
                    icon: <Edit3 className="h-5 w-5" />,
                    color: '#5B6CFF',
                    onAction: () => openOrder(sale.orderId),
                  }}
                >
                  <MobileOrderCard order={sale} formatCurrency={formatCurrency} />
                </SwipeableRow>
                <button
                  type="button"
                  onClick={() => openOrder(sale.orderId)}
                  className="mt-1 ml-auto block px-1 py-1 text-[12px] font-medium text-[#5B3FE0]"
                >
                  Ver detalle
                </button>
                </div>
              ))}
            </div>

            <PedidosPager
              page={paged.page}
              totalPages={paged.totalPages}
              shown={paged.items.length}
              total={paged.total}
              onPage={setPage}
            />
          </>
        )}
      </section>

      {selectedSale && !editing && !guiaOpen ? (
        <PedidoDetailDrawer
          sale={selectedSale}
          line={lines[selectedSale.id] ?? null}
          onClose={closeOrder}
          onEdit={() => setEditing(true)}
          onGenerateGuia={() => setGuiaOpen(true)}
          onUpdated={refresh}
        />
      ) : null}

      {/* Classic dialogs, reused unchanged. The drawer steps aside while one is open. */}
      {selectedSale && editing ? (
        <Suspense fallback={null}>
          <OrderDetails
            order={selectedSale}
            onClose={() => setEditing(false)}
            onUpdateStatus={handleStatusUpdate}
            onUpdateOrder={handleOrderUpdate}
          />
        </Suspense>
      ) : null}
      {selectedSale && guiaOpen ? (
        <Suspense fallback={null}>
          <GuiaGenerator
            open
            orders={[selectedSale]}
            onClose={() => {
              setGuiaOpen(false)
              refresh()
            }}
            onUpdateOrder={handleOrderUpdate}
          />
        </Suspense>
      ) : null}
    </div>
  )
})
