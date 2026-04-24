'use client';

import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  CalendarDays,
  DollarSign,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Store,
  Truck,
  UserRound,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';

interface SummaryData {
  totalSales: number;
  totalRevenue: number;
  averageOrderValue: number;
  activeClients: number;
  trends: {
    sales: number;
    revenue: number;
    avgOrderValue: number;
  } | null;
}

interface TypeBreakdown {
  EA: { count: number; revenue: number };
  RA: { count: number; revenue: number };
}

interface StatusBreakdown {
  status: string;
  count: number;
  percentage: number;
  color: string;
}

export interface DailyOrderDetail {
  id: string;
  orderId: string;
  orderType: string;
  status: string;
  customerName: string;
  total: number;
  saleDate: string | null;
  timestamp: string;
  seller?: string | null;
  salesChannel?: string | null;
}

interface SelectedDayReportProps {
  startDate: string;
  endDate: string;
  onDateRangeChange: (startDate: string, endDate: string) => void;
  summary: SummaryData | null;
  typeBreakdown: TypeBreakdown | null;
  statusBreakdown: StatusBreakdown[];
  orders: DailyOrderDetail[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
  currencySymbol?: string;
  locale?: string;
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export default function SelectedDayReport({
  startDate,
  endDate,
  onDateRangeChange,
  summary,
  typeBreakdown,
  statusBreakdown,
  orders,
  loading,
  error,
  onRefresh,
  currencySymbol = '₡',
  locale = 'es-CR',
}: SelectedDayReportProps) {
  const formatCurrency = (value: number) => {
    return `${currencySymbol}${Number(value || 0).toLocaleString(locale, { maximumFractionDigits: 0 })}`;
  };

  const isSingleDay = startDate === endDate;
  const selectedPeriod = isSingleDay
    ? format(parseDateKey(startDate), "EEEE d 'de' MMMM, yyyy", { locale: es })
    : `${format(parseDateKey(startDate), "d 'de' MMMM, yyyy", { locale: es })} - ${format(parseDateKey(endDate), "d 'de' MMMM, yyyy", { locale: es })}`;
  const todayKey = format(new Date(), 'yyyy-MM-dd');

  const topOrder = orders.reduce<DailyOrderDetail | null>((current, order) => {
    if (!current) return order;
    return order.total > current.total ? order : current;
  }, null);

  const sellers = orders.reduce<Record<string, { count: number; revenue: number }>>((acc, order) => {
    const seller = order.seller?.trim();
    if (!seller) return acc;
    acc[seller] = acc[seller] || { count: 0, revenue: 0 };
    acc[seller].count += 1;
    acc[seller].revenue += order.total || 0;
    return acc;
  }, {});

  const topSeller = Object.entries(sellers)
    .map(([seller, data]) => ({ seller, ...data }))
    .sort((a, b) => b.revenue - a.revenue)[0];

  const metricCards = [
    {
      label: 'Facturación',
      value: formatCurrency(summary?.totalRevenue || 0),
      detail: 'Total vendido en el período',
      icon: DollarSign,
      className: 'text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Pedidos',
      value: String(summary?.totalSales || 0),
      detail: 'Ordenes registradas',
      icon: ShoppingBag,
      className: 'text-blue-600 dark:text-blue-400',
    },
    {
      label: 'Ticket promedio',
      value: formatCurrency(summary?.averageOrderValue || 0),
      detail: 'Promedio por pedido',
      icon: PackageCheck,
      className: 'text-violet-600 dark:text-violet-400',
    },
    {
      label: 'Clientes',
      value: String(summary?.activeClients || 0),
      detail: 'Clientes únicos',
      icon: Users,
      className: 'text-amber-600 dark:text-amber-400',
    },
  ];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border pb-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <CalendarDays className="h-5 w-5 text-blue-600" />
              Reporte seleccionado
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground capitalize">{selectedPeriod}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="grid grid-cols-2 gap-2">
              <label className="min-w-0">
                <span className="sr-only">Fecha inicio</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => onDateRangeChange(event.target.value, endDate)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="min-w-0">
                <span className="sr-only">Fecha fin</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => onDateRangeChange(startDate, event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => onDateRangeChange(todayKey, todayKey)}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5 p-4 md:p-6">
        <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
          {isSingleDay
            ? 'Este reporte refleja un solo día. Para revisar un rango, selecciona una fecha de inicio y una fecha final.'
            : 'Este reporte acumula todos los pedidos dentro del rango seleccionado, incluyendo la fecha de inicio y la fecha final.'}
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {metricCards.map((metric) => {
            const Icon = metric.icon;
            return (
              <div key={metric.label} className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">{metric.label}</p>
                    <p className={`mt-1 truncate text-2xl font-bold ${metric.className}`}>{metric.value}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{metric.detail}</p>
                  </div>
                  <Icon className={`h-5 w-5 flex-shrink-0 ${metric.className}`} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Tipo de pedido</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Truck className="h-4 w-4 text-blue-600" />
                  Envíos (EA)
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold text-foreground">{typeBreakdown?.EA.count || 0} pedidos</div>
                  <div className="text-emerald-600">{formatCurrency(typeBreakdown?.EA.revenue || 0)}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Store className="h-4 w-4 text-orange-600" />
                  Retiros (RA)
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold text-foreground">{typeBreakdown?.RA.count || 0} pedidos</div>
                  <div className="text-emerald-600">{formatCurrency(typeBreakdown?.RA.revenue || 0)}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Estados del período</h4>
            {statusBreakdown.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {statusBreakdown.map((status) => (
                  <span
                    key={status.status}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium"
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.color }} />
                    {status.status}: {status.count}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No hay estados para este día.</p>
            )}
          </div>

          <div className="rounded-lg border border-border p-4">
            <h4 className="mb-3 text-sm font-semibold text-foreground">Lectura rápida</h4>
            <div className="space-y-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Pedido mayor</span>
                <span className="text-right font-semibold text-foreground">
                  {topOrder ? `${topOrder.orderId} · ${formatCurrency(topOrder.total)}` : 'Sin pedidos'}
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Vendedor destacado</span>
                <span className="text-right font-semibold text-foreground">
                  {topSeller ? `${topSeller.seller} · ${formatCurrency(topSeller.revenue)}` : 'Sin vendedor'}
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground">Pedidos con vendedor</span>
                <span className="text-right font-semibold text-foreground">
                  {Object.values(sellers).reduce((sum, seller) => sum + seller.count, 0)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-foreground">Pedidos del período</h4>
            {loading && <span className="text-xs text-muted-foreground">Cargando...</span>}
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/70">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Pedido</th>
                  <th className="px-3 py-2 text-left font-semibold">Cliente</th>
                  <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                  <th className="px-3 py-2 text-left font-semibold">Estado</th>
                  <th className="px-3 py-2 text-left font-semibold">Vendedor</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No hay pedidos registrados para este período.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={order.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{order.orderId}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <UserRound className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-foreground">{order.customerName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          order.orderType === 'EA'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                            : 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300'
                        }`}>
                          {order.orderType}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{order.status}</td>
                      <td className="px-3 py-2 text-muted-foreground">{order.seller || 'Sin vendedor'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-foreground">{formatCurrency(order.total)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
