"use client";
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext';
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
  onFilterChange?: (filter: 'all' | 'EA' | 'RA' | 'urgent') => void;
}

export const ProductionStats = React.memo(function ProductionStats({ orders, onClose, detailed = false, onFilterChange }: ProductionStatsProps) {
  const { formatCurrency } = useTenantSettings();
  const [availableStatuses, setAvailableStatuses] = useState<Array<{key: string; label: string; color?: string}>>([]);
  
  // Load available statuses from API
  useEffect(() => {
    const loadStatuses = async () => {
      try {
        const response = await fetch('/api/config/status', { credentials: 'include' });
        const data = await response.json();
        if (data.status === 'success' && data.data.length > 0) {
          setAvailableStatuses(data.data);
        }
      } catch (error) {
        console.error('Error loading statuses:', error);
      }
    };
    loadStatuses();
  }, []);
  
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
    
    // Priority orders (manually marked as urgent OR older than 24 hours and still pending)
    const urgentOrders = orders.filter(o => {
      // Check if status is manually set to "urgent" or "urgente" (case-insensitive)
      const isMarkedUrgent = o.status.toLowerCase() === 'urgent' || o.status.toLowerCase() === 'urgente';
      
      // Check if order is old and pending
      const orderDate = new Date(o.timestamp);
      const hoursOld = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
      const isOldAndPending = hoursOld > 24 && o.status === 'Pendiente';
      
      return isMarkedUrgent || isOldAndPending;
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
    // First, try to find the status in the configured statuses with custom colors
    const configuredStatus = availableStatuses.find(s => s.label === status);
    
    if (configuredStatus && configuredStatus.color) {
      // Check if color is a hex value or a Tailwind class
      const isHexColor = configuredStatus.color.startsWith('#');
      
      if (isHexColor) {
        // For hex colors, calculate text color based on brightness
        const hex = configuredStatus.color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const textColor = brightness > 128 ? 'text-foreground' : 'text-white';
        
        // Return both the color style and text color class
        return {
          className: textColor,
          style: { backgroundColor: configuredStatus.color }
        };
      } else {
        // For Tailwind classes, use as is
        return {
          className: `${configuredStatus.color} text-white`,
          style: undefined
        };
      }
    }
    
    // Fallback to hardcoded colors if status not configured
    const colors: Record<string, string> = {
      'Pendiente': 'bg-yellow-100 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-400',
      'En Proceso': 'bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-400',
      'Completado': 'bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-400',
      'Enviado': 'bg-purple-100 dark:bg-purple-950/30 text-purple-800 dark:text-purple-400',
      'Entregado': 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-400',
      'Drive': 'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-400',
      'Impreso': 'bg-cyan-100 dark:bg-cyan-950/30 text-cyan-800 dark:text-cyan-400',
      'PendienteDiseño': 'bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-400'
    };
    return {
      className: colors[status] || 'bg-muted text-foreground',
      style: undefined
    };
  };

  const VALUE_ICON_BG: Record<string, string> = {
    'text-blue-600': 'bg-blue-100 dark:bg-blue-950/30',
    'text-green-600': 'bg-green-100 dark:bg-green-950/30',
    'text-purple-600': 'bg-purple-100 dark:bg-purple-950/30',
    'text-red-600': 'bg-red-100 dark:bg-red-950/30',
    'text-emerald-600': 'bg-emerald-100 dark:bg-emerald-950/30',
    'text-gray-600': 'bg-muted',
    'text-muted-foreground': 'bg-muted',
  };

  const StatCard = React.memo(({ 
    title, 
    value, 
    icon, 
    color = "text-muted-foreground",
    subtitle,
    trend,
    onClick,
    clickable = false
  }: {
    title: string;
    value: string | number;
    icon: React.ReactNode;
    color?: string;
    subtitle?: string;
    trend?: { value: number; isPositive: boolean };
    onClick?: () => void;
    clickable?: boolean;
  }) => {
    const handleClick = React.useCallback((e: React.MouseEvent) => {
      if (onClick && clickable) {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }
    }, [onClick, clickable]);

    return (
      <Card 
        className={`transition-shadow duration-200 ${clickable ? 'hover:shadow-lg cursor-pointer hover:border-blue-400 dark:hover:border-blue-500' : 'hover:shadow-md'}`}
        onClick={handleClick}
      >
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{title}</p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
              {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
              {trend && (
                <div className={`flex items-center text-xs ${
                  trend.isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  <TrendingUp className={`h-3 w-3 mr-1 ${
                    trend.isPositive ? '' : 'rotate-180'
                  }`} />
                  {Math.abs(trend.value)}%
                </div>
              )}
              {clickable && <p className="text-xs text-blue-500 dark:text-blue-400 mt-1">👆 Click para filtrar</p>}
            </div>
            <div
              className={`p-2 rounded-full ${
                VALUE_ICON_BG[
                  color.includes('text-muted-foreground')
                    ? 'text-muted-foreground'
                    : (color.match(/text-[a-z]+-600/)?.[0] ?? 'text-muted-foreground')
                ] ?? 'bg-muted'
              }`}
            >
              {icon}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  });

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
                color="text-blue-600 dark:text-blue-400"
              />
              <StatCard
                title="Envíos (EA)"
                value={stats.eaOrders}
                icon={<Truck className="h-5 w-5" />}
                color="text-green-600 dark:text-green-400"
              />
              <StatCard
                title="Retiros (RA)"
                value={stats.raOrders}
                icon={<Package className="h-5 w-5" />}
                color="text-purple-600 dark:text-purple-400"
              />
              <StatCard
                title="Órdenes Urgentes"
                value={stats.urgentOrders}
                icon={<AlertCircle className="h-5 w-5" />}
                color="text-red-600 dark:text-red-400"
                subtitle="Estado urgente/+24h pendientes"
              />
            </div>

            {/* Revenue Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                title="Ingresos Totales"
                value={`₡${stats.totalRevenue.toLocaleString()}`}
                icon={<DollarSign className="h-5 w-5" />}
                color="text-green-600 dark:text-green-400"
              />
              <StatCard
                title="Valor Promedio"
                value={`₡${stats.avgOrderValue.toLocaleString()}`}
                icon={<TrendingUp className="h-5 w-5" />}
                color="text-blue-600 dark:text-blue-400"
              />
              <StatCard
                title="Tasa de Completado"
                value={`${stats.completionRate.toFixed(1)}%`}
                icon={<CheckCircle className="h-5 w-5" />}
                color="text-emerald-600 dark:text-emerald-400"
              />
            </div>

            {/* Time-based Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                title="Hoy"
                value={stats.todayOrders}
                icon={<Calendar className="h-5 w-5" />}
                color="text-blue-600 dark:text-blue-400"
                subtitle="Órdenes creadas hoy"
              />
              <StatCard
                title="Ayer"
                value={stats.yesterdayOrders}
                icon={<Calendar className="h-5 w-5" />}
                color="text-muted-foreground"
                subtitle="Órdenes de ayer"
              />
              <StatCard
                title="Esta Semana"
                value={stats.thisWeekOrders}
                icon={<Calendar className="h-5 w-5" />}
                color="text-purple-600 dark:text-purple-400"
                subtitle="Órdenes de la semana"
              />
            </div>

            {/* Status Breakdown */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Distribución por Estado</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(stats.statusCounts).map(([status, count]) => {
                  const statusColor = getStatusColor(status);
                  return (
                    <div key={status} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-2">
                        <Badge 
                          className={statusColor.className}
                          style={statusColor.style}
                        >
                          {status}
                        </Badge>
                      </div>
                      <span className="font-semibold">{count}</span>
                    </div>
                  );
                })}
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
                  <div className="w-full bg-muted rounded-full h-2">
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
                  <div className="w-full bg-muted rounded-full h-2">
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
                  <div className="w-full bg-muted rounded-full h-2">
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

  const handleTotalClick = React.useCallback(() => {
    onFilterChange?.('all');
  }, [onFilterChange]);

  const handleEAClick = React.useCallback(() => {
    onFilterChange?.('EA');
  }, [onFilterChange]);

  const handleRAClick = React.useCallback(() => {
    onFilterChange?.('RA');
  }, [onFilterChange]);

  const handleUrgentClick = React.useCallback(() => {
    onFilterChange?.('urgent');
  }, [onFilterChange]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Total Órdenes"
        value={stats.total}
        icon={<Package className="h-5 w-5" />}
        color="text-blue-600 dark:text-blue-400"
        onClick={handleTotalClick}
        clickable={!!onFilterChange}
      />
      <StatCard
        title="Envíos (EA)"
        value={stats.eaOrders}
        icon={<Truck className="h-5 w-5" />}
        color="text-green-600 dark:text-green-400"
        onClick={handleEAClick}
        clickable={!!onFilterChange}
      />
      <StatCard
        title="Retiros (RA)"
        value={stats.raOrders}
        icon={<Package className="h-5 w-5" />}
        color="text-purple-600 dark:text-purple-400"
        onClick={handleRAClick}
        clickable={!!onFilterChange}
      />
      <StatCard
        title="Urgentes"
        value={stats.urgentOrders}
        icon={<AlertCircle className="h-5 w-5" />}
        color="text-red-600 dark:text-red-400"
        subtitle="Estado urgente/+24h pendientes"
        onClick={handleUrgentClick}
        clickable={!!onFilterChange}
      />
    </div>
  );
});
