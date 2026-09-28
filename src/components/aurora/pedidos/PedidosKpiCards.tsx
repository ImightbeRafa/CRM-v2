import type { ReactNode } from 'react'
import { AlertCircle, Clock, Package, Truck, Wallet } from 'lucide-react'
import type { PedidosKpis } from '@/lib/pedidos-aurora'

type Accent = 'brand' | 'blue' | 'amber' | 'teal'

const ACCENT: Record<Accent, { bar: string; tile: string }> = {
  brand: { bar: 'from-[#5B6CFF] to-[#A855F7]', tile: 'bg-[#EEF0FF] text-[#5B6CFF]' },
  blue: { bar: 'from-[#5B6CFF] to-[#38BDF8]', tile: 'bg-sky-50 text-sky-600' },
  amber: { bar: 'from-amber-400 to-orange-400', tile: 'bg-amber-50 text-amber-600' },
  teal: { bar: 'from-sky-400 to-[#5B6CFF]', tile: 'bg-sky-50 text-sky-600' },
}

function KpiCard({
  accent,
  icon,
  label,
  value,
  valueClass = 'text-slate-900',
  hint,
  hintTone = 'muted',
}: {
  accent: Accent
  icon: ReactNode
  label: string
  value: string
  valueClass?: string
  hint: string
  hintTone?: 'muted' | 'warn'
}) {
  const a = ACCENT[accent]
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white px-4 pb-4 pt-5">
      <span className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${a.bar}`} aria-hidden />
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.tile}`} aria-hidden>
          {icon}
        </span>
        <span className="text-[13px] text-slate-500">{label}</span>
      </div>
      <p className={`mt-3 text-[26px] font-semibold leading-none tracking-tight ${valueClass}`}>{value}</p>
      <p
        className={`mt-2 flex items-center gap-1 text-[12px] ${
          hintTone === 'warn' ? 'text-amber-600' : 'text-slate-400'
        }`}
      >
        {hintTone === 'warn' ? <AlertCircle className="h-3 w-3" aria-hidden /> : null}
        {hint}
      </p>
    </div>
  )
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** ORD-01 KPI row. Values come from the loaded range; no fabricated deltas or sparklines. */
export function PedidosKpiCards({
  kpis,
  rangeLabel,
  formatCurrency,
}: {
  kpis: PedidosKpis
  /** "hoy" | "7 días" | "30 días" */
  rangeLabel: string
  formatCurrency: (n: number) => string
}) {
  const isToday = rangeLabel === 'hoy'
  const sinpeHint =
    kpis.pendingCount === 0
      ? 'Nada por confirmar'
      : kpis.pendingSinpeCount > 0
        ? `${plural(kpis.pendingSinpeCount, 'pedido', 'pedidos')} SINPE por confirmar`
        : `${plural(kpis.pendingCount, 'pedido', 'pedidos')} por confirmar`
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="pedidos-kpis">
      <KpiCard
        accent="brand"
        icon={<Wallet className="h-4 w-4" />}
        label={isToday ? 'Ventas de hoy' : `Ventas (${rangeLabel})`}
        value={formatCurrency(kpis.salesTotal)}
        hint="Cobradas"
      />
      <KpiCard
        accent="blue"
        icon={<Package className="h-4 w-4" />}
        label={isToday ? 'Pedidos de hoy' : `Pedidos (${rangeLabel})`}
        value={String(kpis.orderCount)}
        hint="Sin cancelados"
      />
      <KpiCard
        accent="amber"
        icon={<Clock className="h-4 w-4" />}
        label="Pendiente de pago"
        value={formatCurrency(kpis.pendingAmount)}
        valueClass="text-amber-600"
        hint={sinpeHint}
        hintTone={kpis.pendingCount > 0 ? 'warn' : 'muted'}
      />
      <KpiCard
        accent="teal"
        icon={<Truck className="h-4 w-4" />}
        label="En tránsito"
        value={String(kpis.inTransitCount)}
        hint={
          kpis.inTransitOverdue > 0
            ? `${kpis.inTransitOverdue} con más de 3 días`
            : 'Al día'
        }
        hintTone={kpis.inTransitOverdue > 0 ? 'warn' : 'muted'}
      />
    </div>
  )
}
