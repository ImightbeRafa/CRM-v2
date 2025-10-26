'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { 
  Package, 
  TrendingUp, 
  DollarSign, 
  Users, 
  BarChart3, 
  Target,
  Clock,
  CheckCircle,
  AlertCircle,
  XCircle
} from 'lucide-react';

interface OrderAnalytics {
  overview: {
    totalOrders: number;
    totalRevenue: number;
    averageOrderValue: number;
    uniqueCustomers: number;
  };
  statusBreakdown: Array<{
    status: string;
    count: number;
    revenue: number;
    avgValue: number;
    percentage: number;
    color: string;
  }>;
  typeBreakdown: Array<{
    type: string;
    count: number;
    revenue: number;
    avgValue: number;
    percentage: number;
  }>;
  sellerPerformance: Array<{
    seller: string;
    orderCount: number;
    totalRevenue: number;
    avgOrderValue: number;
    marketShare: number;
    revenueShare: number;
  }>;
  orderTrends: Array<{
    date: string;
    orderCount: number;
    revenue: number;
  }>;
  orderSizeDistribution: Array<{
    size_category: string;
    count: number;
    avg_value: number;
    total_revenue: number;
  }>;
  efficiency: {
    revenuePerOrder: number;
    ordersPerDay: number;
    conversionRate: number;
  };
}

interface EnhancedOrderAnalyticsProps {
  startDate: string;
  endDate: string;
}

