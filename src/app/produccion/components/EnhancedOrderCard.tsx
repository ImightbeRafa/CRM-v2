"use client";
import React, { useState } from 'react';
import { Card, CardContent, CardHeader } from "@/app/components/ui/card";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Sale } from '../types/sales';
import { 
  Clock, 
  User, 
  Phone, 
  Package, 
  MapPin, 
  Calendar, 
  Truck, 
  Eye, 
  Edit,
  AlertCircle,
  CheckCircle,
  Truck as TruckIcon,
  Printer,
  AlertTriangle
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface EnhancedOrderCardProps {
  order: Sale;
  onSelectOrder: (order: Sale) => void;
  onStatusUpdate: (newStatus: string) => Promise<void>;
  isSelected: boolean;
  onToggleSelection: (orderId: string) => void;
}

export function EnhancedOrderCard({ 
  order, 
  onSelectOrder, 
  onStatusUpdate,
  isSelected,
  onToggleSelection 
}: EnhancedOrderCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  const getStatusInfo = (status: string) => {
    const statusMap: Record<string, { 
      color: string; 
      icon: React.ReactNode; 
      label: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
    }> = {
      'Pendiente': { 
        color: 'bg-yellow-100 text-yellow-800 border-yellow-200', 
        icon: <Clock className="h-3 w-3" />, 
        label: 'Pendiente',
        priority: 'high'
      },
      'En Proceso': { 
        color: 'bg-blue-100 text-blue-800 border-blue-200', 
        icon: <Package className="h-3 w-3" />, 
        label: 'En Proceso',
        priority: 'medium'
      },
      'Completado': { 
        color: 'bg-green-100 text-green-800 border-green-200', 
        icon: <CheckCircle className="h-3 w-3" />, 
        label: 'Completado',
        priority: 'low'
      },
      'Enviado': { 
        color: 'bg-purple-100 text-purple-800 border-purple-200', 
        icon: <Truck className="h-3 w-3" />, 
        label: 'Enviado',
        priority: 'low'
      },
      'Entregado': { 
        color: 'bg-emerald-100 text-emerald-800 border-emerald-200', 
        icon: <CheckCircle className="h-3 w-3" />, 
        label: 'Entregado',
        priority: 'low'
      },
      'Drive': { 
        color: 'bg-indigo-100 text-indigo-800 border-indigo-200', 
        icon: <TruckIcon className="h-3 w-3" />, 
        label: 'Drive',
        priority: 'medium'
      },
      'Impreso': { 
        color: 'bg-cyan-100 text-cyan-800 border-cyan-200', 
        icon: <Printer className="h-3 w-3" />, 
        label: 'Impreso',
        priority: 'medium'
      },
      'PendienteDiseño': { 
        color: 'bg-orange-100 text-orange-800 border-orange-200', 
        icon: <AlertCircle className="h-3 w-3" />, 
        label: 'Pendiente Diseño',
        priority: 'urgent'
      }
    };
    
    return statusMap[status] || { 
      color: 'bg-gray-100 text-gray-800 border-gray-200', 
      icon: <Clock className="h-3 w-3" />, 
      label: status,
      priority: 'low'
    };
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'border-red-300 bg-red-50';
      case 'high': return 'border-orange-300 bg-orange-50';
      case 'medium': return 'border-blue-300 bg-blue-50';
      case 'low': return 'border-gray-300 bg-gray-50';
      default: return 'border-gray-300 bg-gray-50';
    }
  };

  const getOrderAge = () => {
    const orderDate = new Date(order.timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 1) return { label: 'Recién creado', color: 'text-green-600' };
    if (diffInHours < 24) return { label: `${Math.floor(diffInHours)}h`, color: 'text-blue-600' };
    if (diffInHours < 48) return { label: `${Math.floor(diffInHours / 24)}d`, color: 'text-orange-600' };
    return { label: `${Math.floor(diffInHours / 24)}d`, color: 'text-red-600' };
  };

  const statusInfo = getStatusInfo(order.status);
  const orderAge = getOrderAge();
  const priorityColor = getPriorityColor(statusInfo.priority);

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === order.status) return;
    
    setIsUpdating(true);
    try {
      await onStatusUpdate(newStatus);
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Card className={`transition-all duration-200 hover:shadow-lg cursor-pointer ${
      isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : ''
    } ${priorityColor}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelection(order.orderId)}
              className="mr-2"
            />
            <div>
              <h3 className="font-semibold text-sm">#{order.orderId}</h3>
              <p className="text-xs text-gray-500">{orderAge.label}</p>
            </div>
          </div>
          
          <Badge className={`${statusInfo.color} border flex items-center gap-1`}>
            {statusInfo.icon}
            {statusInfo.label}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Customer Info */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <User className="h-3 w-3 text-gray-500" />
            <span className="font-medium">{order.customerName}</span>
          </div>
          
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Phone className="h-3 w-3" />
            <span>{order.phone}</span>
          </div>
          
          {order.business && (
            <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
              {order.business}
            </div>
          )}
        </div>

        {/* Product Info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <Package className="h-3 w-3 text-gray-500" />
            <span className="font-medium">{order.product}</span>
          </div>
          
          <div className="flex items-center gap-4 text-xs text-gray-600">
            <span>Cant: {order.quantity}</span>
            {order.size && <span>Talla: {order.size}</span>}
            {order.color && <span>Color: {order.color}</span>}
          </div>
        </div>

        {/* Location Info (for EA orders) */}
        {order.orderType === 'EA' && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <MapPin className="h-3 w-3" />
            <span className="text-xs">
              {(order as any).province && (order as any).canton 
                ? `${(order as any).province}, ${(order as any).canton}`
                : 'Ubicación no especificada'
              }
            </span>
          </div>
        )}

        {/* Sales Channel */}
        {(order as any).funnel && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="font-medium">Canal:</span>
            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
              {(order as any).funnel}
            </span>
          </div>
        )}

        {/* Seller */}
        {(order as any).seller && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <User className="h-3 w-3" />
            <span>Vendedor: {(order as any).seller}</span>
          </div>
        )}

        {/* Dates */}
        <div className="space-y-1">
          {order.orderType === 'EA' && (order as any).expectedDate && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Calendar className="h-3 w-3" />
              <span>Esperado: {(order as any).expectedDate}</span>
            </div>
          )}
          
          {order.orderType === 'RA' && (order as any).agreedDate && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Calendar className="h-3 w-3" />
              <span>Acordado: {(order as any).agreedDate}</span>
            </div>
          )}
        </div>

        {/* Courier Info (for EA orders) */}
        {order.orderType === 'EA' && (order as any).courier && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Truck className="h-3 w-3" />
            <span>{(order as any).courier}</span>
          </div>
        )}

        {/* Cost Breakdown */}
        <div className="space-y-1 text-xs">
          {(order as any).productCost && (
            <div className="flex items-center justify-between">
              <span>Costo Producto:</span>
              <span className="text-gray-600">₡{Number((order as any).productCost).toLocaleString()}</span>
            </div>
          )}
          {(order as any).shippingCost && (
            <div className="flex items-center justify-between">
              <span>Envío:</span>
              <span className="text-gray-600">₡{Number((order as any).shippingCost).toLocaleString()}</span>
            </div>
          )}
          {(order as any).iva && (
            <div className="flex items-center justify-between">
              <span>IVA:</span>
              <span className="text-gray-600">₡{Number((order as any).iva).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Total */}
        <div className="flex items-center justify-between text-sm font-medium border-t pt-2">
          <span>Total:</span>
          <span className="text-green-600">₡{order.total.toLocaleString()}</span>
        </div>

        {/* Comments */}
        {order.comments && (
          <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
            <span className="font-medium">Comentarios:</span>
            <p className="mt-1">{order.comments}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelectOrder(order)}
            className="flex-1"
          >
            <Eye className="h-3 w-3 mr-1" />
            Ver
          </Button>
          
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSelectOrder(order)}
            className="flex-1"
          >
            <Edit className="h-3 w-3 mr-1" />
            Editar
          </Button>
        </div>

        {/* Quick Status Update */}
        <div className="pt-2 border-t">
          <select
            className="w-full text-xs rounded border border-gray-300 px-2 py-1 bg-white"
            value={order.status}
            onChange={(e) => handleStatusChange(e.target.value)}
            disabled={isUpdating}
          >
            <option value="Pendiente">Pendiente</option>
            <option value="En Proceso">En Proceso</option>
            <option value="Completado">Completado</option>
            <option value="Enviado">Enviado</option>
            <option value="Entregado">Entregado</option>
            <option value="Drive">Drive</option>
            <option value="Impreso">Impreso</option>
            <option value="PendienteDiseño">Pendiente Diseño</option>
          </select>
        </div>
      </CardContent>
    </Card>
  );
}
