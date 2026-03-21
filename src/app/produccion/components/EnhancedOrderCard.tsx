"use client";
import React, { useState } from 'react';
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
  CheckCircle,
  Truck as TruckIcon,
  Printer,
  AlertCircle,
  Banknote
} from 'lucide-react';

interface EnhancedOrderCardProps {
  order: Sale;
  onSelectOrder: (order: Sale) => void;
  onStatusUpdate: (orderId: string, newStatus: string) => Promise<void>;
  isSelected: boolean;
  onToggleSelection: (orderId: string) => void;
  availableStatuses?: Array<{ key: string; label: string; color?: string | null }>;
  businessInfoFields?: any[];
  productFieldConfigs?: any[];
  onConfirmPayment?: (orderId: string) => Promise<void>;
}

export function EnhancedOrderCard({
  order,
  onSelectOrder,
  onStatusUpdate,
  isSelected,
  onToggleSelection,
  availableStatuses: statusesProp,
  businessInfoFields: businessInfoProp,
  productFieldConfigs: productFieldProp,
  onConfirmPayment
}: EnhancedOrderCardProps) {
  const availableStatuses = statusesProp || [];
  const businessInfoFields = businessInfoProp || [];
  const productFieldConfigs = productFieldProp || [];
  const [isUpdating, setIsUpdating] = useState(false);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);

  const handleConfirmPayment = async () => {
    if (!onConfirmPayment) return;
    setIsConfirmingPayment(true);
    try {
      await onConfirmPayment(order.orderId);
    } catch (error) {
      console.error('Error confirming payment:', error);
    } finally {
      setIsConfirmingPayment(false);
    }
  };

  const getStatusInfo = (status: string) => {
    const configuredStatus = availableStatuses.find(s => s.label === status);

    if (configuredStatus && configuredStatus.color) {
      const isHexColor = configuredStatus.color.startsWith('#');

      if (isHexColor) {
        const hex = configuredStatus.color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16);
        const g = parseInt(hex.substr(2, 2), 16);
        const b = parseInt(hex.substr(4, 2), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        const textColor = brightness > 128 ? 'text-gray-900' : 'text-white';

        return {
          color: `border-transparent ${textColor}`,
          colorStyle: { backgroundColor: configuredStatus.color },
          hexColor: configuredStatus.color,
          icon: <Clock className="h-3 w-3" />,
          label: configuredStatus.label,
          priority: 'medium' as const
        };
      } else {
        return {
          color: `${configuredStatus.color} text-white border-transparent`,
          colorStyle: undefined,
          hexColor: undefined,
          icon: <Clock className="h-3 w-3" />,
          label: configuredStatus.label,
          priority: 'medium' as const
        };
      }
    }

    const statusMap: Record<string, {
      color: string;
      colorStyle?: React.CSSProperties;
      hexColor: string;
      icon: React.ReactNode;
      label: string;
      priority: 'low' | 'medium' | 'high' | 'urgent';
    }> = {
      'Pendiente': {
        color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
        hexColor: '#eab308',
        icon: <Clock className="h-3 w-3" />,
        label: 'Pendiente',
        priority: 'high'
      },
      'En Proceso': {
        color: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
        hexColor: '#3b82f6',
        icon: <Package className="h-3 w-3" />,
        label: 'En Proceso',
        priority: 'medium'
      },
      'Completado': {
        color: 'bg-green-500/15 text-green-400 border-green-500/20',
        hexColor: '#22c55e',
        icon: <CheckCircle className="h-3 w-3" />,
        label: 'Completado',
        priority: 'low'
      },
      'Enviado': {
        color: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
        hexColor: '#a855f7',
        icon: <Truck className="h-3 w-3" />,
        label: 'Enviado',
        priority: 'low'
      },
      'Entregado': {
        color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        hexColor: '#10b981',
        icon: <CheckCircle className="h-3 w-3" />,
        label: 'Entregado',
        priority: 'low'
      },
      'Drive': {
        color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20',
        hexColor: '#6366f1',
        icon: <TruckIcon className="h-3 w-3" />,
        label: 'Drive',
        priority: 'medium'
      },
      'Impreso': {
        color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
        hexColor: '#06b6d4',
        icon: <Printer className="h-3 w-3" />,
        label: 'Impreso',
        priority: 'medium'
      },
      'PendienteDiseño': {
        color: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
        hexColor: '#f97316',
        icon: <AlertCircle className="h-3 w-3" />,
        label: 'Pendiente Diseño',
        priority: 'urgent'
      }
    };

    return statusMap[status] || {
      color: 'bg-gray-500/15 text-gray-400 border-gray-500/20',
      hexColor: '#6b7280',
      icon: <Clock className="h-3 w-3" />,
      label: status,
      priority: 'low'
    };
  };

  const getOrderAge = () => {
    const orderDate = new Date(order.timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - orderDate.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 1) return { label: 'Recién creado', color: 'text-emerald-400' };
    if (diffInHours < 24) return { label: `${Math.floor(diffInHours)}h`, color: 'text-blue-400' };
    if (diffInHours < 48) return { label: `${Math.floor(diffInHours / 24)}d`, color: 'text-orange-400' };
    return { label: `${Math.floor(diffInHours / 24)}d`, color: 'text-red-400' };
  };

  const statusInfo = getStatusInfo(order.status);
  const orderAge = getOrderAge();
  const accentColor = statusInfo.hexColor || '#6b7280';

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
    <div
      className={`
        relative overflow-hidden rounded-xl
        glass-card shadow-premium
        transition-all duration-200 ease-out cursor-pointer group
        hover:shadow-premium-hover hover:-translate-y-0.5
        ${isSelected
          ? 'ring-1 ring-blue-400/40 shadow-[0_0_20px_rgba(59,130,246,0.1)]'
          : order.contraEntrega
            ? 'ring-1 ring-amber-500/20'
            : ''
        }
      `}
    >
      {/* Left accent bar */}
      <div
        className="absolute top-0 left-0 bottom-0 w-[3px]"
        style={{ background: `linear-gradient(180deg, ${accentColor}, ${accentColor}44)` }}
      />

      {/* Header */}
      <div className="px-4 pl-5 pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelection(order.orderId)}
              className="border-white/20 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
            />
            <div>
              <h3 className="font-semibold text-sm tracking-tight">#{order.orderId}</h3>
              <p className={`text-[11px] font-medium ${orderAge.color}`}>{orderAge.label}</p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <Badge
              className={`${statusInfo.color} border flex items-center gap-1 text-[11px] px-2 py-0.5 font-medium`}
              style={statusInfo.colorStyle}
            >
              {statusInfo.icon}
              {statusInfo.label}
            </Badge>
            {order.contraEntrega && (
              <Badge className="bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 text-[10px] font-medium">
                <Banknote className="h-3 w-3" />
                CONTRA ENTREGA
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 pl-5 pb-4 space-y-3">
        {/* Customer Info */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <User className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="font-medium text-foreground">{order.customerName}</span>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
            <Phone className="h-3.5 w-3.5 text-muted-foreground/40" />
            <span>{order.phone}</span>
          </div>

          {order.email && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <span>Email:</span>
              <span>{order.email}</span>
            </div>
          )}

          {order.business && (
            <div className="text-xs text-muted-foreground/60 bg-white/[0.03] px-2.5 py-1.5 rounded-lg border border-white/[0.04]">
              {order.business}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.04]" />

        {/* Product Info */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <Package className="h-3.5 w-3.5 text-muted-foreground/50" />
            <span className="font-medium text-foreground">{order.product}</span>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
            <span>Cant: {order.quantity}</span>
            {order.size && <span>Talla: {order.size}</span>}
            {order.color && <span>Color: {order.color}</span>}
          </div>

          {order.packaging && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <span>Empaque:</span>
              <span>{order.packaging}</span>
            </div>
          )}

          {order.customization && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <span>Personalización:</span>
              <span>{order.customization}</span>
            </div>
          )}
        </div>

        {/* Delivery Status */}
        {order.delivery && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <span className="font-medium">Delivery:</span>
            <span className="bg-blue-500/10 text-blue-400 border border-blue-500/15 px-2 py-0.5 rounded-md text-[11px]">
              {order.delivery}
            </span>
          </div>
        )}

        {/* Location Info (for EA orders) */}
        {order.orderType === 'EA' && (
          <>
            <div className="border-t border-white/[0.04]" />
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground/40" />
                <span className="text-xs">
                  {(order as any).province && (order as any).canton
                    ? `${(order as any).province}, ${(order as any).canton}`
                    : 'Ubicación no especificada'
                  }
                </span>
              </div>
              {(order as any).address && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/60 pl-5">
                  <span>Dirección:</span>
                  <span>{(order as any).address}</span>
                </div>
              )}
              {(order as any).district && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/60 pl-5">
                  <span>Distrito:</span>
                  <span>{(order as any).district}</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Sales Channel */}
        {(order as any).funnel && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <span className="font-medium">Canal:</span>
            <span className="bg-blue-500/10 text-blue-400 border border-blue-500/15 px-2 py-0.5 rounded-md text-[11px]">
              {(order as any).funnel}
            </span>
          </div>
        )}

        {/* Seller */}
        {(order as any).seller && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <User className="h-3 w-3 text-muted-foreground/40" />
            <span>Vendedor: {(order as any).seller}</span>
          </div>
        )}

        {/* Username */}
        {order.username && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <span className="font-medium">Usuario:</span>
            <span>{order.username}</span>
          </div>
        )}

        {/* Dates */}
        <div className="space-y-1">
          {order.orderType === 'EA' && (order as any).expectedDate && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <Calendar className="h-3 w-3 text-muted-foreground/40" />
              <span>Esperado: {(order as any).expectedDate}</span>
            </div>
          )}

          {order.orderType === 'RA' && (order as any).agreedDate && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <Calendar className="h-3 w-3 text-muted-foreground/40" />
              <span>Acordado: {(order as any).agreedDate}</span>
            </div>
          )}

          {(order as any).saleDate && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
              <Calendar className="h-3 w-3 text-muted-foreground/40" />
              <span>Fecha de Venta: {new Date((order as any).saleDate).toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {/* Courier Info (for EA orders) */}
        {order.orderType === 'EA' && (order as any).courier && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <Truck className="h-3 w-3 text-muted-foreground/40" />
            <span>Mensajería: {(order as any).courier}</span>
          </div>
        )}

        {/* Divider */}
        <div className="border-t border-white/[0.04]" />

        {/* Cost Breakdown */}
        <div className="space-y-1 text-xs tabular-nums">
          {(order as any).productCost && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground/50">Costo Producto:</span>
              <span className="text-muted-foreground/70">₡{Number((order as any).productCost).toLocaleString()}</span>
            </div>
          )}
          {(order as any).shippingCost && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground/50">Envío:</span>
              <span className="text-muted-foreground/70">₡{Number((order as any).shippingCost).toLocaleString()}</span>
            </div>
          )}
          {(order as any).iva && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground/50">IVA:</span>
              <span className="text-muted-foreground/70">₡{Number((order as any).iva).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Total */}
        <div className="flex items-center justify-between rounded-lg bg-white/[0.03] border border-white/[0.04] px-3 py-2.5">
          <span className="text-sm font-medium text-muted-foreground/70">Total:</span>
          <span className={`text-base font-bold tabular-nums tracking-tight ${
            order.contraEntrega && !order.cePaymentConfirmed
              ? 'text-amber-400'
              : 'text-emerald-400'
          }`}>
            ₡{order.total.toLocaleString()}
          </span>
        </div>

        {/* Contra Entrega Payment Status */}
        {order.contraEntrega && (
          <div className={`rounded-lg p-2.5 ${
            order.cePaymentConfirmed
              ? 'bg-emerald-500/8 border border-emerald-500/15'
              : 'bg-amber-500/8 border border-amber-500/15'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Banknote className={`h-3.5 w-3.5 ${
                  order.cePaymentConfirmed ? 'text-emerald-400' : 'text-amber-400'
                }`} />
                <span className={`text-xs font-semibold ${
                  order.cePaymentConfirmed ? 'text-emerald-400' : 'text-amber-400'
                }`}>
                  {order.cePaymentConfirmed ? '✓ Pago Confirmado' : 'Pendiente de Cobro'}
                </span>
              </div>
              {!order.cePaymentConfirmed && onConfirmPayment && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2.5 bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/30"
                  onClick={(e) => { e.stopPropagation(); handleConfirmPayment(); }}
                  disabled={isConfirmingPayment}
                >
                  {isConfirmingPayment ? 'Confirmando...' : 'Confirmar Pago'}
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Custom Fields (ProductField + BusinessInfo) */}
        {(() => {
          let cfData: Record<string, any> = {};
          try {
            const raw = (order as any).customFields;
            cfData = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
          } catch { cfData = {}; }

          if (Object.keys(cfData).length === 0) return null;

          const labelMap: Record<string, string> = {};
          businessInfoFields.forEach((f: any) => {
            if (f?.name) labelMap[f.name] = f.label || f.name;
          });
          productFieldConfigs.forEach((f: any) => {
            if (f?.key) labelMap[f.key] = f.label || f.key;
          });

          const entries = Object.entries(cfData).filter(
            ([, v]) => v !== undefined && v !== null && String(v).trim() !== ''
          );

          if (entries.length === 0) return null;

          return (
            <>
              <div className="border-t border-white/[0.04]" />
              <div className="space-y-1 text-xs">
                {entries.map(([key, value]) => (
                  <div key={`custom-${key}`} className="flex items-start gap-2 text-muted-foreground/60">
                    <span className="font-medium">{labelMap[key] || key}:</span>
                    <span className="break-words">{typeof value === 'number' ? value.toLocaleString() : String(value)}</span>
                  </div>
                ))}
              </div>
            </>
          );
        })()}

        {/* Comments */}
        {order.comments && (
          <div className="text-xs text-muted-foreground/60 bg-white/[0.02] p-2.5 rounded-lg border-l-2 border-white/[0.06]">
            <span className="font-medium text-muted-foreground/70">Comentarios:</span>
            <p className="mt-1 leading-relaxed">{order.comments}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectOrder(order)}
            className="flex-1 h-8 text-xs bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/[0.08] rounded-lg transition-all"
          >
            <Eye className="h-3 w-3 mr-1.5" />
            Ver
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectOrder(order)}
            className="flex-1 h-8 text-xs bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/[0.08] rounded-lg transition-all"
          >
            <Edit className="h-3 w-3 mr-1.5" />
            Editar
          </Button>
        </div>

        {/* Quick Status Update */}
        <div className="pt-1">
          <select
            className="w-full text-xs rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5 text-foreground
              focus:outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500/30
              transition-colors appearance-none cursor-pointer"
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
      </div>
    </div>
  );
}
