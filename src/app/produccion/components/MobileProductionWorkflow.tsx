"use client";
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { Sale } from '../types/sales';
import { 
  ChevronRight, 
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
}

export function MobileProductionWorkflow({ 
  orders, 
  onOrderSelect, 
  onStatusUpdate 
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
        color: 'bg-yellow-100 text-yellow-800', 
        icon: <Clock className="h-4 w-4" />, 
        label: 'Pendiente',
        category: 'pending'
      },
      'En Proceso': { 
        color: 'bg-blue-100 text-blue-800', 
        icon: <Package className="h-4 w-4" />, 
        label: 'En Proceso',
        category: 'in-progress'
      },
      'Completado': { 
        color: 'bg-green-100 text-green-800', 
        icon: <CheckCircle className="h-4 w-4" />, 
        label: 'Completado',
        category: 'completed'
      },
      'Enviado': { 
        color: 'bg-purple-100 text-purple-800', 
        icon: <Truck className="h-4 w-4" />, 
        label: 'Enviado',
        category: 'completed'
      },
      'Entregado': { 
        color: 'bg-emerald-100 text-emerald-800', 
        icon: <CheckCircle className="h-4 w-4" />, 
        label: 'Entregado',
        category: 'completed'
      },
      'Drive': { 
        color: 'bg-indigo-100 text-indigo-800', 
        icon: <Truck className="h-4 w-4" />, 
        label: 'Drive',
        category: 'in-progress'
      },
      'Impreso': { 
        color: 'bg-cyan-100 text-cyan-800', 
        icon: <Package className="h-4 w-4" />, 
        label: 'Impreso',
        category: 'in-progress'
      },
      'PendienteDiseño': { 
        color: 'bg-orange-100 text-orange-800', 
        icon: <AlertCircle className="h-4 w-4" />, 
        label: 'Pendiente Diseño',
        category: 'pending'
      }
    };
    
    return statusMap[status] || { 
      color: 'bg-gray-100 text-gray-800', 
      icon: <Clock className="h-4 w-4" />, 
      label: status,
      category: 'pending'
    };
  };

  const getOrderAge = (timestamp: string) => {
    const orderDate = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 1) return { label: 'Recién creado', color: 'text-green-600', urgent: false };
    if (diffInHours < 24) return { label: `${Math.floor(diffInHours)}h`, color: 'text-blue-600', urgent: false };
    if (diffInHours < 48) return { label: `${Math.floor(diffInHours / 24)}d`, color: 'text-orange-600', urgent: true };
    return { label: `${Math.floor(diffInHours / 24)}d`, color: 'text-red-600', urgent: true };
  };

  // Get a subtle background haze color based on the status
  // Using full class names so Tailwind includes them in the build
  const getStatusBackgroundHaze = (statusColor: string) => {
    // Map of status colors to their subtle background variants
    // Using 50% opacity for better color differentiation
    const colorHazeMap: Record<string, string> = {
      'bg-blue-500': 'bg-blue-50/50 border-blue-200',
      'bg-green-500': 'bg-green-50/50 border-green-200',
      'bg-yellow-500': 'bg-yellow-50/50 border-yellow-200',
      'bg-orange-500': 'bg-orange-50/50 border-orange-200',
      'bg-red-500': 'bg-red-50/50 border-red-200',
      'bg-purple-500': 'bg-purple-50/50 border-purple-200',
      'bg-pink-500': 'bg-pink-50/50 border-pink-200',
      'bg-indigo-500': 'bg-indigo-50/50 border-indigo-200',
      'bg-cyan-500': 'bg-cyan-50/50 border-cyan-200',
      'bg-gray-500': 'bg-gray-50/50 border-gray-200',
      'bg-emerald-500': 'bg-emerald-50/50 border-emerald-200',
      'bg-lime-500': 'bg-lime-50/50 border-lime-200',
      'bg-teal-500': 'bg-teal-50/50 border-teal-200',
      'bg-sky-500': 'bg-sky-50/50 border-sky-200',
      'bg-violet-500': 'bg-violet-50/50 border-violet-200',
      'bg-fuchsia-500': 'bg-fuchsia-50/50 border-fuchsia-200',
      'bg-rose-500': 'bg-rose-50/50 border-rose-200',
      'bg-amber-500': 'bg-amber-50/50 border-amber-200',
    };
    
    // Extract the main color class (e.g., "bg-blue-500 text-white" -> "bg-blue-500")
    const colorMatch = statusColor.match(/bg-\w+-\d+/);
    if (colorMatch && colorHazeMap[colorMatch[0]]) {
      return colorHazeMap[colorMatch[0]];
    }
    
    // Fallback for unknown colors
    return 'bg-gray-50/50 border-gray-200';
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
    const statusInfo = getStatusInfo(order.status);
    const orderAge = getOrderAge(order.timestamp);
    const statusBackgroundHaze = getStatusBackgroundHaze(statusInfo.color);

    return (
      <Card 
        className={`mb-3 cursor-pointer transition-all hover:shadow-md ${
          orderAge.urgent ? 'border-red-300 bg-red-50/50' : statusBackgroundHaze
        }`}
        onClick={() => onOrderSelect(order)}
      >
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
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

          {/* Customer Info */}
          <div className="space-y-2 mb-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-gray-500" />
              <span className="font-medium">{order.customerName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-600">{order.phone}</span>
            </div>
            {order.business && (
              <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                {order.business}
              </div>
            )}
          </div>

          {/* Product Info */}
          <div className="space-y-1 mb-3">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-gray-500" />
              <span className="font-medium text-sm">{order.product}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <span>Cant: {order.quantity}</span>
              {order.size && <span>Talla: {order.size}</span>}
              {order.color && <span>Color: {order.color}</span>}
            </div>
            {(order as any).productCost && (
              <div className="text-xs text-gray-600">
                <span className="font-medium">Costo: </span>
                <span>₡{Number((order as any).productCost).toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Sales Channel & Seller */}
          <div className="space-y-1 mb-3">
            {(order as any).funnel && (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">Canal:</span>
                <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                  {(order as any).funnel}
                </span>
              </div>
            )}
            {(order as any).seller && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <User className="h-3 w-3" />
                <span>Vendedor: {(order as any).seller}</span>
              </div>
            )}
          </div>

          {/* Location (for EA orders) */}
          {order.orderType === 'EA' && (
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-gray-600">
                {(order as any).province && (order as any).canton 
                  ? `${(order as any).province}, ${(order as any).canton}`
                  : 'Ubicación no especificada'
                }
              </span>
            </div>
          )}

          {/* Dates */}
          <div className="space-y-1 mb-3">
            {order.orderType === 'EA' && (order as any).expectedDate && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-600">
                  Esperado: {(order as any).expectedDate}
                </span>
              </div>
            )}
            
            {order.orderType === 'RA' && (order as any).agreedDate && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-600">
                  Acordado: {(order as any).agreedDate}
                </span>
              </div>
            )}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Total:</span>
            <span className="text-lg font-bold text-green-600">
              ₡{order.total.toLocaleString()}
            </span>
          </div>

          {/* Quick Actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={(e) => {
                e.stopPropagation();
                onOrderSelect(order);
              }}
            >
              Ver Detalles
            </Button>
            
            <select
              className="flex-1 text-sm rounded border border-gray-300 px-2 py-1 bg-white"
              value={order.status}
              onChange={(e) => handleQuickStatusUpdate(order.orderId, e.target.value)}
              onClick={(e) => e.stopPropagation()}
            >
              {availableStatuses.length > 0
                ? availableStatuses.map((s: any) => (
                    <option key={s.key || s.label} value={s.label}>{s.label}</option>
                  ))
                : <option value={order.status}>{order.status}</option>
              }
            </select>
          </div>

          {/* Comments */}
          {order.comments && (
            <div className="mt-3 p-2 bg-gray-50 rounded text-xs">
              <span className="font-medium">Comentarios:</span>
              <p className="mt-1 text-gray-600">{order.comments}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Mobile Tabs */}
      <div className="flex bg-gray-100 rounded-lg p-1">
        <button
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
            selectedTab === 'pending'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600'
          }`}
          onClick={() => setSelectedTab('pending')}
        >
          Pendientes ({tabCounts.pending})
        </button>
        <button
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
            selectedTab === 'in-progress'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600'
          }`}
          onClick={() => setSelectedTab('in-progress')}
        >
          En Proceso ({tabCounts['in-progress']})
        </button>
        <button
          className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
            selectedTab === 'completed'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600'
          }`}
          onClick={() => setSelectedTab('completed')}
        >
          Completadas ({tabCounts.completed})
        </button>
      </div>

      {/* Orders List */}
      <div className="space-y-3">
        {filteredOrders.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="text-gray-500">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay órdenes en esta categoría</p>
            </div>
          </Card>
        ) : (
          filteredOrders.map((order) => (
            <MobileOrderCard key={order.orderId} order={order} />
          ))
        )}
      </div>

      {/* Quick Stats */}
      <Card className="p-4">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-yellow-600">{tabCounts.pending}</div>
            <div className="text-xs text-gray-600">Pendientes</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-600">{tabCounts['in-progress']}</div>
            <div className="text-xs text-gray-600">En Proceso</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">{tabCounts.completed}</div>
            <div className="text-xs text-gray-600">Completadas</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
