'use client';

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Sale } from '../types/sales';
import { Badge } from '@/app/components/ui/badge';
import { 
  Package, 
  User, 
  Phone, 
  MapPin, 
  Calendar,
  GripVertical,
  Banknote
} from 'lucide-react';

interface KanbanCardProps {
  order: Sale;
  onClick: () => void;
  isDragging: boolean;
}

export function KanbanCard({ order, onClick, isDragging }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ 
    id: order.orderId,
    disabled: false
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.4 : 1,
  };

  const isHighPriority = () => {
    const orderAge = Date.now() - new Date(order.timestamp).getTime();
    const daysOld = orderAge / (1000 * 60 * 60 * 24);
    return daysOld > 3 && order.status.toLowerCase() === 'pendiente';
  };

  const getAccentColor = () => {
    if (isHighPriority()) return '#ef4444';
    if (order.contraEntrega) return '#f59e0b';
    if (order.orderType === 'RA') return '#8b5cf6';
    return '#3b82f6';
  };

  const handleGripClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.grip-handle')) return;
    onClick();
  };

  const dragging = isDragging || isSortableDragging;
  const accentColor = getAccentColor();

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="kanban-card touch-none"
    >
      <div
        className={`
          relative overflow-hidden rounded-xl
          glass-card shadow-premium
          transition-all duration-200 ease-out
          cursor-pointer group
          ${dragging
            ? 'shadow-premium-drag scale-[1.03] rotate-1'
            : 'hover:shadow-premium-hover hover:-translate-y-0.5 hover:border-white/10'
          }
          ${isHighPriority()
            ? 'ring-1 ring-red-500/30'
            : order.contraEntrega
              ? 'ring-1 ring-amber-500/20'
              : ''
          }
        `}
        onClick={handleCardClick}
      >
        {/* Top accent bar */}
        <div
          className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88)` }}
        />

        <div className="p-3.5 pt-4 space-y-2.5">
          {/* Header: Order ID + Priority */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="grip-handle cursor-pointer p-0.5 rounded-md
                  text-muted-foreground/50 hover:text-muted-foreground
                  hover:bg-white/5 transition-colors z-10"
                onClick={handleGripClick}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1.5">
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
                <p className="font-semibold text-sm tracking-tight text-foreground">
                  #{order.orderId}
                </p>
              </div>
            </div>
            {isHighPriority() && (
              <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[10px] px-1.5 py-0 font-medium">
                Urgente
              </Badge>
            )}
          </div>

          {/* Draggable area */}
          <div 
            className="cursor-grab active:cursor-grabbing space-y-2"
            {...attributes}
            {...listeners}
          >
            {/* Customer */}
            <div className="space-y-1">
              <div className="flex items-center text-[13px] text-foreground font-medium">
                <User className="h-3 w-3 mr-1.5 text-muted-foreground/60" />
                <span className="truncate">{order.customerName}</span>
              </div>
              
              {order.phone && (
                <div className="flex items-center text-xs text-muted-foreground/70">
                  <Phone className="h-3 w-3 mr-1.5 text-muted-foreground/40" />
                  <span>{order.phone}</span>
                </div>
              )}
            </div>

            {/* Product */}
            <div className="flex items-start text-xs text-foreground/80">
              <Package className="h-3 w-3 mr-1.5 mt-0.5 text-muted-foreground/40 flex-shrink-0" />
              <span className="line-clamp-2 leading-relaxed">{order.product}</span>
            </div>

            {/* Location */}
            {order.orderType === 'EA' && order.district && (
              <div className="flex items-center text-xs text-muted-foreground/60">
                <MapPin className="h-3 w-3 mr-1.5 text-muted-foreground/40" />
                <span className="truncate">{order.district}</span>
              </div>
            )}

            {/* Footer: Type + Total */}
            <div className="flex items-center justify-between pt-2.5 mt-1 border-t border-white/[0.04]">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-medium border-white/10 text-muted-foreground">
                  {order.orderType}
                </Badge>
                {order.contraEntrega && (
                  <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[9px] px-1.5 py-0 font-medium">
                    <Banknote className="h-2.5 w-2.5 mr-0.5" />
                    CE
                  </Badge>
                )}
              </div>
              <span className={`text-sm font-bold tabular-nums tracking-tight ${
                order.contraEntrega && !order.cePaymentConfirmed
                  ? 'text-amber-400'
                  : 'text-foreground'
              }`}>
                {formatCurrency(order.total)}
              </span>
            </div>

            {/* CE Payment Status */}
            {order.contraEntrega && (
              <div className={`text-[10px] font-medium px-2 py-1 rounded-md text-center ${
                order.cePaymentConfirmed
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/15'
              }`}>
                {order.cePaymentConfirmed ? '✓ Cobrado' : '○ Pendiente cobro'}
              </div>
            )}

            {/* Date */}
            <div className="flex items-center text-[11px] text-muted-foreground/50">
              <Calendar className="h-2.5 w-2.5 mr-1.5" />
              {new Date(order.timestamp).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'short',
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '₡0';
  return `₡${value.toLocaleString('es-CR')}`;
}
