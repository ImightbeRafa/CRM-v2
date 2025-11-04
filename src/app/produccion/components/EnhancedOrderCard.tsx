"use client";
import React, { useState, useEffect } from 'react';
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
  onStatusUpdate: (orderId: string, newStatus: string) => Promise<void>;
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
  const [isUpdating, setIsUpdating] = useState(false);
  const [businessInfoFields, setBusinessInfoFields] = useState<any[]>([]);

  // Load tenant custom fields definitions
  useEffect(() => {
    const fetchBusinessInfo = async () => {
      try {
        const res = await fetch('/api/config/business-info', { credentials: 'include' });
        const data = await res.json();
        if (data?.status === 'success' && Array.isArray(data.data)) {
          setBusinessInfoFields(data.data);
        }
      } catch (err) {
        console.error('Error loading business info fields:', err);
      }
    };
    fetchBusinessInfo();
  }, []);

  const getStatusInfo = (status: string) => {
    // First, try to find the status in the configured statuses with custom colors
    const configuredStatus = availableStatuses.find(s => s.label === status);
    
    if (configuredStatus && configuredStatus.color) {
      // Check if color is a hex value or a Tailwind class
      const isHexColor = configuredStatus.color.startsWith('#');
      
      if (isHexColor) {
        // For hex colors, use inline styles with proper contrast
        // Calculate text color based on brightness
        const hex = configuredStatus.color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const textColor = brightness > 128 ? 'text-gray-900' : 'text-white';
        
        return {
          color: `border-transparent ${textColor}`,
          colorStyle: { backgroundColor: configuredStatus.color },
          icon: <Clock className="h-3 w-3" />,
          label: configuredStatus.label,
          priority: 'medium' as const
        };
      } else {
        // For Tailwind classes, use as is
        return {
          color: `${configuredStatus.color} text-white border-transparent`,
          colorStyle: undefined,
          icon: <Clock className="h-3 w-3" />,
          label: configuredStatus.label,
          priority: 'medium' as const
        };
      }
    }
    
    // Fallback to hardcoded colors if status not configured
    const statusMap: Record<string, { 
      color: string; 
      colorStyle?: React.CSSProperties;
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
  const statusBackgroundHaze = getStatusBackgroundHaze(statusInfo.color);

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === order.status) return;
    
    setIsUpdating(true);
    try {
      await onStatusUpdate(order.orderId, newStatus);
    } catch (error) {
      console.error('Error updating status:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <Card className={`transition-all duration-200 hover:shadow-lg cursor-pointer ${
      isSelected ? 'ring-2 ring-blue-500 bg-blue-100/50' : statusBackgroundHaze
    }`}>
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
          
          <Badge 
            className={`${statusInfo.color} border flex items-center gap-1`}
            style={statusInfo.colorStyle}
          >
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
          
          {order.email && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="text-xs">Email:</span>
              <span className="text-xs">{order.email}</span>
            </div>
          )}
          
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
          
          {order.packaging && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span>Empaque:</span>
              <span>{order.packaging}</span>
            </div>
          )}
          
          {order.customization && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span>Personalización:</span>
              <span>{order.customization}</span>
            </div>
          )}
        </div>

        {/* Delivery Status */}
        {order.delivery && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="font-medium">Delivery:</span>
            <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">
              {order.delivery}
            </span>
          </div>
        )}

        {/* Location Info (for EA orders) */}
        {order.orderType === 'EA' && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin className="h-3 w-3" />
              <span className="text-xs">
                {(order as any).province && (order as any).canton 
                  ? `${(order as any).province}, ${(order as any).canton}`
                  : 'Ubicación no especificada'
                }
              </span>
            </div>
            {(order as any).address && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span>Dirección:</span>
                <span>{(order as any).address}</span>
              </div>
            )}
            {(order as any).district && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <span>Distrito:</span>
                <span>{(order as any).district}</span>
              </div>
            )}
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

        {/* Username */}
        {order.username && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="font-medium">Usuario:</span>
            <span>{order.username}</span>
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

          {(order as any).saleDate && (
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Calendar className="h-3 w-3" />
              <span>Fecha de Venta: {new Date((order as any).saleDate).toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {/* Courier Info (for EA orders) */}
        {order.orderType === 'EA' && (order as any).courier && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Truck className="h-3 w-3" />
            <span>Mensajería: {(order as any).courier}</span>
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

        {/* Custom Business Fields */}
        {businessInfoFields.length > 0 && (
          <div className="space-y-1 text-xs border-t pt-2">
            {businessInfoFields.map((f) => {
              // Try flat key, then customFields, then productDetails.customFields
              let value: any = (order as any)[f?.name];
              if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
                value = (order as any)?.customFields?.[f?.name];
              }
              if ((value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) && (order as any)?.productDetails) {
                try {
                  const pd = JSON.parse((order as any).productDetails);
                  value = pd?.customFields?.[f?.name];
                } catch {}
              }
              if (value === undefined || value === null || (typeof value === 'string' && String(value).trim() === '')) return null;
              return (
                <div key={`custom-${f?.id || f?.name}`} className="flex items-start gap-2 text-gray-600">
                  <span className="font-medium">{f?.label || f?.name}:</span>
                  <span className="break-words">{typeof value === 'number' ? value.toLocaleString() : String(value)}</span>
                </div>
              );
            })}
          </div>
        )}

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
            {availableStatuses.length > 0
              ? availableStatuses.map((s: any) => (
                  <option key={s.key || s.label} value={s.label}>{s.label}</option>
                ))
              : <option value={order.status}>{order.status}</option>
            }
          </select>
        </div>
      </CardContent>
    </Card>
  );
}
