"use client";
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Sale } from '../types/sales';
import { 
  TrendingUp, 
  Package, 
  Truck, 
  Clock, 
  CheckCircle, 
  AlertCircle,
  DollarSign,
  Users,
  Calendar,
  BarChart3
} from 'lucide-react';

interface ProductionStatsProps {
  orders: Sale[];
  onClose?: () => void;
  detailed?: boolean;
}

export function ProductionStats({ orders, onClose, detailed = false }: ProductionStatsProps) {
  const stats = React.useMemo(() => {
    const total = orders.length;
    const eaOrders = orders.filter(o => o.orderType === 'EA');
    const raOrders = orders.filter(o => o.orderType === 'RA');
    
    // Status breakdown
    const statusCounts = orders.reduce((acc, order) => {
      acc[order.status] = (acc[order.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Revenue calculations
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    const avgOrderValue = total > 0 ? totalRevenue / total : 0;
    
    // Time-based stats
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const todayOrders = orders.filter(o => {
      const orderDate = new Date(o.timestamp);
      return orderDate >= today;
    });
    
    const yesterdayOrders = orders.filter(o => {
      const orderDate = new Date(o.timestamp);
      return orderDate >= yesterday && orderDate < today;
    });
    
    const thisWeekOrders = orders.filter(o => {
      const orderDate = new Date(o.timestamp);
      return orderDate >= thisWeek;
    });
    
    // Priority orders (older than 24 hours and still pending)
    const urgentOrders = orders.filter(o => {
      const orderDate = new Date(o.timestamp);
      const hoursOld = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
      return hoursOld > 24 && o.status === 'Pendiente';
    });
    
    // Completion rate
    const completedOrders = orders.filter(o => 
      ['Completado', 'Enviado', 'Entregado'].includes(o.status)
    ).length;
    const completionRate = total > 0 ? (completedOrders / total) * 100 : 0;
    
    return {
      total,
      eaOrders: eaOrders.length,
      raOrders: raOrders.length,
      statusCounts,
      totalRevenue,
      avgOrderValue,
      todayOrders: todayOrders.length,
      yesterdayOrders: yesterdayOrders.length,
      thisWeekOrders: thisWeekOrders.length,
      urgentOrders: urgentOrders.length,
      completionRate,
      completedOrders
    };
  }, [orders]);

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      'Pendiente': 'bg-yellow-100 text-yellow-800',
      'En Proceso': 'bg-blue-100 text-blue-800',
      'Completado': 'bg-green-100 text-green-800',
      'Enviado': 'bg-purple-100 text-purple-800',
      'Entregado': 'bg-emerald-100 text-emerald-800',
      'Drive': 'bg-indigo-100 text-indigo-800',
      'Impreso': 'bg-cyan-100 text-cyan-800',
      'PendienteDiseño': 'bg-orange-100 text-orange-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const StatCard = ({ 
    title, 
    value, 
    icon, 
    color = "text-gray-600",
    subtitle,
    trend
  }: {
    title: string;
    value: string | number;
    icon: React.ReactNode;
    color?: string;
    subtitle?: string;
    trend?: { value: number; isPositive: boolean };
  }) => (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
            {trend && (
              <div className={`flex items-center text-xs ${
                trend.isPositive ? 'text-green-600' : 'text-red-600'
              }`}>
                <TrendingUp className={`h-3 w-3 mr-1 ${
                  trend.isPositive ? '' : 'rotate-180'
                }`} />
                {Math.abs(trend.value)}%
              </div>
            )}
          </div>
          <div className={`p-2 rounded-full ${color.replace('text-', 'bg-').replace('-600', '-100')}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (detailed) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <Card className="max-w-6xl w-full max-h-[90vh] overflow-y-auto">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Estadísticas Detalladas de Producción
            </CardTitle>
            {onClose && (
              <Button variant="outline" size="sm" onClick={onClose}>
                Cerrar
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Overview Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Órdenes"
                value={stats.total}
                icon={<Package className="h-5 w-5" />}
                color="text-blue-600"
              />
              <StatCard
                title="Envíos (EA)"
                value={stats.eaOrders}
                icon={<Truck className="h-5 w-5" />}
                color="text-green-600"
              />
              <StatCard
                title="Retiros (RA)"
                value={stats.raOrders}
                icon={<Package className="h-5 w-5" />}
                color="text-purple-600"
              />
              <StatCard
                title="Órdenes Urgentes"
                value={stats.urgentOrders}
                icon={<AlertCircle className="h-5 w-5" />}
                color="text-red-600"
              />
            </div>

            {/* Revenue Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                title="Ingresos Totales"
                value={`₡${stats.totalRevenue.toLocaleString()}`}
                icon={<DollarSign className="h-5 w-5" />}
                color="text-green-600"
              />
              <StatCard
                title="Valor Promedio"
                value={`₡${stats.avgOrderValue.toLocaleString()}`}
                icon={<TrendingUp className="h-5 w-5" />}
                color="text-blue-600"
              />
              <StatCard
                title="Tasa de Completado"
                value={`${stats.completionRate.toFixed(1)}%`}
                icon={<CheckCircle className="h-5 w-5" />}
                color="text-emerald-600"
              />
            </div>

            {/* Time-based Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                title="Hoy"
                value={stats.todayOrders}
                icon={<Calendar className="h-5 w-5" />}
                color="text-blue-600"
                subtitle="Órdenes creadas hoy"
              />
              <StatCard
                title="Ayer"
                value={stats.yesterdayOrders}
                icon={<Calendar className="h-5 w-5" />}
                color="text-gray-600"
                subtitle="Órdenes de ayer"
              />
              <StatCard
                title="Esta Semana"
                value={stats.thisWeekOrders}
                icon={<Calendar className="h-5 w-5" />}
                color="text-purple-600"
                subtitle="Órdenes de la semana"
              />
            </div>

            {/* Status Breakdown */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Distribución por Estado</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(stats.statusCounts).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <Badge className={getStatusColor(status)}>
                        {status}
                      </Badge>
                    </div>
                    <span className="font-semibold">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress Bars */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Progreso de Producción</h3>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Completadas</span>
                    <span>{stats.completedOrders} / {stats.total}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-green-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${stats.completionRate}%` }}
                    />
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>En Proceso</span>
                    <span>{stats.statusCounts['En Proceso'] || 0}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${((stats.statusCounts['En Proceso'] || 0) / stats.total) * 100}%` }}
                    />
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Pendientes</span>
                    <span>{stats.statusCounts['Pendiente'] || 0}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                      className="bg-yellow-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${((stats.statusCounts['Pendiente'] || 0) / stats.total) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Total Órdenes"
        value={stats.total}
        icon={<Package className="h-5 w-5" />}
        color="text-blue-600"
      />
      <StatCard
        title="Envíos (EA)"
        value={stats.eaOrders}
        icon={<Truck className="h-5 w-5" />}
        color="text-green-600"
      />
      <StatCard
        title="Retiros (RA)"
        value={stats.raOrders}
        icon={<Package className="h-5 w-5" />}
        color="text-purple-600"
      />
      <StatCard
        title="Urgentes"
        value={stats.urgentOrders}
        icon={<AlertCircle className="h-5 w-5" />}
        color="text-red-600"
        subtitle="Más de 24h pendientes"
      />
    </div>
  );
}
