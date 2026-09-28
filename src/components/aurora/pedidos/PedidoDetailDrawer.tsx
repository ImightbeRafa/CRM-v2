'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Banknote, Check, Download, FileText, Loader2, MessageSquare, Pencil, Phone, Truck } from 'lucide-react'
import { AuroraDrawer } from '@/components/aurora/ui/AuroraDrawer'
import { auroraBtnPrimary, auroraBtnSecondary } from '@/components/aurora/ui/aurora-form'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import { PaymentPill, ShipPill } from '@/components/aurora/pedidos/PedidoChips'
import { useAuroraViewer } from '@/components/aurora/shell/useAuroraViewer'
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext'
import { useConfig } from '@/app/contexts/ConfigContext'
import { useUpdateOrderStatus } from '@/app/hooks/useOrderMutations'
import { useToast } from '@/app/hooks/use-toast'
import type { Sale } from '@/app/produccion/types/sales'
import { isSinpeOrder, paymentChip, shipChip } from '@/lib/pedidos-aurora'
import { canalLabel, type OrderLine } from '@/lib/order-channel-line'

const CR_TZ = 'America/Costa_Rica'

type Guia = {
  id: string
  guiaNumber: string | null
  trackingNumber: string | null
  status: string
  hasPdf: boolean
  createdAt: string
}

type ProductRow = { type?: string; cantidad?: number; color?: string; tamano?: string; productCost?: number }

function fmtDateTime(value: string | undefined | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('es-CR', { timeZone: CR_TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function parseProducts(raw: unknown): ProductRow[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ProductRow[]) : []
  } catch {
    return []
  }
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-[13px]">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 text-right font-medium text-slate-900">{children}</span>
    </div>
  )
}

type PedidoDetailDrawerProps = {
  sale: Sale
  /** Line (SocialAccount) the order came from, when a chat is linked. */
  line: OrderLine | null
  onClose: () => void
  /** Hands over to the classic edit dialog (the parent hides this drawer meanwhile). */
  onEdit: () => void
  /** Opens the existing GuiaGenerator (the parent hides this drawer meanwhile). */
  onGenerateGuia: () => void
  /** Ask the list to refetch after a write done here. */
  onUpdated: () => void
}

