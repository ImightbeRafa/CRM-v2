'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { format, subDays } from 'date-fns';
import { Package, DollarSign, TrendingUp, Users, Download, RefreshCw } from 'lucide-react';
import KPICard from './KPICard';
import ChartContainer from './ChartContainer';
import DateRangePicker from './DateRangePicker';
import RevenueChart from './RevenueChart';
import SalesVolumeChart from './SalesVolumeChart';
import StatusBreakdownChart from './StatusBreakdownChart';

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

export default function EstadisticasDashboard() {
  // State
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');

  // Data state
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [revenueData, setRevenueData] = useState<RevenueData[]>([]);
  const [typeBreakdown, setTypeBreakdown] = useState<TypeBreakdown | null>(null);
  const [statusBreakdown, setStatusBreakdown] = useState<StatusBreakdown[]>([]);

  // Loading states
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingRevenue, setLoadingRevenue] = useState(false);
  const [loadingType, setLoadingType] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Error states
  const [errorSummary, setErrorSummary] = useState<string>('');
  const [errorRevenue, setErrorRevenue] = useState<string>('');
  const [errorType, setErrorType] = useState<string>('');
  const [errorStatus, setErrorStatus] = useState<string>('');

  // Fetch data
  const fetchAllData = async () => {
    fetchSummary();
    fetchRevenueData();
    fetchTypeBreakdown();
    fetchStatusBreakdown();
  };

  const fetchSummary = async () => {
    setLoadingSummary(true);
    setErrorSummary('');
    try {
      const response = await axios.get('/api/estadisticas/summary', {
        params: { startDate, endDate },
      });
      setSummary(response.data);
    } catch (error) {
      console.error('Error fetching summary:', error);
      setErrorSummary('Error al cargar resumen');
    } finally {
      setLoadingSummary(false);
    }
  };

  const fetchRevenueData = async () => {
    setLoadingRevenue(true);
    setErrorRevenue('');
    try {
      const response = await axios.get('/api/estadisticas/revenue', {
        params: { startDate, endDate, groupBy },
      });
      setRevenueData(response.data);
    } catch (error) {
      console.error('Error fetching revenue data:', error);
      setErrorRevenue('Error al cargar datos de ingresos');
    } finally {
      setLoadingRevenue(false);
    }
  };

  const fetchTypeBreakdown = async () => {
    setLoadingType(true);
    setErrorType('');
    try {
      const response = await axios.get('/api/estadisticas/type-breakdown', {
        params: { startDate, endDate },
      });
      setTypeBreakdown(response.data);
    } catch (error) {
      console.error('Error fetching type breakdown:', error);
      setErrorType('Error al cargar distribución de tipos');
    } finally {
      setLoadingType(false);
    }
  };

  const fetchStatusBreakdown = async () => {
    setLoadingStatus(true);
    setErrorStatus('');
    try {
      const response = await axios.get('/api/estadisticas/status-breakdown', {
        params: { startDate, endDate },
      });
      setStatusBreakdown(response.data);
    } catch (error) {
      console.error('Error fetching status breakdown:', error);
      setErrorStatus('Error al cargar distribución de estados');
    } finally {
      setLoadingStatus(false);
    }
  };

  // Effects
  useEffect(() => {
    fetchAllData();
  }, [startDate, endDate]);

  useEffect(() => {
    fetchRevenueData();
  }, [groupBy]);

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const formatCurrency = (value: number) => {
    return value.toLocaleString('es-CR', { maximumFractionDigits: 0 });
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
        <div className="flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Panel de Estadísticas</h1>
          <p className="text-sm md:text-base text-gray-600 mt-1">
            Vista general del rendimiento de ventas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAllData}
            className="flex items-center gap-2 px-4 py-2.5 md:py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm md:text-base min-h-[44px]"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Actualizar</span>
            <span className="sm:hidden">Sync</span>
          </button>
        </div>
      </div>

      {/* Date Range Picker */}
      <DateRangePicker
        startDate={startDate}
        endDate={endDate}
        onDateChange={handleDateChange}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <KPICard
          title="Total de Ventas"
          value={summary?.totalSales || 0}
          subtitle="Número de pedidos"
          trend={
            summary?.trends
              ? {
                  value: summary.trends.sales,
                  isPositive: summary.trends.sales >= 0,
                  period: 'vs período anterior',
                }
              : undefined
          }
          icon={<Package className="w-6 h-6" />}
          color="blue"
          loading={loadingSummary}
        />
        <KPICard
          title="Ingresos Totales"
          value={summary?.totalRevenue || 0}
          subtitle="En colones"
          trend={
            summary?.trends
              ? {
                  value: summary.trends.revenue,
                  isPositive: summary.trends.revenue >= 0,
                  period: 'vs período anterior',
                }
              : undefined
          }
          icon={<DollarSign className="w-6 h-6" />}
          color="green"
          loading={loadingSummary}
          prefix="₡"
          decimals={0}
        />
        <KPICard
          title="Valor Promedio"
          value={summary?.averageOrderValue || 0}
          subtitle="Por pedido"
          trend={
            summary?.trends
              ? {
                  value: summary.trends.avgOrderValue,
                  isPositive: summary.trends.avgOrderValue >= 0,
                  period: 'vs período anterior',
                }
              : undefined
          }
          icon={<TrendingUp className="w-6 h-6" />}
          color="purple"
          loading={loadingSummary}
          prefix="₡"
          decimals={0}
        />
        <KPICard
          title="Clientes Activos"
          value={summary?.activeClients || 0}
          subtitle="Clientes únicos"
          icon={<Users className="w-6 h-6" />}
          color="orange"
          loading={loadingSummary}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <ChartContainer
          title="Ingresos y Pedidos"
          subtitle="Evolución temporal"
          loading={loadingRevenue}
          error={errorRevenue}
          actions={
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as 'day' | 'week' | 'month')}
              className="px-3 py-1.5 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="day">Por Día</option>
              <option value="week">Por Semana</option>
              <option value="month">Por Mes</option>
            </select>
          }
        >
          <RevenueChart data={revenueData} height={300} />
        </ChartContainer>

        {/* Sales Volume Chart */}
        <ChartContainer
          title="Distribución por Tipo"
          subtitle="Envíos vs Retiros"
          loading={loadingType}
          error={errorType}
        >
          {typeBreakdown && <SalesVolumeChart data={typeBreakdown} height={300} />}
        </ChartContainer>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Breakdown Chart */}
        <ChartContainer
          title="Distribución por Estado"
          subtitle="Estados de pedidos"
          loading={loadingStatus}
          error={errorStatus}
        >
          <StatusBreakdownChart data={statusBreakdown} height={300} />
        </ChartContainer>

        {/* Summary Stats Card */}
        <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Resumen del Período</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Total de Pedidos:</span>
              <span className="font-bold text-gray-900">{summary?.totalSales || 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Ingresos Totales:</span>
              <span className="font-bold text-green-600">
                ₡{formatCurrency(summary?.totalRevenue || 0)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Valor Promedio:</span>
              <span className="font-bold text-purple-600">
                ₡{formatCurrency(summary?.averageOrderValue || 0)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Clientes Únicos:</span>
              <span className="font-bold text-orange-600">{summary?.activeClients || 0}</span>
            </div>
            {typeBreakdown && (
              <>
                <hr className="my-3" />
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Envíos (EA):</span>
                  <span className="font-bold text-blue-600">{typeBreakdown.EA.count}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Retiros (RA):</span>
                  <span className="font-bold text-blue-600">{typeBreakdown.RA.count}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

