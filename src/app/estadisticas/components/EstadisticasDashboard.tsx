'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { addDays, format, subDays } from 'date-fns';
import { RefreshCw } from 'lucide-react';
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext';
import ChartContainer from './ChartContainer';
import DateRangePicker from './DateRangePicker';
import RevenueChart from './RevenueChart';
import StatusBreakdownChart from './StatusBreakdownChart';
import TopCustomersChart, { TopCustomersData } from './TopCustomersChart';
import SelectedDayReport, { DailyOrderDetail } from './SelectedDayReport';

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

interface RevenueData {
  date: string;
  revenue: number;
  orderCount: number;
  bookedGross?: number;
  collectedRevenue?: number;
  pendingCod?: number;
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

function todayKey() {
  return format(new Date(), 'yyyy-MM-dd');
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function fillDailyRevenueData(data: RevenueData[], startDate: string, endDate: string): RevenueData[] {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return data;
  }

  const byDate = new Map(data.map((item) => [item.date, item]));
  const filled: RevenueData[] = [];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    const key = format(date, 'yyyy-MM-dd');
    filled.push(byDate.get(key) || { date: key, revenue: 0, orderCount: 0 });
  }

  return filled;
}

interface StatisticsV2Readiness {
  enabled: boolean;
  mode: 'observe' | 'primary';
}

interface RevenueReconciliation {
  bookedGross: number;
  bookedCodGross: number;
  collectedCod: number;
  nonCodBooked: number;
  collectedRevenue: number;
  pendingCod: number;
}

