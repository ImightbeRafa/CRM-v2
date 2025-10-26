'use client';

import { useState, useEffect } from 'react';
import axios from 'axios';
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { 
  Target, 
  TrendingUp, 
  Clock, 
  CheckCircle, 
  AlertTriangle,
  BarChart3,
  Zap,
  Award
} from 'lucide-react';

interface PerformanceMetrics {
  conversionRates: {
    overall: number;
    byStatus: Array<{
      status: string;
      rate: number;
      count: number;
    }>;
  };
  efficiency: {
    ordersPerDay: number;
    revenuePerDay: number;
    averageProcessingTime: number;
    customerRetentionRate: number;
  };
  trends: {
    weekOverWeek: {
      orders: number;
      revenue: number;
      customers: number;
    };
    monthOverMonth: {
      orders: number;
      revenue: number;
      customers: number;
    };
  };
  goals: {
    monthlyTarget: number;
    currentProgress: number;
    daysRemaining: number;
    projectedCompletion: number;
  };
}

interface PerformanceMetricsProps {
  startDate: string;
  endDate: string;
}

export default function PerformanceMetrics({ startDate, endDate }: PerformanceMetricsProps) {
  const [data, setData] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      // This would be a new API endpoint for performance metrics
      // For now, we'll simulate the data structure
      const mockData: PerformanceMetrics = {
        conversionRates: {
          overall: 78.5,
          byStatus: [
            { status: 'Completed', rate: 85.2, count: 156 },
            { status: 'Processing', rate: 12.1, count: 22 },
            { status: 'Pending', rate: 2.7, count: 5 }
          ]
        },
        efficiency: {
          ordersPerDay: 12.3,
          revenuePerDay: 450000,
          averageProcessingTime: 2.4,
          customerRetentionRate: 68.7
        },
        trends: {
          weekOverWeek: {
            orders: 15.2,
            revenue: 8.7,
            customers: 12.3
          },
          monthOverMonth: {
            orders: 23.1,
            revenue: 18.9,
            customers: 16.4
          }
        },
        goals: {
          monthlyTarget: 1000000,
          currentProgress: 750000,
          daysRemaining: 12,
          projectedCompletion: 95.2
        }
      };
      setData(mockData);
    } catch (error) {
      console.error('Error fetching performance metrics:', error);
      setError('Error al cargar métricas de rendimiento');
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

  const getTrendIcon = (value: number) => {
    if (value > 0) return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (value < 0) return <TrendingUp className="w-4 h-4 text-red-600 rotate-180" />;
    return <BarChart3 className="w-4 h-4 text-gray-600" />;
  };

  const getTrendColor = (value: number) => {
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Métricas de Rendimiento
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
            <Target className="w-5 h-5" />
            Métricas de Rendimiento
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
    <div className="space-y-6">
      {/* Key Performance Indicators */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Indicadores Clave de Rendimiento
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">{data.efficiency.ordersPerDay.toFixed(1)}</div>
              <div className="text-sm text-blue-600">Pedidos por Día</div>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-600">{formatCurrency(data.efficiency.revenuePerDay)}</div>
              <div className="text-sm text-green-600">Ingresos por Día</div>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">{data.efficiency.averageProcessingTime.toFixed(1)}d</div>
              <div className="text-sm text-purple-600">Tiempo Promedio</div>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-lg">
              <div className="text-2xl font-bold text-orange-600">{data.efficiency.customerRetentionRate.toFixed(1)}%</div>
              <div className="text-sm text-orange-600">Retención</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conversion Rates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="w-5 h-5" />
            Tasas de Conversión
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-center p-4 bg-gradient-to-r from-green-50 to-blue-50 rounded-lg">
              <div className="text-3xl font-bold text-green-600">{data.conversionRates.overall.toFixed(1)}%</div>
              <div className="text-sm text-gray-600">Tasa de Conversión General</div>
            </div>
            <div className="space-y-2">
              {data.conversionRates.byStatus.map((status, index) => (
                <div key={status.status} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{status.status}</Badge>
                    <span className="text-sm text-gray-600">{status.count} pedidos</span>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-gray-900">{status.rate.toFixed(1)}%</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Trends Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Análisis de Tendencias
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Semana a Semana</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Pedidos</span>
                  <div className="flex items-center gap-1">
                    {getTrendIcon(data.trends.weekOverWeek.orders)}
                    <span className={`text-sm font-medium ${getTrendColor(data.trends.weekOverWeek.orders)}`}>
                      {data.trends.weekOverWeek.orders > 0 ? '+' : ''}{data.trends.weekOverWeek.orders.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Ingresos</span>
                  <div className="flex items-center gap-1">
                    {getTrendIcon(data.trends.weekOverWeek.revenue)}
                    <span className={`text-sm font-medium ${getTrendColor(data.trends.weekOverWeek.revenue)}`}>
                      {data.trends.weekOverWeek.revenue > 0 ? '+' : ''}{data.trends.weekOverWeek.revenue.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Clientes</span>
                  <div className="flex items-center gap-1">
                    {getTrendIcon(data.trends.weekOverWeek.customers)}
                    <span className={`text-sm font-medium ${getTrendColor(data.trends.weekOverWeek.customers)}`}>
                      {data.trends.weekOverWeek.customers > 0 ? '+' : ''}{data.trends.weekOverWeek.customers.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div>
              <h4 className="font-medium text-gray-900 mb-3">Mes a Mes</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Pedidos</span>
                  <div className="flex items-center gap-1">
                    {getTrendIcon(data.trends.monthOverMonth.orders)}
                    <span className={`text-sm font-medium ${getTrendColor(data.trends.monthOverMonth.orders)}`}>
                      {data.trends.monthOverMonth.orders > 0 ? '+' : ''}{data.trends.monthOverMonth.orders.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Ingresos</span>
                  <div className="flex items-center gap-1">
                    {getTrendIcon(data.trends.monthOverMonth.revenue)}
                    <span className={`text-sm font-medium ${getTrendColor(data.trends.monthOverMonth.revenue)}`}>
                      {data.trends.monthOverMonth.revenue > 0 ? '+' : ''}{data.trends.monthOverMonth.revenue.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Clientes</span>
                  <div className="flex items-center gap-1">
                    {getTrendIcon(data.trends.monthOverMonth.customers)}
                    <span className={`text-sm font-medium ${getTrendColor(data.trends.monthOverMonth.customers)}`}>
                      {data.trends.monthOverMonth.customers > 0 ? '+' : ''}{data.trends.monthOverMonth.customers.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Goals Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5" />
            Progreso de Objetivos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="text-center p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg">
              <div className="text-3xl font-bold text-purple-600">{data.goals.projectedCompletion.toFixed(1)}%</div>
              <div className="text-sm text-gray-600">Proyección de Completado</div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Objetivo Mensual:</span>
                <span className="font-bold text-gray-900">{formatCurrency(data.goals.monthlyTarget)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Progreso Actual:</span>
                <span className="font-bold text-green-600">{formatCurrency(data.goals.currentProgress)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Días Restantes:</span>
                <span className="font-bold text-orange-600">{data.goals.daysRemaining} días</span>
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-gradient-to-r from-purple-500 to-pink-500 h-3 rounded-full transition-all duration-300"
                style={{ width: `${(data.goals.currentProgress / data.goals.monthlyTarget) * 100}%` }}
              ></div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
