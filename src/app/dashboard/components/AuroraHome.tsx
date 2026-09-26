'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  BarChart3,
  Bot,
  ChevronRight,
  Clock,
  Factory,
  FileText,
  HelpCircle,
  Package,
  Plus,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react'
import { useDashboardStats } from '@/app/hooks/useDashboardStats'
import { SetupChecklist } from './SetupChecklist'

type RecentOrder = {
  id: string
  orderId: string
  customerName: string
  product: string | null
  total: number
  status: string
  contraEntrega?: boolean
  cePaymentConfirmed?: boolean
}

/** ₡24.900 */
function crc(n: number): string {
  return `₡${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}

/** ₡385,1 mil / ₡1,2 M / ₡900 */
function crcCompact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `₡${(n / 1_000_000).toFixed(1).replace('.', ',')} M`
  if (abs >= 1_000) return `₡${(n / 1_000).toFixed(1).replace('.', ',')} mil`
  return crc(n)
}

function crcAxis(n: number): string {
  if (n >= 1_000_000) return `₡${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (n >= 1_000) return `₡${Math.round(n / 1_000)}k`
  return `₡${Math.round(n)}`
}

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function greetingFor(date: Date): string {
  const h = date.getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

function statusPill(order: RecentOrder): { label: string; className: string } {
  const s = order.status.toLowerCase()
  if (s.includes('cancel') || s.includes('rechaz')) return { label: order.status, className: 'bg-red-50 text-red-600' }
  if (s.includes('entregado') || s.includes('completado') || s.includes('pagado'))
    return { label: order.status, className: 'bg-emerald-50 text-emerald-700' }
  if (s.includes('pendiente')) return { label: order.status, className: 'bg-amber-50 text-amber-700' }
  if (s.includes('tránsito') || s.includes('transito') || s.includes('enviado'))
    return { label: order.status, className: 'bg-sky-50 text-sky-700' }
  return { label: order.status, className: 'bg-slate-100 text-slate-600' }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '·') + (parts[1]?.[0] ?? '')).toUpperCase()
}