export default function EstadisticasDashboard({ statisticsV2 }: { statisticsV2: StatisticsV2Readiness }) {
  const { settings } = useTenantSettings();
  const initialToday = todayKey();

  const [startDate, setStartDate] = useState(() => format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => initialToday);

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [typeBreakdown, setTypeBreakdown] = useState<TypeBreakdown | null>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown[]>([]);

  const [reportSummary, setReportSummary] = useState<SummaryData | null>(null);
  const [reportTypeBreakdown, setReportTypeBreakdown] = useState<TypeBreakdown | null>(null);
  const [reportStatusBreakdown, setReportStatusBreakdown] = useState<StatusBreakdown[]>([]);
  const [reportOrders, setReportOrders] = useState<DailyOrderDetail[]>([]);
  const [reconciliation, setReconciliation] = useState<RevenueReconciliation | null>(null);
  const [topCustomers, setTopCustomers] = useState<TopCustomersData | null>(null);

  const [loadingPeriod, setLoadingPeriod] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [periodError, setPeriodError] = useState('');
  const [reportError, setReportError] = useState('');

  const chartData = useMemo(
    () => fillDailyRevenueData(revenueData, startDate, endDate),
    [revenueData, startDate, endDate]
  );

  const formatCurrency = (value: number) => {
    return `${settings.currencySymbol}${Number(value || 0).toLocaleString(settings.locale, { maximumFractionDigits: 0 })}`;
  };

  const fetchPeriodData = useCallback(async (signal?: AbortSignal) => {
    setLoadingPeriod(true);
    setPeriodError('');
    try {
      const params = { startDate, endDate };
      if (statisticsV2.enabled) {
        const response = await axios.get('/api/estadisticas/v2/overview', { params, signal });
        const data = response.data;
        const primaryRevenue = statisticsV2.mode === 'primary'
          ? data.revenue.collectedRevenue
          : data.revenue.bookedGross;
        const summaryData = {
          ...data.summary,
          totalRevenue: primaryRevenue,
          averageOrderValue: data.summary.totalSales ? primaryRevenue / data.summary.totalSales : 0,
        };
        setSummary(summaryData);
        setRevenueData(data.daily.map((day: RevenueData) => ({
          ...day,
          revenue: statisticsV2.mode === 'primary'
            ? Number(day.collectedRevenue || 0)
            : Number(day.bookedGross || 0),
        })));
        setTypeBreakdown(data.typeBreakdown);
        setStatusBreakdown(data.statusBreakdown);
        setReportSummary(summaryData);
        setReportTypeBreakdown(data.typeBreakdown);
        setReportStatusBreakdown(data.statusBreakdown);
        setReportOrders(data.orders);
        setTopCustomers(data.topCustomers);
        setReconciliation(data.revenue);
        setLoadingReport(false);
        setReportError('');
        return;
      }
      const [summaryRes, revenueRes, typeRes, statusRes] = await Promise.all([
        axios.get('/api/estadisticas/summary', { params, signal }),
        axios.get('/api/estadisticas/revenue', { params: { ...params, groupBy: 'day' }, signal }),
        axios.get('/api/estadisticas/type-breakdown', { params, signal }),
        axios.get('/api/estadisticas/status-breakdown', { params, signal }),
      ]);

      setSummary(summaryRes.data);
      setRevenueData(revenueRes.data);
      setTypeBreakdown(typeRes.data);
      setStatusBreakdown(statusRes.data);
      setReportSummary(summaryRes.data);
      setReportTypeBreakdown(typeRes.data);
      setReportStatusBreakdown(statusRes.data);
    } catch (error) {
      if (axios.isCancel(error)) return;
      console.error('Error fetching period statistics:', error);
      setPeriodError('Error al cargar las estadísticas del período');
    } finally {
      setLoadingPeriod(false);
    }
  }, [startDate, endDate, statisticsV2.enabled, statisticsV2.mode]);

  const fetchSelectedReportData = useCallback(async (signal?: AbortSignal) => {
    setLoadingReport(true);
    setReportError('');
    try {
      if (statisticsV2.enabled) {
        setLoadingReport(false);
        return;
      }
      const isSingleDay = startDate === endDate;
      const params = { startDate, endDate, limit: isSingleDay ? 500 : 100 };
      const ordersRes = await axios.get('/api/estadisticas/order-details', { params, signal });
      setReportOrders(ordersRes.data);
    } catch (error) {
      if (axios.isCancel(error)) return;
      console.error('Error fetching selected report statistics:', error);
      setReportError('Error al cargar el reporte seleccionado');
    } finally {
      setLoadingReport(false);
    }
  }, [startDate, endDate, statisticsV2.enabled]);

  useEffect(() => {
    const abortController = new AbortController();
    fetchPeriodData(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [fetchPeriodData]);

  useEffect(() => {
    const abortController = new AbortController();
    fetchSelectedReportData(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [fetchSelectedReportData]);

  const handleDateRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const handleSelectedDateChange = (date: string) => {
    if (!date) return;

    setStartDate(date);
    setEndDate(date);
  };

  const refreshAllData = () => {
    fetchPeriodData();
    fetchSelectedReportData();
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 print:hidden">
        <div className="flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Panel de Estadísticas</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Ventas por día con detalle de facturación, pedidos y desempeño diario
          </p>
        </div>
        <button
          onClick={refreshAllData}
          disabled={loadingPeriod || loadingReport}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 md:py-2 md:text-base"
        >
          <RefreshCw className={`h-4 w-4 ${loadingPeriod || loadingReport ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      <div className="print:hidden">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onDateChange={handleDateRangeChange}
        />
      </div>

      {statisticsV2.enabled && reconciliation && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:hidden" aria-label="Conciliación de ingresos v2">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ventas registradas</p>
            <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(reconciliation.bookedGross)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Todos los pedidos guardados</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/20">
            <p className="text-xs font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Ingresos cobrados</p>
            <p className="mt-2 text-2xl font-bold text-emerald-700 dark:text-emerald-400">{formatCurrency(reconciliation.collectedRevenue)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Pago confirmado o contra entrega confirmada. Pendiente no se cuenta.</p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm dark:border-amber-900 dark:bg-amber-950/20">
            <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">Pendiente de cobro</p>
            <p className="mt-2 text-2xl font-bold text-amber-700 dark:text-amber-400">{formatCurrency(reconciliation.pendingCod + Math.max(0, reconciliation.bookedGross - reconciliation.collectedRevenue - reconciliation.pendingCod))}</p>
            <p className="mt-1 text-xs text-muted-foreground">Pedidos guardados que todavía no están cobrados</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Vista de ingresos</p>
            <p className="mt-2 text-base font-semibold text-foreground">{statisticsV2.mode === 'primary' ? 'Ingresos cobrados' : 'Ventas registradas'}</p>
            <p className="mt-1 text-xs text-muted-foreground">El cobro de contra entrega se atribuye a la fecha de venta hasta guardar fecha de cobro.</p>
          </div>
        </section>
      )}

      <div className="print:hidden">
        <ChartContainer
          title="Facturación y pedidos por día"
          subtitle="Haz clic en una barra o punto para revisar ese día"
          loading={loadingPeriod}
          error={periodError}
          isEmpty={!chartData || chartData.length === 0}
        >
          <RevenueChart
            data={chartData}
            height={340}
            currencySymbol={settings.currencySymbol}
            locale={settings.locale}
            selectedDate={startDate === endDate ? startDate : undefined}
            onSelectDate={handleSelectedDateChange}
          />
        </ChartContainer>
      </div>

      <SelectedDayReport
        startDate={startDate}
        endDate={endDate}
        summary={reportSummary}
        typeBreakdown={reportTypeBreakdown}
        statusBreakdown={reportStatusBreakdown}
        orders={reportOrders}
        loading={loadingReport}
        error={reportError}
        currencySymbol={settings.currencySymbol}
        locale={settings.locale}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:hidden">
        <ChartContainer
          title="Distribución por estado"
          subtitle="Estados de pedidos en el rango seleccionado"
          loading={loadingPeriod}
          error={periodError}
          isEmpty={!statusBreakdown || statusBreakdown.length === 0}
        >
          <StatusBreakdownChart data={statusBreakdown} height={300} />
        </ChartContainer>

        <div className="rounded-lg border border-border bg-card p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Resumen del período</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Total de pedidos</span>
              <span className="font-bold text-foreground">{summary?.totalSales || 0}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Facturación total</span>
              <span className="font-bold text-emerald-600">{formatCurrency(summary?.totalRevenue || 0)}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Ticket promedio</span>
              <span className="font-bold text-violet-600">{formatCurrency(summary?.averageOrderValue || 0)}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">Clientes únicos</span>
              <span className="font-bold text-amber-600">{summary?.activeClients || 0}</span>
            </div>

            {typeBreakdown && (
              <>
                <hr className="my-3 border-border" />
                <div className="flex justify-between items-center gap-4">
                  <span className="text-muted-foreground">Envíos (EA)</span>
                  <span className="text-right font-bold text-blue-600">
                    {typeBreakdown.EA.count} pedidos · {formatCurrency(typeBreakdown.EA.revenue)}
                  </span>
                </div>
                <div className="flex justify-between items-center gap-4">
                  <span className="text-muted-foreground">Retiros (RA)</span>
                  <span className="text-right font-bold text-orange-600">
                    {typeBreakdown.RA.count} pedidos · {formatCurrency(typeBreakdown.RA.revenue)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="print:hidden">
        <TopCustomersChart startDate={startDate} endDate={endDate} prefetchedData={statisticsV2.enabled ? topCustomers : undefined} />
      </div>
    </div>
  );
}
