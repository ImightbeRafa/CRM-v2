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
import TopCustomersChart from './TopCustomersChart';
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

export default function EstadisticasDashboard() {
  const { settings } = useTenantSettings();
  const initialToday = todayKey();

  const [startDate, setStartDate] = useState(() => format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(() => initialToday);
  const [reportStartDate, setReportStartDate] = useState(() => initialToday);
  const [reportEndDate, setReportEndDate] = useState(() => initialToday);

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [typeBreakdown, setTypeBreakdown] = useState<TypeBreakdown | null>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown[]>([]);

  const [reportSummary, setReportSummary] = useState<SummaryData | null>(null);
  const [reportTypeBreakdown, setReportTypeBreakdown] = useState<TypeBreakdown | null>(null);
  const [reportStatusBreakdown, setReportStatusBreakdown] = useState<StatusBreakdown[]>([]);
  const [reportOrders, setReportOrders] = useState<DailyOrderDetail[]>([]);

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
    } catch (error) {
      if (axios.isCancel(error)) return;
      console.error('Error fetching period statistics:', error);
      setPeriodError('Error al cargar las estadísticas del período');
    } finally {
      setLoadingPeriod(false);
    }
  }, [startDate, endDate]);

  const fetchSelectedReportData = useCallback(async (signal?: AbortSignal) => {
    setLoadingReport(true);
    setReportError('');
    try {
      const params = { startDate: reportStartDate, endDate: reportEndDate };
      const [summaryRes, typeRes, statusRes, ordersRes] = await Promise.all([
        axios.get('/api/estadisticas/summary', { params, signal }),
        axios.get('/api/estadisticas/type-breakdown', { params, signal }),
        axios.get('/api/estadisticas/status-breakdown', { params, signal }),
        axios.get('/api/estadisticas/order-details', { params, signal }),
      ]);

      setReportSummary(summaryRes.data);
      setReportTypeBreakdown(typeRes.data);
      setReportStatusBreakdown(statusRes.data);
      setReportOrders(ordersRes.data);
    } catch (error) {
      if (axios.isCancel(error)) return;
      console.error('Error fetching selected report statistics:', error);
      setReportError('Error al cargar el reporte seleccionado');
    } finally {
      setLoadingReport(false);
    }
  }, [reportStartDate, reportEndDate]);

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

    if (reportStartDate < start || reportEndDate > end) {
      setReportStartDate(start);
      setReportEndDate(end);
    }
  };

  const handleSelectedDateChange = (date: string) => {
    if (!date) return;

    setReportStartDate(date);
    setReportEndDate(date);

    if (date < startDate || date > endDate) {
      const parsed = parseDateKey(date);
      setStartDate(format(subDays(parsed, 29), 'yyyy-MM-dd'));
      setEndDate(date);
    }
  };

  const handleReportRangeChange = (start: string, end: string) => {
    if (!start || !end) return;

    const normalizedStart = start <= end ? start : end;
    const normalizedEnd = start <= end ? end : start;

    setReportStartDate(normalizedStart);
    setReportEndDate(normalizedEnd);

    if (normalizedStart < startDate || normalizedEnd > endDate) {
      setStartDate(normalizedStart);
      setEndDate(normalizedEnd);
    }
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
            selectedDate={reportStartDate === reportEndDate ? reportStartDate : undefined}
            onSelectDate={handleSelectedDateChange}
          />
        </ChartContainer>
      </div>

      <SelectedDayReport
        startDate={reportStartDate}
        endDate={reportEndDate}
        onDateRangeChange={handleReportRangeChange}
        summary={reportSummary}
        typeBreakdown={reportTypeBreakdown}
        statusBreakdown={reportStatusBreakdown}
        orders={reportOrders}
        loading={loadingReport}
        error={reportError}
        onRefresh={() => fetchSelectedReportData()}
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
        <TopCustomersChart startDate={startDate} endDate={endDate} />
      </div>
    </div>
  );
}