export default function EnhancedOrderAnalytics({ startDate, endDate }: EnhancedOrderAnalyticsProps) {
  const [data, setData] = useState<OrderAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState<'overview' | 'status' | 'sellers' | 'trends'>('overview');

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/estadisticas/order-analytics', {
        params: { startDate, endDate }
      });
      setData(response.data);
    } catch (error) {
      console.error('Error fetching order analytics:', error);
      setError('Error al cargar análisis de pedidos');
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

  const getStatusIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'pending': return <Clock className="w-4 h-4 text-yellow-600" />;
      case 'cancelled': return <XCircle className="w-4 h-4 text-red-600" />;
      case 'processing': return <AlertCircle className="w-4 h-4 text-blue-600" />;
      default: return <Package className="w-4 h-4 text-gray-600" />;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Análisis de Pedidos
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
            <BarChart3 className="w-5 h-5" />
            Análisis de Pedidos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-red-600 py-4">{error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Navigation Tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Análisis Avanzado de Pedidos
          </CardTitle>
          <div className="flex gap-2 mt-4">
            {[
              { key: 'overview', label: 'Resumen', icon: <Target className="w-4 h-4" /> },
              { key: 'status', label: 'Estados', icon: <Package className="w-4 h-4" /> },
              { key: 'sellers', label: 'Vendedores', icon: <Users className="w-4 h-4" /> },
              { key: 'trends', label: 'Tendencias', icon: <TrendingUp className="w-4 h-4" /> }
            ].map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setActiveView(key as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeView === key 
                    ? 'bg-purple-100 text-purple-800' 
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
      </Card>

      {/* Overview Tab */}
      {activeView === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-600">Total Pedidos</p>
                  <p className="text-2xl font-bold text-gray-900">{data.overview.totalOrders}</p>
                </div>
                <Package className="w-6 h-6 text-blue-600 flex-shrink-0" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-600">Ingresos Totales</p>
                  <p className="text-xl font-bold text-gray-900 truncate">{formatCurrency(data.overview.totalRevenue)}</p>
                </div>
                <DollarSign className="w-6 h-6 text-green-600 flex-shrink-0" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-600">Valor Promedio</p>
                  <p className="text-xl font-bold text-gray-900 truncate">{formatCurrency(data.overview.averageOrderValue)}</p>
                </div>
                <TrendingUp className="w-6 h-6 text-purple-600 flex-shrink-0" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-600">Clientes Únicos</p>
                  <p className="text-2xl font-bold text-gray-900">{data.overview.uniqueCustomers}</p>
                </div>
                <Users className="w-6 h-6 text-orange-600 flex-shrink-0" />
              </div>
            </CardContent>
          </Card>

          {/* Efficiency Metrics */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Métricas de Eficiencia</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <div className="text-lg font-bold text-blue-600 truncate px-1">
                    {formatCurrency(data.efficiency.revenuePerOrder)}
                  </div>
                  <div className="text-xs text-blue-600">Ingresos por Pedido</div>
                </div>
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <div className="text-lg font-bold text-green-600">
                    {data.efficiency.ordersPerDay.toFixed(1)}
                  </div>
                  <div className="text-xs text-green-600">Pedidos por Día</div>
                </div>
                <div className="text-center p-3 bg-purple-50 rounded-lg">
                  <div className="text-lg font-bold text-purple-600">
                    {data.efficiency.conversionRate.toFixed(1)}%
                  </div>
                  <div className="text-xs text-purple-600">Tasa de Conversión</div>
                </div>
                <div className="text-center p-3 bg-orange-50 rounded-lg">
                  <div className="text-lg font-bold text-orange-600">
                    {data.overview.uniqueCustomers > 0 ? (data.overview.totalOrders / data.overview.uniqueCustomers).toFixed(1) : 0}
                  </div>
                  <div className="text-xs text-orange-600">Pedidos por Cliente</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Status Breakdown Tab */}
      {activeView === 'status' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Distribución por Estado</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {data.statusBreakdown.map((status, index) => (
                  <div key={status.status} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {getStatusIcon(status.status)}
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-gray-900">{status.status}</div>
                        <div className="text-xs text-gray-600 truncate">
                          {status.count} pedidos • {formatCurrency(status.avgValue)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-bold text-sm text-gray-900 whitespace-nowrap">{formatCurrency(status.revenue)}</div>
                      <div className="text-xs text-gray-600">{status.percentage.toFixed(1)}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Distribución por Tamaño de Pedido</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {data.orderSizeDistribution.map((size, index) => (
                  <div key={size.size_category} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-xs font-bold text-purple-600 flex-shrink-0">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm text-gray-900">{size.size_category}</div>
                        <div className="text-xs text-gray-600 truncate">
                          {size.count} pedidos • {formatCurrency(size.avg_value)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="font-bold text-sm text-gray-900 whitespace-nowrap">{formatCurrency(size.total_revenue)}</div>
                      <div className="text-xs text-gray-600">
                        {data.overview.totalOrders > 0 ? ((size.count / data.overview.totalOrders) * 100).toFixed(1) : 0}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Seller Performance Tab */}
      {activeView === 'sellers' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Rendimiento de Vendedores</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {data.sellerPerformance.map((seller, index) => (
                <div key={seller.seller} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-xs font-bold text-purple-600 flex-shrink-0">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-gray-900 truncate">{seller.seller}</div>
                      <div className="text-xs text-gray-600 truncate">
                        {seller.orderCount} pedidos • {formatCurrency(seller.avgOrderValue)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-sm text-gray-900 whitespace-nowrap">{formatCurrency(seller.totalRevenue)}</div>
                    <div className="text-xs text-gray-600 whitespace-nowrap">
                      {seller.marketShare.toFixed(1)}% mercado • {seller.revenueShare.toFixed(1)}% ingresos
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trends Tab */}
      {activeView === 'trends' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tendencias de Pedidos (Últimos 30 días)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {data.orderTrends.slice(-10).map((trend, index) => (
                <div key={trend.date} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center text-xs font-bold text-blue-600 flex-shrink-0">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-gray-900">
                        {new Date(trend.date).toLocaleDateString('es-CR')}
                      </div>
                      <div className="text-xs text-gray-600">
                        {trend.orderCount} pedidos
                      </div>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="font-bold text-sm text-gray-900 whitespace-nowrap">{formatCurrency(trend.revenue)}</div>
                    <div className="text-xs text-gray-600 whitespace-nowrap">
                      {trend.orderCount > 0 ? formatCurrency(trend.revenue / trend.orderCount) : 'N/A'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
