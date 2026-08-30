'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Users, TrendingUp, DollarSign, Activity, Clock } from 'lucide-react';

export interface TopCustomer {
  customerName: string;
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  firstOrderDate: string;
  lastOrderDate: string;
  daysSinceLastOrder: number | null;
  customerStatus: string;
}

export interface TopCustomersData {
  topCustomersByRevenue: TopCustomer[];
  topCustomersByOrders: TopCustomer[];
  customerActivity: TopCustomer[];
  customerStatusDistribution: Record<string, number>;
  summary: {
    totalCustomers: number;
    activeCustomers: number;
    totalRevenue: number;
    averageOrderValue: number;
  };
}

interface TopCustomersChartProps {
  startDate: string;
  endDate: string;
  prefetchedData?: TopCustomersData | null;
}

export default function TopCustomersChart({ startDate, endDate, prefetchedData }: TopCustomersChartProps) {
  const [data, setData] = useState<TopCustomersData | null>(prefetchedData ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'revenue' | 'orders' | 'activity'>('revenue');

  useEffect(() => {
    if (prefetchedData !== undefined) {
      setData(prefetchedData ?? null);
      setLoading(false);
      setError('');
      return;
    }
    const abortController = new AbortController();
    fetchData(abortController.signal);
    
    return () => {
      abortController.abort();
    };
  }, [startDate, endDate, prefetchedData]);

  const fetchData = async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/estadisticas/top-customers', {
        params: { startDate, endDate, limit: 10 },
        signal,
      });
      setData(response.data);
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log('[TopCustomers] Request cancelled');
        return;
      }
      console.error('Error fetching top customers:', error);
      setError('Error al cargar datos de clientes');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-CR', {
      style: 'currency',
      currency: 'CRC',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Muy activo':
      case 'Very Active': return 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-400';
      case 'Activo':
      case 'Active': return 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400';
      case 'Moderado':
      case 'Moderate': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400';
      case 'Inactivo':
      case 'Inactive': return 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Muy activo':
      case 'Very Active': return <Activity className="w-4 h-4" />;
      case 'Activo':
      case 'Active': return <TrendingUp className="w-4 h-4" />;
      case 'Moderado':
      case 'Moderate': return <Clock className="w-4 h-4" />;
      case 'Inactivo':
      case 'Inactive': return <Users className="w-4 h-4" />;
      default: return <Users className="w-4 h-4" />;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Top Clientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Top Clientes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-red-600 py-4">{error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const currentData = activeTab === 'revenue' ? data.topCustomersByRevenue :
                     activeTab === 'orders' ? data.topCustomersByOrders :
                     data.customerActivity;

  const hasCustomers = currentData && currentData.length > 0;

  return (
    <Card className="max-h-[600px] flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="w-4 h-4" />
          Análisis de Clientes
        </CardTitle>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => setActiveTab('revenue')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              activeTab === 'revenue' 
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-400' 
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            Por Ingresos
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              activeTab === 'orders' 
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-400' 
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            Por Pedidos
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              activeTab === 'activity' 
                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-400' 
                : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            Actividad
          </button>
        </div>
      </CardHeader>
      <CardContent className="overflow-y-auto flex-1 pt-0">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <div className="text-center p-2 bg-muted rounded-lg">
            <div className="text-lg font-bold text-foreground">{data.summary.totalCustomers}</div>
            <div className="text-xs text-muted-foreground">Total Clientes</div>
          </div>
          <div className="text-center p-2 bg-green-50 dark:bg-green-950/30 rounded-lg">
            <div className="text-lg font-bold text-green-600 dark:text-green-400">{data.summary.activeCustomers}</div>
            <div className="text-xs text-green-600 dark:text-green-400">Activos</div>
          </div>
          <div className="text-center p-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg">
            <div className="text-sm font-bold text-blue-600 dark:text-blue-400 truncate px-1">
              {formatCurrency(data.summary.totalRevenue)}
            </div>
            <div className="text-xs text-blue-600 dark:text-blue-400">Ingresos</div>
          </div>
          <div className="text-center p-2 bg-purple-50 dark:bg-purple-950/30 rounded-lg">
            <div className="text-sm font-bold text-purple-600 dark:text-purple-400 truncate px-1">
              {formatCurrency(data.summary.averageOrderValue)}
            </div>
            <div className="text-xs text-purple-600 dark:text-purple-400">Promedio</div>
          </div>
        </div>

        {/* Customer Status Distribution */}
        <div className="mb-4">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">Distribución por Estado</h4>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.customerStatusDistribution).map(([status, count]) => (
              <Badge key={status} className={`${getStatusColor(status)} text-xs px-2 py-0.5`}>
                {getStatusIcon(status)}
                <span className="ml-1">{status}: {count}</span>
              </Badge>
            ))}
          </div>
        </div>

        {/* Top Customers List */}
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            {activeTab === 'revenue' && 'Top 10 por Ingresos'}
            {activeTab === 'orders' && 'Top 10 por Cantidad de Pedidos'}
            {activeTab === 'activity' && 'Actividad Reciente'}
          </h4>
          {!hasCustomers ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-center">
                <Users className="w-10 h-10 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-muted-foreground text-sm">No hay clientes en este período.</p>
              </div>
            </div>
          ) : (
          <div className="space-y-1.5">
            {currentData.slice(0, 10).map((customer, index) => (
              <div key={customer.customerName} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-6 h-6 bg-purple-100 dark:bg-purple-950/40 rounded-full flex items-center justify-center text-xs font-bold text-purple-600 dark:text-purple-400 flex-shrink-0">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-foreground truncate">{customer.customerName}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {customer.orderCount} pedidos • {formatCurrency(customer.averageOrderValue)}
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-sm text-foreground whitespace-nowrap">
                    {formatCurrency(customer.totalRevenue)}
                  </div>
                  {activeTab === 'activity' && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
                      {getStatusIcon(customer.customerStatus)}
                      <span className="truncate max-w-[80px]">{customer.customerStatus}</span>
                      {customer.daysSinceLastOrder !== null && (
                        <span>• {customer.daysSinceLastOrder}d</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
