'use client';

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { format, subDays } from 'date-fns';
import { es } from 'date-fns/locale';
import { RefreshCw, FileText, Printer, Download } from 'lucide-react';
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext';
import ChartContainer from './ChartContainer';
import DateRangePicker from './DateRangePicker';
import RevenueChart from './RevenueChart';
import StatusBreakdownChart from './StatusBreakdownChart';
import TopCustomersChart from './TopCustomersChart';

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

interface OrderDetail {
  id: string;
  orderId: string;
  orderType: string;
  status: string;
  customerName: string;
  total: number;
  saleDate: string | null;
  timestamp: string;
}

export default function EstadisticasDashboard() {
  const { settings } = useTenantSettings();
  
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

  const fetchSummary = async (signal?: AbortSignal) => {
    setLoadingSummary(true);
    setErrorSummary('');
    try {
      const response = await axios.get('/api/estadisticas/summary', {
        params: { startDate, endDate },
        signal,
      });
      setSummary(response.data);
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log('[Estadisticas] Summary request cancelled');
        return;
      }
      console.error('Error fetching summary:', error);
      setErrorSummary('Error al cargar resumen');
    } finally {
      setLoadingSummary(false);
    }
  };

  const fetchRevenueData = async (signal?: AbortSignal) => {
    setLoadingRevenue(true);
    setErrorRevenue('');
    try {
      const response = await axios.get('/api/estadisticas/revenue', {
        params: { startDate, endDate, groupBy },
        signal,
      });
      setRevenueData(response.data);
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log('[Estadisticas] Revenue request cancelled');
        return;
      }
      console.error('Error fetching revenue data:', error);
      setErrorRevenue('Error al cargar datos de ingresos');
    } finally {
      setLoadingRevenue(false);
    }
  };

  const fetchTypeBreakdown = async (signal?: AbortSignal) => {
    setLoadingType(true);
    setErrorType('');
    try {
      const response = await axios.get('/api/estadisticas/type-breakdown', {
        params: { startDate, endDate },
        signal,
      });
      setTypeBreakdown(response.data);
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log('[Estadisticas] Type breakdown request cancelled');
        return;
      }
      console.error('Error fetching type breakdown:', error);
      setErrorType('Error al cargar distribución de tipos');
    } finally {
      setLoadingType(false);
    }
  };

  const fetchStatusBreakdown = async (signal?: AbortSignal) => {
    setLoadingStatus(true);
    setErrorStatus('');
    try {
      const response = await axios.get('/api/estadisticas/status-breakdown', {
        params: { startDate, endDate },
        signal,
      });
      setStatusBreakdown(response.data);
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log('[Estadisticas] Status breakdown request cancelled');
        return;
      }
      console.error('Error fetching status breakdown:', error);
      setErrorStatus('Error al cargar distribución de estados');
    } finally {
      setLoadingStatus(false);
    }
  };

  // Effects
  useEffect(() => {
    const abortController = new AbortController();
    const signal = abortController.signal;
    
    fetchSummary(signal);
    fetchRevenueData(signal);
    fetchTypeBreakdown(signal);
    fetchStatusBreakdown(signal);
    
    return () => {
      abortController.abort();
    };
  }, [startDate, endDate]);

  useEffect(() => {
    const abortController = new AbortController();
    fetchRevenueData(abortController.signal);
    
    return () => {
      abortController.abort();
    };
  }, [groupBy]);

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const formatCurrency = (value: number) => {
    return value.toLocaleString('es-CR', { maximumFractionDigits: 0 });
  };

  // Report state
  const [showReport, setShowReport] = useState(false);
  const [orderDetails, setOrderDetails] = useState<OrderDetail[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const fetchOrderDetails = async () => {
    setLoadingReport(true);
    try {
      const response = await axios.get('/api/estadisticas/order-details', {
        params: { startDate, endDate },
      });
      setOrderDetails(response.data);
    } catch (error) {
      console.error('Error fetching order details:', error);
    } finally {
      setLoadingReport(false);
    }
  };

  const handleShowReport = () => {
    setShowReport(true);
    fetchOrderDetails();
  };

  const handlePrint = () => {
    window.print();
  };

  const formatDateRange = () => {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    return `${format(start, "d 'de' MMMM, yyyy", { locale: es })} - ${format(end, "d 'de' MMMM, yyyy", { locale: es })}`;
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 print:hidden">
        <div className="flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Panel de Estadísticas</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-1">
            Vista general del rendimiento de ventas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleShowReport}
            className="flex items-center gap-2 px-4 py-2.5 md:py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors text-sm md:text-base min-h-[44px]"
          >
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">Reporte</span>
          </button>
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
      <div className="print:hidden">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onDateChange={handleDateChange}
        />
      </div>

      {/* Report Modal/View */}
      {showReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 print:relative print:inset-auto print:bg-transparent print:p-0">
          <div ref={reportRef} className="bg-card rounded-lg max-w-5xl w-full max-h-[90vh] overflow-auto print:max-h-none print:overflow-visible print:rounded-none">
            {/* Report Header */}
            <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between print:static print:border-b-2 print:border-black">
              <div>
                <h2 className="text-xl font-bold text-foreground">Reporte de Ventas</h2>
                <p className="text-sm text-muted-foreground">{formatDateRange()}</p>
              </div>
              <div className="flex items-center gap-2 print:hidden">
                <button
                  onClick={handlePrint}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
                >
                  <Printer className="w-4 h-4" />
                  Imprimir
                </button>
                <button
                  onClick={() => setShowReport(false)}
                  className="px-3 py-2 bg-muted text-muted-foreground rounded-md hover:bg-muted/80 text-sm"
                >
                  Cerrar
                </button>
              </div>
            </div>

            {/* Report Content */}
            <div className="p-6">
              {/* Summary Section */}
              <div className="mb-8">
                <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">Resumen General</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-muted p-4 rounded-lg print:border print:bg-transparent">
                    <p className="text-sm text-muted-foreground">Total Pedidos</p>
                    <p className="text-2xl font-bold text-foreground">{summary?.totalSales || 0}</p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-950/30 p-4 rounded-lg print:border print:bg-transparent">
                    <p className="text-sm text-muted-foreground">Ingresos Totales</p>
                    <p className="text-2xl font-bold text-green-600">₡{formatCurrency(summary?.totalRevenue || 0)}</p>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-950/30 p-4 rounded-lg print:border print:bg-transparent">
                    <p className="text-sm text-muted-foreground">Valor Promedio</p>
                    <p className="text-2xl font-bold text-blue-600">₡{formatCurrency(summary?.averageOrderValue || 0)}</p>
                  </div>
                  <div className="bg-purple-50 dark:bg-purple-950/30 p-4 rounded-lg print:border print:bg-transparent">
                    <p className="text-sm text-muted-foreground">Clientes Únicos</p>
                    <p className="text-2xl font-bold text-purple-600">{summary?.activeClients || 0}</p>
                  </div>
                </div>
              </div>

              {/* EA vs RA Breakdown */}
              {typeBreakdown && (
                <div className="mb-8">
                  <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">Desglose por Tipo de Pedido</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-lg font-semibold text-blue-600">Envíos (EA)</span>
                        <span className="bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-400 px-2 py-1 rounded text-sm font-medium">
                          {typeBreakdown.EA.count} pedidos
                        </span>
                      </div>
                      <p className="text-3xl font-bold text-foreground">₡{formatCurrency(typeBreakdown.EA.revenue)}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Promedio: ₡{formatCurrency(typeBreakdown.EA.count > 0 ? typeBreakdown.EA.revenue / typeBreakdown.EA.count : 0)}
                      </p>
                    </div>
                    <div className="border border-border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-lg font-semibold text-orange-600">Retiros (RA)</span>
                        <span className="bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-400 px-2 py-1 rounded text-sm font-medium">
                          {typeBreakdown.RA.count} pedidos
                        </span>
                      </div>
                      <p className="text-3xl font-bold text-foreground">₡{formatCurrency(typeBreakdown.RA.revenue)}</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Promedio: ₡{formatCurrency(typeBreakdown.RA.count > 0 ? typeBreakdown.RA.revenue / typeBreakdown.RA.count : 0)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Orders Table */}
              <div>
                <h3 className="text-lg font-semibold mb-4 border-b border-border pb-2">Detalle de Pedidos</h3>
                {loadingReport ? (
                  <div className="text-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-muted-foreground mt-2">Cargando pedidos...</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted print:bg-muted/80">
                          <th className="text-left p-2 font-semibold">Fecha</th>
                          <th className="text-left p-2 font-semibold">ID Pedido</th>
                          <th className="text-left p-2 font-semibold">Cliente</th>
                          <th className="text-center p-2 font-semibold">Tipo</th>
                          <th className="text-left p-2 font-semibold">Estado</th>
                          <th className="text-right p-2 font-semibold">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderDetails.map((order, idx) => (
                          <tr key={order.id} className={idx % 2 === 0 ? 'bg-card' : 'bg-muted'}>
                            <td className="p-2">
                              {format(new Date(order.saleDate || order.timestamp), 'dd/MM/yyyy')}
                            </td>
                            <td className="p-2 font-mono text-xs">{order.orderId}</td>
                            <td className="p-2">{order.customerName}</td>
                            <td className="p-2 text-center">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                order.orderType === 'EA' 
                                  ? 'bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-400' 
                                  : 'bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-400'
                              }`}>
                                {order.orderType}
                              </span>
                            </td>
                            <td className="p-2">{order.status}</td>
                            <td className="p-2 text-right font-medium">₡{formatCurrency(order.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-muted font-bold print:bg-muted/80">
                          <td colSpan={5} className="p-2 text-right">TOTAL:</td>
                          <td className="p-2 text-right">₡{formatCurrency(orderDetails.reduce((sum, o) => sum + (o.total || 0), 0))}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Footer for print */}
              <div className="hidden print:block mt-8 pt-4 border-t border-border text-center text-sm text-muted-foreground">
                <p>Reporte generado el {format(new Date(), "d 'de' MMMM, yyyy 'a las' HH:mm", { locale: es })}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Content (hidden when printing report) */}
      <div className="print:hidden">
        {/* Revenue Chart - Full Width */}
        <ChartContainer
          title="Ingresos y Pedidos"
          subtitle="Evolución temporal"
          loading={loadingRevenue}
          error={errorRevenue}
          isEmpty={!revenueData || revenueData.length === 0}
          actions={
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as 'day' | 'week' | 'month')}
              className="px-3 py-1.5 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-card"
            >
              <option value="day">Por Día</option>
              <option value="week">Por Semana</option>
              <option value="month">Por Mes</option>
            </select>
          }
        >
          <RevenueChart data={revenueData} height={300} currencySymbol={settings.currencySymbol} locale={settings.locale} />
        </ChartContainer>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Status Breakdown Chart */}
          <ChartContainer
            title="Distribución por Estado"
            subtitle="Estados de pedidos"
            loading={loadingStatus}
            error={errorStatus}
            isEmpty={!statusBreakdown || statusBreakdown.length === 0}
          >
            <StatusBreakdownChart data={statusBreakdown} height={300} />
          </ChartContainer>

          {/* Enhanced Summary Stats Card */}
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/30 dark:to-purple-950/30 rounded-lg border border-border p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Resumen del Período</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Total de Pedidos:</span>
                <span className="font-bold text-foreground">{summary?.totalSales || 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Ingresos Totales:</span>
                <span className="font-bold text-green-600">
                  ₡{formatCurrency(summary?.totalRevenue || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Valor Promedio:</span>
                <span className="font-bold text-purple-600">
                  ₡{formatCurrency(summary?.averageOrderValue || 0)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Clientes Únicos:</span>
                <span className="font-bold text-orange-600">{summary?.activeClients || 0}</span>
              </div>
              {typeBreakdown && (
                <>
                  <hr className="my-3 border-border" />
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Envíos (EA):</span>
                      <div className="text-right">
                        <span className="font-bold text-blue-600">{typeBreakdown.EA.count} pedidos</span>
                        <span className="block text-sm text-green-600 font-medium">₡{formatCurrency(typeBreakdown.EA.revenue)}</span>
                      </div>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Retiros (RA):</span>
                      <div className="text-right">
                        <span className="font-bold text-blue-600">{typeBreakdown.RA.count} pedidos</span>
                        <span className="block text-sm text-green-600 font-medium">₡{formatCurrency(typeBreakdown.RA.revenue)}</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Top Customers */}
        <div className="mt-6">
          <TopCustomersChart startDate={startDate} endDate={endDate} />
        </div>
      </div>
    </div>
  );
}