function useRecentOrders() {
  return useQuery<RecentOrder[], Error>({
    queryKey: ['dashboard-recent-orders'],
    queryFn: async () => {
      const res = await fetch('/api/orders?limit=5', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to fetch recent orders')
      const json = await res.json()
      return Array.isArray(json?.data) ? (json.data as RecentOrder[]) : []
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  )
}

function CardTitle({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EEEAFF] text-[#6D4AFF]">{icon}</span>
        <h2 className="text-[14px] font-semibold text-slate-900">{children}</h2>
      </div>
      {action}
    </div>
  )
}

function Delta({ pct, label }: { pct: number; label: string }) {
  if (pct === 0) return <p className="text-[12px] text-slate-400">{label}: sin cambio</p>
  const up = pct > 0
  return (
    <p className={`flex items-center gap-1 text-[12px] font-medium ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      <TrendingUp className={`h-3 w-3 ${up ? '' : '-scale-y-100'}`} aria-hidden />
      {up ? '+' : '−'}
      {Math.abs(pct)}% {label}
    </p>
  )
}

type Props = {
  firstName: string
  tenantName?: string
  isLogisticsAdmin: boolean
  isOwner: boolean
}

export function AuroraHome({ firstName, tenantName, isLogisticsAdmin, isOwner }: Props) {
  const { stats, isLoading, error, refresh } = useDashboardStats()
  const { data: recentOrders, isLoading: loadingOrders } = useRecentOrders()
  // Date/greeting are client-clock dependent — set after mount to avoid SSR mismatch.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => setNow(new Date()), [])

  const dateLabel = now
    ? now
        .toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long' })
        .replace(/^./, (c) => c.toUpperCase())
    : ''
  const subtitle = [dateLabel, tenantName].filter(Boolean).join(' · ')

  const cePendingCount = stats.cePendingCount ?? 0
  const attention = [
    cePendingCount > 0 && {
      key: 'ce',
      icon: <Wallet className="h-4 w-4" />,
      tone: 'bg-amber-100 text-amber-600',
      title: `${cePendingCount} ${cePendingCount === 1 ? 'pago contra entrega por confirmar' : 'pagos contra entrega por confirmar'}`,
      detail: `${crc(stats.cePendingTotal ?? 0)} en total`,
      cta: 'Revisar',
      href: '/ventas?status=pending',
    },
  ].filter(Boolean) as {
    key: string
    icon: ReactNode
    tone: string
    title: string
    detail: string
    cta: string
    href: string
  }[]

  const daily = stats.dailyRevenue ?? []
  const dailyMax = Math.max(0, ...daily.map((d) => d.total))
  const hasDaily = dailyMax > 0

  const quick = [
    { href: '/ventas', label: 'Crear pedido', icon: <Plus className="h-4 w-4" />, tone: 'bg-[#EEEAFF] text-[#6D4AFF]' },
    { href: '/config?tab=inventory', label: 'Inventario', icon: <Warehouse className="h-4 w-4" />, tone: 'bg-blue-50 text-blue-600' },
    ...(isLogisticsAdmin
      ? [{ href: '/logistics/guias', label: 'Generar guías', icon: <FileText className="h-4 w-4" />, tone: 'bg-sky-50 text-sky-600' }]
      : []),
    { href: '/produccion', label: 'Producción', icon: <Factory className="h-4 w-4" />, tone: 'bg-slate-100 text-slate-500' },
    { href: '/estadisticas', label: 'Estadísticas', icon: <BarChart3 className="h-4 w-4" />, tone: 'bg-slate-100 text-slate-500' },
    { href: '/help', label: 'Centro de ayuda', icon: <HelpCircle className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-600' },
  ]

  const kpis = [
    {
      label: 'Ventas semana',
      icon: <TrendingUp className="h-4 w-4" />,
      tone: 'bg-[#EEEAFF] text-[#6D4AFF]',
      value: crcCompact(stats.weeklyRevenue),
      foot: <Delta pct={stats.revenueChange} label="vs semana pasada" />,
    },
    {
      label: 'Pedidos semana',
      icon: <ShoppingBag className="h-4 w-4" />,
      tone: 'bg-blue-50 text-blue-600',
      value: String(stats.ordersWeek),
      foot: <Delta pct={stats.ordersChange} label="vs semana pasada" />,
    },
    {
      label: 'Pedidos pendientes',
      icon: <Clock className="h-4 w-4" />,
      tone: 'bg-amber-50 text-amber-600',
      value: String(stats.pendingOrders),
      foot:
        stats.pendingOver7Days && stats.pendingOver7Days > 0 ? (
          <p className="flex items-center gap-1 text-[12px] font-medium text-amber-600">
            <Clock className="h-3 w-3" aria-hidden />
            {stats.pendingOver7Days} con más de 7 días
          </p>
        ) : (
          <p className="text-[12px] text-slate-400">Ninguno con más de 7 días</p>
        ),
    },
    {
      label: 'Clientes',
      icon: <Users className="h-4 w-4" />,
      tone: 'bg-emerald-50 text-emerald-600',
      value: stats.totalClients.toLocaleString('de-DE'),
      foot:
        stats.newClientsThisWeek > 0 ? (
          <p className="flex items-center gap-1 text-[12px] font-medium text-emerald-600">
            <TrendingUp className="h-3 w-3" aria-hidden />+{stats.newClientsThisWeek} nuevos esta semana
          </p>
        ) : (
          <p className="text-[12px] text-slate-400">Sin nuevos esta semana</p>
        ),
    },
  ]

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-6 pt-5 md:px-8 md:pb-10 md:pt-6">
      {/* Header + toolbar */}
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold leading-tight text-slate-900">
            {now ? `${greetingFor(now)}, ${firstName}` : `Hola, ${firstName}`}
          </h1>
          {subtitle && <p className="mt-0.5 text-[12px] text-slate-500">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refresh(true)}
            disabled={isLoading}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden />
            Actualizar
          </button>
          <Link
            href="/ventas"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-gradient-to-r from-[#5B6CFF] to-[#7C4DFF] px-3.5 text-[13px] font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Crear pedido
          </Link>
        </div>
      </header>

      {error && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          No se pudieron cargar las estadísticas. Probá con Actualizar.
        </div>
      )}

      {isOwner && (
        <div className="mb-5">
          <SetupChecklist />
        </div>
      )}

      {/* Atención — only real signals */}
      {attention.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[14px] font-semibold text-slate-900">Necesita tu atención</h2>
            <span className="rounded-full bg-[#EEEAFF] px-2 py-px text-[11px] font-semibold text-[#6D4AFF]">
              {attention.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {attention.map((a) => (
              <Card key={a.key} className="flex items-start gap-3 p-4">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${a.tone}`}>{a.icon}</span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-slate-900">{a.title}</p>
                  <p className="text-[12px] text-slate-500">{a.detail}</p>
                  <Link href={a.href} className="mt-1 inline-flex items-center gap-0.5 text-[12px] font-semibold text-[#6D4AFF] hover:underline">
                    {a.cta}
                    <ChevronRight className="h-3 w-3" aria-hidden />
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label} className="relative overflow-hidden p-4">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#5B6CFF] via-[#A855F7] to-[#EC4899]" aria-hidden />
            <div className="mb-2 flex items-center gap-2 text-[12px] text-slate-500">
              <span className={`flex h-6 w-6 items-center justify-center rounded-lg ${k.tone}`}>{k.icon}</span>
              {k.label}
            </div>
            {isLoading ? (
              <div className="h-8 w-24 animate-pulse rounded-md bg-slate-100" />
            ) : (
              <>
                <p className="text-[26px] font-bold leading-tight tabular-nums text-slate-900">{k.value}</p>
                <div className="mt-1">{k.foot}</div>
              </>
            )}
          </Card>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Ventas 7d */}
        <Card className="p-5 lg:col-span-2">
          <CardTitle icon={<TrendingUp className="h-4 w-4" />}>Ventas · últimos 7 días</CardTitle>
          {isLoading ? (
            <div className="mt-6 h-48 animate-pulse rounded-xl bg-slate-100" />
          ) : hasDaily ? (
            <div className="mt-6 flex h-52 items-end gap-2 sm:gap-3">
              {daily.map((d, i) => {
                const last = i === daily.length - 1
                const pct = Math.max(4, Math.round((d.total / dailyMax) * 100))
                const wd = WEEKDAYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()]
                return (
                  <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center">
                    <span className={`mb-1 truncate text-[10px] ${last ? 'font-semibold text-[#6D4AFF]' : 'text-slate-400'}`}>
                      {d.total > 0 ? crcAxis(d.total) : ''}
                    </span>
                    <div
                      className={`w-full rounded-t-lg ${last ? 'bg-gradient-to-b from-[#7C4DFF] to-[#5B6CFF]' : 'bg-[#E9E4FF]'}`}
                      style={{ height: `${pct * 0.75}%` }}
                      title={`${wd} ${d.date}: ${crc(d.total)}`}
                    />
                    <span className={`mt-2 text-[11px] ${last ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{wd}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="mt-6 flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 text-[13px] text-slate-400">
              Sin datos diarios aún
            </div>
          )}
        </Card>

        {/* Agentes — runtime on hold, no metrics API yet */}
        <Card className="border-[#C9BFFF] p-5">
          <CardTitle icon={<Bot className="h-4 w-4" />} action={<Link href="/config?tab=agentes" className="text-[12px] font-semibold text-[#6D4AFF] hover:underline">Ver agentes</Link>}>
            Agentes esta semana
          </CardTitle>
          <div className="mt-6 flex flex-col items-start gap-2">
            <span className="rounded-md border border-slate-200 px-1.5 py-px text-[10px] font-medium text-slate-500">IA en pausa</span>
            <p className="text-[13px] text-slate-500">
              Acá vas a ver las conversaciones resueltas, pedidos creados y traspasos a humano de tus agentes.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Pedidos recientes */}
        <Card className="p-5 lg:col-span-2">
          <CardTitle
            icon={<Package className="h-4 w-4" />}
            action={<Link href="/ventas" className="text-[12px] font-semibold text-[#6D4AFF] hover:underline">Ver todos</Link>}
          >
            Pedidos recientes
          </CardTitle>
          {loadingOrders ? (
            <div className="mt-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : !recentOrders || recentOrders.length === 0 ? (
            <p className="mt-6 rounded-xl border border-dashed border-slate-200 py-8 text-center text-[13px] text-slate-400">
              Todavía no hay pedidos
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {recentOrders.map((o) => {
                const pill = statusPill(o)
                return (
                  <li key={o.id} className="flex items-center gap-3 py-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEEAFF] text-[11px] font-bold text-[#6D4AFF]">
                      {initialsOf(o.customerName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-slate-900">{o.customerName}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {o.orderId}
                        {o.product ? ` · ${o.product}` : ''}
                      </p>
                    </div>
                    <span className="text-[13px] font-semibold tabular-nums text-slate-900">{crc(o.total)}</span>
                    <span className={`hidden shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium sm:inline-block ${pill.className}`}>
                      {pill.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* Accesos rápidos */}
        <Card className="p-5">
          <CardTitle icon={<Plus className="h-4 w-4" />}>Accesos rápidos</CardTitle>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {quick.map((q) => (
              <Link
                key={q.label}
                href={q.href}
                className="flex items-center gap-2 rounded-xl border border-slate-200 px-2.5 py-2.5 text-[12px] font-medium text-slate-800 transition-colors hover:bg-slate-50"
              >
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${q.tone}`}>{q.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate">{q.label}</span>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

    </div>
  )
}
