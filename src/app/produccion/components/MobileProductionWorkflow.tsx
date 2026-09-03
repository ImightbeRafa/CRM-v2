"use client";
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Sale } from '../types/sales';
import { ProductionOrderWindow } from './ProductionOrderWindow';
import { 
  ChevronRight, 
  ChevronDown,
  CheckCircle, 
  Clock, 
  Package, 
  Truck, 
  AlertCircle,
  Phone,
  MapPin,
  Calendar,
  User
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface MobileProductionWorkflowProps {
  orders: Sale[];
  onOrderSelect: (order: Sale) => void;
  onStatusUpdate: (orderId: string, newStatus: string) => Promise<void>;
  resetKey?: string;
  hasMoreRemote?: boolean;
  loadingMore?: boolean;
  onLoadMoreRemote?: () => void;
}

export function MobileProductionWorkflow({ 
  orders, 
  onOrderSelect, 
  onStatusUpdate,
  resetKey = 'mobile',
  hasMoreRemote = false,
  loadingMore = false,
  onLoadMoreRemote,
}: MobileProductionWorkflowProps) {
  const [availableStatuses, setAvailableStatuses] = useState<Array<{key: string; label: string; color?: string}>>([]);
  
  // Load available statuses from API
  useEffect(() => {
    const loadStatuses = async () => {
      try {
        const response = await fetch('/api/config/status');
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
  const [selectedTab, setSelectedTab] = useState<'pending' | 'in-progress' | 'completed'>('pending');

  const getStatusInfo = (status: string) => {
    // First, try to find the status in the configured statuses with custom colors
    const configuredStatus = availableStatuses.find(s => s.label === status);
    
    if (configuredStatus && configuredStatus.color) {
      // Use the custom color from configuration
      // Determine category based on status or default to 'in-progress'
      let category: 'pending' | 'in-progress' | 'completed' = 'in-progress';
      const lowerStatus = status.toLowerCase();
      if (lowerStatus.includes('pendiente') || lowerStatus.includes('diseño')) {
        category = 'pending';
      } else if (lowerStatus.includes('completado') || lowerStatus.includes('enviado') || lowerStatus.includes('entregado')) {
        category = 'completed';
      }
      
      return {
        color: `${configuredStatus.color} text-white`,
        icon: <Clock className="h-4 w-4" />,
        label: configuredStatus.label,
        category
      };
    }
    
    // Fallback to hardcoded colors if status not configured
    const statusMap: Record<string, { 
      color: string; 
      icon: React.ReactNode; 
      label: string;
      category: 'pending' | 'in-progress' | 'completed';
    }> = {
      'Pendiente': { 
        color: 'bg-yellow-100 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-400', 
        icon: <Clock className="h-4 w-4" />, 
        label: 'Pendiente',
        category: 'pending'
      },
      'En Proceso': { 
        color: 'bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-400', 
        icon: <Package className="h-4 w-4" />, 
        label: 'En Proceso',
        category: 'in-progress'
      },
      'Completado': { 
        color: 'bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-400', 
        icon: <CheckCircle className="h-4 w-4" />, 
        label: 'Completado',
        category: 'completed'
      },
      'Enviado': { 
        color: 'bg-purple-100 dark:bg-purple-950/30 text-purple-800 dark:text-purple-400', 
        icon: <Truck className="h-4 w-4" />, 
        label: 'Enviado',
        category: 'completed'
      },
      'Entregado': { 
        color: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-400', 
        icon: <CheckCircle className="h-4 w-4" />, 
        label: 'Entregado',
        category: 'completed'
      },
      'Drive': { 
        color: 'bg-indigo-100 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-400', 
        icon: <Truck className="h-4 w-4" />, 
        label: 'Drive',
        category: 'in-progress'
      },
      'Impreso': { 
        color: 'bg-cyan-100 dark:bg-cyan-950/30 text-cyan-800 dark:text-cyan-400', 
        icon: <Package className="h-4 w-4" />, 
        label: 'Impreso',
        category: 'in-progress'
      },
      'PendienteDiseño': { 
        color: 'bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-400', 
        icon: <AlertCircle className="h-4 w-4" />, 
        label: 'Pendiente Diseño',
        category: 'pending'
      }
    };
    
    return statusMap[status] || { 
      color: 'bg-muted text-foreground', 
      icon: <Clock className="h-4 w-4" />, 
      label: status,
      category: 'pending'
    };
  };

  const getOrderAge = (timestamp: string) => {
    const orderDate = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 1) return { label: 'Recién creado', color: 'text-green-600 dark:text-green-400', urgent: false };
    if (diffInHours < 24) return { label: `${Math.floor(diffInHours)}h`, color: 'text-blue-600 dark:text-blue-400', urgent: false };
    if (diffInHours < 48) return { label: `${Math.floor(diffInHours / 24)}d`, color: 'text-orange-600 dark:text-orange-400', urgent: true };
    return { label: `${Math.floor(diffInHours / 24)}d`, color: 'text-red-600 dark:text-red-400', urgent: true };
  };

  // Get a subtle background haze color based on the status
  // Using full class names so Tailwind includes them in the build
  const getStatusBackgroundHaze = (statusColor: string) => {
    // Map of status colors to their subtle background variants
    // Using 50% opacity for better color differentiation
    const colorHazeMap: Record<string, string> = {
      'bg-blue-500': 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
      'bg-green-500': 'bg-green-50/50 dark:bg-green-950/30 border-green-200 dark:border-green-800',
      'bg-yellow-500': 'bg-yellow-50/50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800',
      'bg-orange-500': 'bg-orange-50/50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800',
      'bg-red-500': 'bg-red-50/50 dark:bg-red-950/30 border-red-200 dark:border-red-800',
      'bg-purple-500': 'bg-purple-50/50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800',
      'bg-pink-500': 'bg-pink-50/50 dark:bg-pink-950/30 border-pink-200 dark:border-pink-800',
      'bg-indigo-500': 'bg-indigo-50/50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800',
      'bg-cyan-500': 'bg-cyan-50/50 dark:bg-cyan-950/30 border-cyan-200 dark:border-cyan-800',
      'bg-gray-500': 'bg-muted/50 border-border',
      'bg-emerald-500': 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
      'bg-lime-500': 'bg-lime-50/50 dark:bg-lime-950/30 border-lime-200 dark:border-lime-800',
      'bg-teal-500': 'bg-teal-50/50 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800',
      'bg-sky-500': 'bg-sky-50/50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800',
      'bg-violet-500': 'bg-violet-50/50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800',
      'bg-fuchsia-500': 'bg-fuchsia-50/50 dark:bg-fuchsia-950/30 border-fuchsia-200 dark:border-fuchsia-800',
      'bg-rose-500': 'bg-rose-50/50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800',
      'bg-amber-500': 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
    };
    
    // Extract the main color class (e.g., "bg-blue-500 text-white" -> "bg-blue-500")
    const colorMatch = statusColor.match(/bg-\w+-\d+/);
    if (colorMatch && colorHazeMap[colorMatch[0]]) {
      return colorHazeMap[colorMatch[0]];
    }
    
    // Fallback for unknown colors
    return 'bg-muted/50 border-border';
  };

  const filteredOrders = orders.filter(order => {
    const statusInfo = getStatusInfo(order.status);
    return statusInfo.category === selectedTab;
  });

  const tabCounts = {
    pending: orders.filter(o => getStatusInfo(o.status).category === 'pending').length,
    'in-progress': orders.filter(o => getStatusInfo(o.status).category === 'in-progress').length,
    completed: orders.filter(o => getStatusInfo(o.status).category === 'completed').length
  };

  const handleQuickStatusUpdate = async (orderId: string, newStatus: string) => {
    try {
      await onStatusUpdate(orderId, newStatus);
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const MobileOrderCard = ({ order }: { order: Sale }) => {
    const [expanded, setExpanded] = useState(false);
    const statusInfo = getStatusInfo(order.status);
    const orderAge = getOrderAge(order.timestamp);
    const statusBackgroundHaze = getStatusBackgroundHaze(statusInfo.color);

    const hasDetails = order.phone || order.business || order.product || 
      (order as any).funnel || (order as any).seller || order.comments ||
      (order.orderType === 'EA' && ((order as any).province || (order as any).expectedDate)) ||
      (order.orderType === 'RA' && (order as any).agreedDate);

    return (
      <Card 
        className={`mb-3 transition-all ${
          orderAge.urgent ? 'border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30' : statusBackgroundHaze
        }`}
      >
        <CardContent className="p-4">
          {/* Summary row: always visible */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">#{order.orderId}</h3>
              {orderAge.urgent && (
                <AlertCircle className="h-4 w-4 text-red-500" />
              )}
            </div>
            <Badge className={`${statusInfo.color} flex items-center gap-1`}>
              {statusInfo.icon}
              {statusInfo.label}
            </Badge>
          </div>

          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm">{order.customerName}</span>
            </div>
            <span className="text-base font-bold text-green-600 dark:text-green-400">
              ₡{order.total.toLocaleString()}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
            <span>{orderAge.label}</span>
            {order.orderType === 'EA' && (order as any).expectedDate && (
              <span>Esperado: {(order as any).expectedDate}</span>
            )}
            {order.orderType === 'RA' && (order as any).agreedDate && (
              <span>Acordado: {(order as any).agreedDate}</span>
            )}
          </div>

          {/* Expand/collapse toggle */}
          {hasDetails && (
            <button
              className="w-full flex items-center justify-center gap-1 text-xs text-muted-foreground py-1 mb-2 hover:text-foreground transition-colors min-h-[32px]"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(!expanded);
              }}
            >
              <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {expanded ? 'Ocultar detalles' : 'Ver detalles'}
            </button>
          )}

          {/* Expanded details */}
          {expanded && (
            <div className="space-y-2 mb-3 pt-2 border-t border-border/60">
              {order.phone && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{order.phone}</span>
                </div>
              )}

              {order.business && (
                <div className="text-xs text-muted-foreground bg-muted px-2 py-1.5 rounded">
                  {order.business}
                </div>
              )}

              {order.product && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{order.product}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground ml-6">
                    <span>Cant: {order.quantity}</span>
                    {order.size && <span>Talla: {order.size}</span>}
                    {order.color && <span>Color: {order.color}</span>}
                  </div>
                  {(order as any).productCost && (
                    <div className="text-xs text-muted-foreground ml-6">
                      Costo: ₡{Number((order as any).productCost).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              {((order as any).funnel || (order as any).seller) && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {(order as any).funnel && (
                    <span className="bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-400 px-2 py-1 rounded">
                      {(order as any).funnel}
                    </span>
                  )}
                  {(order as any).seller && (
                    <span className="text-muted-foreground">
                      Vendedor: {(order as any).seller}
                    </span>
                  )}
                </div>
              )}

              {order.orderType === 'EA' && (order as any).province && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {(order as any).canton 
                      ? `${(order as any).province}, ${(order as any).canton}`
                      : (order as any).province
                    }
                  </span>
                </div>
              )}

              {order.comments && (
                <div className="p-2 bg-muted rounded text-xs">
                  <span className="font-medium">Comentarios:</span>
                  <p className="mt-1 text-muted-foreground">{order.comments}</p>
                </div>
              )}
            </div>
          )}

          {/* Quick Actions -- 44px min touch targets */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1 min-h-[44px]"
              onClick={(e) => {
                e.stopPropagation();
                onOrderSelect(order);
              }}
            >
              Ver Detalles
            </Button>
            
            <select
              className="flex-1 text-sm rounded-md border border-border px-3 py-2 bg-card text-foreground min-h-[44px]"
              value={order.status}
              onChange={(e) => handleQuickStatusUpdate(order.orderId, e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              {availableStatuses.length > 0
                ? availableStatuses.map((s: any) => (
                    <option key={s.key || s.label} value={s.label} className="bg-card text-foreground">{s.label}</option>
                  ))
                : <option value={order.status} className="bg-card text-foreground">{order.status}</option>
              }
            </select>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Mobile Tabs */}
      <div className="flex bg-muted rounded-lg p-1">
        <button
          className={`flex-1 py-3 px-3 rounded-md text-sm font-medium transition-colors min-h-[44px] ${
            selectedTab === 'pending'
              ? 'bg-card text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-muted-foreground'
          }`}
          onClick={() => setSelectedTab('pending')}
        >
          Pendientes ({tabCounts.pending})
        </button>
        <button
          className={`flex-1 py-3 px-3 rounded-md text-sm font-medium transition-colors min-h-[44px] ${
            selectedTab === 'in-progress'
              ? 'bg-card text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-muted-foreground'
          }`}
          onClick={() => setSelectedTab('in-progress')}
        >
          En Proceso ({tabCounts['in-progress']})
        </button>
        <button
          className={`flex-1 py-3 px-3 rounded-md text-sm font-medium transition-colors min-h-[44px] ${
            selectedTab === 'completed'
              ? 'bg-card text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-muted-foreground'
          }`}
          onClick={() => setSelectedTab('completed')}
        >
          Completadas ({tabCounts.completed})
        </button>
      </div>

      {/* Orders List */}
      <ProductionOrderWindow
        items={filteredOrders}
        getItemKey={(order) => order.orderId}
        resetKey={`${resetKey}:${selectedTab}`}
        hasMoreRemote={hasMoreRemote}
        loadingMore={loadingMore}
        onLoadMoreRemote={onLoadMoreRemote}
        className="space-y-3"
        empty={
          <Card className="p-8 text-center">
            <div className="text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay órdenes en esta categoría</p>
            </div>
          </Card>
        }
        renderItem={(order) => (
          <MobileOrderCard key={order.orderId} order={order} />
        )}
      />

      {/* Quick Stats */}
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{tabCounts.pending}</div>
            <div className="text-xs text-muted-foreground">Pendientes</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{tabCounts['in-progress']}</div>
            <div className="text-xs text-muted-foreground">En Proceso</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{tabCounts.completed}</div>
            <div className="text-xs text-muted-foreground">Completadas</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
