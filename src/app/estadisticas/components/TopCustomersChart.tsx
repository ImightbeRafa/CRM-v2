'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Users, TrendingUp, DollarSign, Activity, Clock } from 'lucide-react';

interface TopCustomer {
  customerName: string;
  totalRevenue: number;
  orderCount: number;
  averageOrderValue: number;
  firstOrderDate: string;
  lastOrderDate: string;
  daysSinceLastOrder: number | null;
  customerStatus: string;
}

interface TopCustomersData {
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
}

export default function TopCustomersChart({ startDate, endDate }: TopCustomersChartProps) {
  const [data, setData] = useState<TopCustomersData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'revenue' | 'orders' | 'activity'>('revenue');

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/estadisticas/top-customers', {
        params: { startDate, endDate, limit: 10 }
      });
      setData(response.data);
    } catch (error) {
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
      case 'Very Active': return 'bg-green-100 text-green-800';
      case 'Active': return 'bg-blue-100 text-blue-800';
      case 'Moderate': return 'bg-yellow-100 text-yellow-800';
      case 'Inactive': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Very Active': return <Activity className="w-4 h-4" />;
      case 'Active': return <TrendingUp className="w-4 h-4" />;
      case 'Moderate': return <Clock className="w-4 h-4" />;
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
                ? 'bg-purple-100 text-purple-800' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Por Ingresos
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              activeTab === 'orders' 
                ? 'bg-purple-100 text-purple-800' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Por Pedidos
          </button>
          <button
            onClick={() => setActiveTab('activity')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              activeTab === 'activity' 
                ? 'bg-purple-100 text-purple-800' 
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Actividad
          </button>
        </div>
      </CardHeader>
      <CardContent className="overflow-y-auto flex-1 pt-0">
        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <div className="text-center p-2 bg-gray-50 rounded-lg">
            <div className="text-lg font-bold text-gray-900">{data.summary.totalCustomers}</div>
            <div className="text-xs text-gray-600">Total Clientes</div>
          </div>
          <div className="text-center p-2 bg-green-50 rounded-lg">
            <div className="text-lg font-bold text-green-600">{data.summary.activeCustomers}</div>
            <div className="text-xs text-green-600">Activos</div>
          </div>
          <div className="text-center p-2 bg-blue-50 rounded-lg">
            <div className="text-sm font-bold text-blue-600 truncate px-1">
              {formatCurrency(data.summary.totalRevenue)}
            </div>
            <div className="text-xs text-blue-600">Ingresos</div>
          </div>
          <div className="text-center p-2 bg-purple-50 rounded-lg">
            <div className="text-sm font-bold text-purple-600 truncate px-1">
              {formatCurrency(data.summary.averageOrderValue)}
            </div>
            <div className="text-xs text-purple-600">Promedio</div>
          </div>
        </div>

        {/* Customer Status Distribution */}
        <div className="mb-4">
          <h4 className="text-xs font-medium text-gray-700 mb-2">Distribución por Estado</h4>
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
          <h4 className="text-xs font-medium text-gray-700">
            {activeTab === 'revenue' && 'Top 10 por Ingresos'}
            {activeTab === 'orders' && 'Top 10 por Cantidad de Pedidos'}
            {activeTab === 'activity' && 'Actividad Reciente'}
          </h4>
          <div className="space-y-1.5">
            {currentData.slice(0, 10).map((customer, index) => (
              <div key={customer.customerName} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center text-xs font-bold text-purple-600 flex-shrink-0">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm text-gray-900 truncate">{customer.customerName}</div>
                    <div className="text-xs text-gray-600 truncate">
                      {customer.orderCount} pedidos • {formatCurrency(customer.averageOrderValue)}
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-sm text-gray-900 whitespace-nowrap">
                    {formatCurrency(customer.totalRevenue)}
                  </div>
                  {activeTab === 'activity' && (
                    <div className="flex items-center gap-1 text-xs text-gray-500 justify-end">
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
        </div>
      </CardContent>
    </Card>
  );
}