/** Pedido detail: right drawer on desktop, full-screen sheet on mobile. Restyle of the existing flows. */
export function PedidoDetailDrawer({ sale, line, onClose, onEdit, onGenerateGuia, onUpdated }: PedidoDetailDrawerProps) {
  const { formatCurrency } = useTenantSettings()
  const { getState } = useConfig()
  const { toast } = useToast()
  const viewer = useAuroraViewer()
  const canProduction = viewer.can('update_production')
  const canEdit = viewer.can('update_sales')
  const updateStatus = useUpdateOrderStatus()

  const statusRows = getState<Array<{ key?: string; label: string }>>('statuses').data
  const statusOptions = useMemo(() => {
    const labels = (statusRows ?? []).map((s) => s.label)
    return labels.includes(sale.status) ? labels : [sale.status, ...labels]
  }, [statusRows, sale.status])

  // Products (productDetails is excluded from the list payload; load it here).
  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [productsState, setProductsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const loadProducts = useCallback(() => {
    if (!sale.id) {
      setProductsState('ready')
      setProducts([])
      return
    }
    setProductsState('loading')
    fetch(`/api/orders/details?id=${encodeURIComponent(sale.id)}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const json = await res.json()
        setProducts(parseProducts(json?.data?.productDetails))
        setProductsState('ready')
      })
      .catch(() => setProductsState('error'))
  }, [sale.id])
  useEffect(loadProducts, [loadProducts])

  // Guía (existing shipping API; a summary without the PDF blob).
  const [guia, setGuia] = useState<Guia | null | undefined>(undefined)
  useEffect(() => {
    if (sale.orderType !== 'EA') {
      setGuia(null)
      return
    }
    let cancelled = false
    fetch(`/api/shipping/guias/status?orderIds=${encodeURIComponent(sale.orderId)}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled) return
        const first = Array.isArray(json?.data?.guias) ? json.data.guias[0] : null
        setGuia(first ?? null)
      })
      .catch(() => !cancelled && setGuia(null))
    return () => {
      cancelled = true
    }
  }, [sale.orderId, sale.orderType])

  const [confirming, setConfirming] = useState(false)
  const confirmPayment = async () => {
    setConfirming(true)
    try {
      const res = await fetch('/api/orders/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderId: sale.orderId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'No se pudo confirmar el pago')
      }
      toast({ variant: 'success' as any, title: 'Pago confirmado', description: `Pedido ${sale.orderId}` })
      onUpdated()
    } catch (error) {
      toast({ variant: 'destructive', title: 'No se pudo confirmar el pago', description: error instanceof Error ? error.message : undefined })
    } finally {
      setConfirming(false)
    }
  }

  const pay = paymentChip(sale)
  const ship = shipChip(sale)
  const canal = canalLabel(sale, line)
  const sinpe = isSinpeOrder(sale)
  const showConfirmPayment = canProduction && Boolean(sale.contraEntrega) && !sale.cePaymentConfirmed
  const address = [
    'address' in sale ? sale.address : '',
    'district' in sale ? sale.district : '',
    'canton' in sale ? sale.canton : '',
    'province' in sale ? sale.province : '',
  ]
    .filter(Boolean)
    .join(', ')

  const timeline = [
    { label: 'Pedido creado', at: fmtDateTime(sale.timestamp) },
    sale.orderType === 'EA' && sale.saleDate && fmtDateTime(sale.saleDate) !== fmtDateTime(sale.timestamp)
      ? { label: 'Fecha de venta', at: fmtDateTime(sale.saleDate) }
      : null,
    guia ? { label: `Guía generada${guia.guiaNumber ? ` · ${guia.guiaNumber}` : ''}`, at: fmtDateTime(guia.createdAt) } : null,
    sale.updatedAt && sale.updatedAt !== sale.timestamp
      ? { label: `Última actualización · ${sale.status}`, at: fmtDateTime(sale.updatedAt) }
      : null,
  ].filter((item): item is { label: string; at: string | null } => Boolean(item && item.at))

  return (
    <AuroraDrawer
      open
      onOpenChange={(open) => !open && onClose()}
      title={`#${sale.orderId}`}
      ariaTitle={`Pedido ${sale.orderId}`}
      subtitle={fmtDateTime(sale.timestamp) ?? undefined}
      headerRight={
        <span className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-semibold text-slate-700 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-[#7C5CFF]" aria-hidden />
          {sale.status}
        </span>
      }
    >
      <div className="space-y-3 px-4 py-4 sm:px-5" data-testid="pedido-detail">
        {/* Summary + actions */}
        <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Total</p>
              <p className="text-[26px] font-semibold leading-tight tracking-tight text-slate-900">
                {formatCurrency(Number(sale.total) || 0)}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              <PaymentPill chip={pay} />
              <ShipPill chip={ship} />
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            {canProduction ? (
              <label className="flex min-w-0 flex-1 items-center gap-2 text-[12px] text-slate-500">
                <span className="shrink-0">Estado</span>
                <select
                  value={sale.status}
                  disabled={updateStatus.isPending}
                  onChange={(e) =>
                    updateStatus.mutate({
                      orderId: sale.orderId,
                      status: e.target.value,
                      expectedStatus: sale.status,
                      expectedUpdatedAt: sale.updatedAt,
                    })
                  }
                  aria-label="Cambiar estado"
                  className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-900 outline-none focus:border-[#7C5CFF] focus:ring-2 focus:ring-[#7C5CFF]/20 disabled:opacity-60"
                >
                  {statusOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="flex-1 text-[13px] text-slate-500">
                Estado: <span className="font-medium text-slate-900">{sale.status}</span>
              </p>
            )}
            {canEdit ? (
              <button type="button" onClick={onEdit} className={auroraBtnSecondary}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Editar
              </button>
            ) : null}
          </div>
        </div>

        <Section title="Cliente">
          <p className="text-[14px] font-semibold text-slate-900">{sale.customerName || sale.username || 'Sin nombre'}</p>
          <div className="mt-1.5 space-y-1 text-[13px] text-slate-600">
            {sale.phone ? (
              <a href={`tel:${sale.phone}`} className="inline-flex items-center gap-1.5 hover:text-au-ink-5b3fe0">
                <Phone className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                {sale.phone}
              </a>
            ) : null}
            {sale.username ? <p className="text-slate-500">@{sale.username.replace(/^@/, '')}</p> : null}
            {sale.email ? <p className="text-slate-500">{sale.email}</p> : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 pt-3 text-[12px] text-slate-500">
            <span className="inline-flex items-center gap-1.5" data-testid="pedido-canal">
              {canal.hasLine ? <ChannelLogo platform={canal.family} size={14} colorful /> : null}
              <span className="font-medium text-slate-700">{canal.label}</span>
              {canal.detail ? <span className="text-slate-400">· {canal.detail}</span> : null}
            </span>
            {line ? (
              <Link href="/chats" className="inline-flex items-center gap-1 font-medium text-au-ink-5b3fe0 hover:underline">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                Abrir chats
              </Link>
            ) : null}
          </div>
        </Section>

        <Section title="Productos">
          {productsState === 'loading' ? (
            <div className="animate-pulse space-y-2" role="status" aria-label="Cargando productos">
              <div className="h-4 w-2/3 rounded bg-slate-100" />
              <div className="h-4 w-1/2 rounded bg-slate-100" />
            </div>
          ) : productsState === 'error' ? (
            <div role="alert" className="text-[13px] text-slate-500">
              No pudimos cargar el detalle de productos.{' '}
              <button type="button" onClick={loadProducts} className="font-medium text-au-ink-5b3fe0 hover:underline">
                Reintentar
              </button>
            </div>
          ) : products && products.length > 0 ? (
            <ul className="divide-y divide-slate-100">
              {products.map((p, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">
                      {p.type || 'Producto'} <span className="text-slate-400">×{p.cantidad ?? 1}</span>
                    </span>
                    {[p.color, p.tamano].filter(Boolean).length > 0 ? (
                      <span className="block text-[12px] text-slate-500">{[p.color, p.tamano].filter(Boolean).join(' · ')}</span>
                    ) : null}
                  </span>
                  {typeof p.productCost === 'number' ? (
                    <span className="shrink-0 tabular-nums text-slate-700">
                      {formatCurrency((p.productCost || 0) * (p.cantidad || 1))}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-slate-700">
              {sale.product || '—'} <span className="text-slate-400">×{sale.quantity || 1}</span>
              {[sale.size, sale.color].filter(Boolean).length > 0 ? (
                <span className="block text-[12px] text-slate-500">{[sale.size, sale.color].filter(Boolean).join(' · ')}</span>
              ) : null}
            </p>
          )}
          <div className="mt-2 border-t border-slate-100 pt-2">
            {typeof sale.productCost === 'number' && sale.productCost > 0 ? <Row label="Productos">{formatCurrency(sale.productCost)}</Row> : null}
            {typeof sale.shippingCost === 'number' && sale.shippingCost > 0 ? <Row label="Envío">{formatCurrency(sale.shippingCost)}</Row> : null}
            {typeof sale.iva === 'number' && sale.iva > 0 ? <Row label="IVA">{formatCurrency(sale.iva)}</Row> : null}
            <Row label="Total">{formatCurrency(Number(sale.total) || 0)}</Row>
          </div>
        </Section>

        <Section title="Pago">
          <div className="flex flex-wrap items-center gap-2">
            <PaymentPill chip={pay} />
            {sinpe ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">SINPE</span> : null}
            {sale.contraEntrega ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">Contra entrega</span> : null}
          </div>
          {showConfirmPayment ? (
            <button type="button" onClick={confirmPayment} disabled={confirming} className={`${auroraBtnPrimary} mt-3 w-full sm:w-auto`}>
              {confirming ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Banknote className="h-4 w-4" aria-hidden />}
              Confirmar pago
            </button>
          ) : null}
        </Section>

        <Section title="Envío">
          {sale.orderType === 'RA' ? (
            <p className="text-[13px] text-slate-700">
              Retiro en tienda
              {'pickupDate' in sale && sale.pickupDate ? <span className="text-slate-500"> · {sale.pickupDate}</span> : null}
            </p>
          ) : (
            <>
              <Row label="Mensajería">{sale.courier || '—'}</Row>
              {address ? <Row label="Dirección">{address}</Row> : null}
              <Row label="Estado">
                <ShipPill chip={ship} />
              </Row>
              <div className="mt-3 border-t border-slate-100 pt-3">
                {guia === undefined ? (
                  <p className="text-[12px] text-slate-400">Buscando guía…</p>
                ) : guia ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-[13px]">
                      <p className="flex items-center gap-1.5 font-medium text-slate-900">
                        <Truck className="h-4 w-4 text-slate-400" aria-hidden />
                        Guía {guia.guiaNumber || guia.trackingNumber || 'en proceso'}
                      </p>
                      <p className="text-[12px] text-slate-500">{guia.status}</p>
                    </div>
                    {guia.hasPdf ? (
                      <a
                        href={`/api/shipping/guias/download/${encodeURIComponent(guia.id)}`}
                        download
                        className={auroraBtnSecondary}
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        Descargar guía
                      </a>
                    ) : null}
                  </div>
                ) : canProduction ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] text-slate-500">Todavía no tiene guía.</p>
                    <button type="button" onClick={onGenerateGuia} className={auroraBtnPrimary}>
                      <FileText className="h-4 w-4" aria-hidden />
                      Generar guía
                    </button>
                  </div>
                ) : (
                  <p className="text-[13px] text-slate-500">Todavía no tiene guía.</p>
                )}
              </div>
            </>
          )}
        </Section>

        <Section title="Historial">
          {timeline.length === 0 ? (
            <p className="text-[13px] text-slate-500">Sin movimientos registrados.</p>
          ) : (
            <ol className="space-y-3">
              {timeline.map((item, i) => (
                <li key={i} className="flex gap-3 text-[13px]">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-au-tint-f1eeff text-au-ink-5b3fe0">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-900">{item.label}</span>
                    <span className="block text-[12px] text-slate-500">{item.at}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>
    </AuroraDrawer>
  )
}
