'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Edit3, Loader2, Package, RefreshCw, Search } from 'lucide-react'
import { useSalesStream } from '@/app/hooks/useSalesStream'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { useUpdateOrderStatus } from '@/app/hooks/useOrderMutations'
import { useToast } from '@/app/hooks/use-toast'
import { MobileOrderCard } from '@/app/components/ui/MobileOrderCard'
import { SwipeableRow } from '@/app/components/ui/SwipeableRow'
import { OrderDetails } from '@/app/produccion/components/OrderDetail'
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
import {
  PEDIDOS_TABS,
  countByTab,
  matchesTab,
  paginate,
  searchPedidos,
  summarizePedidos,
  type PedidosTab,
} from '@/lib/pedidos-aurora'

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

export const PedidosBoard = React.memo(function PedidosBoard({
  onCreate,
}: {
  onCreate: () => void
}) {
  const [range, setRange] = useState<RangeKey>('hoy')
  const [tab, setTab] = useState<PedidosTab>('todos')
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null)
  const { formatCurrency } = useTenantSettings()
  const { toast } = useToast()
  const updateStatus = useUpdateOrderStatus()

  const rangeMeta = RANGES.find((r) => r.key === range) ?? RANGES[0]
  const filters = useMemo(() => getRangeCR(rangeMeta.days), [rangeMeta.days])
  const { sales, isLoading, error, refresh } = useSalesStream({
    pollingInterval: 30000,
    filters,
  })

  const kpis = useMemo(() => summarizePedidos(sales), [sales])
  const tabCounts = useMemo(() => countByTab(sales), [sales])
  const visible = useMemo(
    () => searchPedidos(sales.filter((s) => matchesTab(s, tab)), searchTerm),
    [sales, tab, searchTerm],
  )
  const paged = paginate(visible, page, PAGE_SIZE)

  useEffect(() => {
    setPage(1)
  }, [tab, searchTerm, range])

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

  const openOrder = (orderId: string) => {
    const sale = sales.find((s) => s.orderId === orderId)
    if (sale) setSelectedSale(sale)
  }

  const filtersActive = tab !== 'todos' || searchTerm.trim() !== ''
  const clearFilters = () => {
    setTab('todos')
    setSearchTerm('')
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

          <div className="flex items-center gap-2">
            <label className="relative min-w-0 flex-1 lg:w-64 lg:flex-none">
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
            <select
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKey)}
              aria-label="Rango de fechas"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 outline-none focus:border-[#5B6CFF]"
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
            />

            {/* Mobile: swipeable cards (same behaviour as before the skin) */}
            <div className="space-y-2 px-3 pb-3 md:hidden">
              {paged.items.map((sale) => (
                <SwipeableRow
                  key={sale.orderId}
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
                    onAction: () => setSelectedSale(sale),
                  }}
                >
                  <MobileOrderCard order={sale} formatCurrency={formatCurrency} />
                </SwipeableRow>
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

      {selectedSale && (
        <OrderDetails
          order={selectedSale}
          onClose={() => setSelectedSale(null)}
          onUpdateStatus={handleStatusUpdate}
          onUpdateOrder={handleOrderUpdate}
        />
      )}
    </div>
  )
})
