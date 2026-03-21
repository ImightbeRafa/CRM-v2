'use client';

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Sale } from '../types/sales';
import { Card, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { 
  Package, 
  User, 
  Phone, 
  MapPin, 
  Calendar,
  DollarSign,
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
    // Prevent drag when clicking on interactive elements
    disabled: false
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };

  const isHighPriority = () => {
    const orderAge = Date.now() - new Date(order.timestamp).getTime();
    const daysOld = orderAge / (1000 * 60 * 60 * 24);
    return daysOld > 3 && order.status.toLowerCase() === 'pendiente';
  };

  // Handle grip icon click - prevent drag and open modal
  const handleGripClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };

  // Handle card click - only if not clicking on grip icon
  const handleCardClick = (e: React.MouseEvent) => {
    // Don't open modal if clicking on grip icon
    if ((e.target as HTMLElement).closest('.grip-handle')) {
      return;
    }
    onClick();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="kanban-card touch-none"
    >
      <Card 
        className={`hover:shadow-md transition-all ${
          isDragging || isSortableDragging ? 'shadow-xl scale-105 rotate-2' : ''
        } ${isHighPriority() ? 'border-red-300 border-2' : order.contraEntrega ? 'border-amber-300 border-2 bg-amber-50/60' : 'border-gray-200'}`}
        onClick={handleCardClick}
      >
        <CardContent className="p-3 space-y-2">
          {/* Order ID and Priority */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="grip-handle cursor-pointer p-1 hover:bg-blue-50 rounded transition-colors z-10"
                onClick={handleGripClick}
              >
                <GripVertical className="h-4 w-4 text-blue-500 hover:text-blue-700" />
              </button>
              <p className="font-semibold text-sm text-gray-900">
                #{order.orderId}
              </p>
            </div>
            {isHighPriority() && (
              <Badge variant="destructive" className="text-xs">
                Urgente
              </Badge>
            )}
          </div>

          {/* Draggable Area - Everything below the grip icon */}
          <div 
            className="cursor-grab active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            {/* Customer Info */}
            <div className="space-y-1">
              <div className="flex items-center text-xs text-gray-700">
                <User className="h-3 w-3 mr-1 text-gray-400" />
                <span className="truncate">{order.customerName}</span>
              </div>
              
              {order.phone && (
                <div className="flex items-center text-xs text-gray-600">
                  <Phone className="h-3 w-3 mr-1 text-gray-400" />
                  <span>{order.phone}</span>
                </div>
              )}
            </div>

            {/* Product Info */}
            <div className="flex items-start text-xs text-gray-700 mt-2">
              <Package className="h-3 w-3 mr-1 mt-0.5 text-gray-400 flex-shrink-0" />
              <span className="line-clamp-2">{order.product}</span>
            </div>

            {/* Location */}
            {order.orderType === 'EA' && order.district && (
              <div className="flex items-center text-xs text-gray-600 mt-2">
                <MapPin className="h-3 w-3 mr-1 text-gray-400" />
                <span className="truncate">{order.district}</span>
              </div>
            )}

            {/* Order Type & Total */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-2">
              <div className="flex items-center gap-1">
                <Badge variant="outline" className="text-xs">
                  {order.orderType}
                </Badge>
                {order.contraEntrega && (
                  <Badge className="bg-amber-100 text-amber-800 border border-amber-300 text-[9px] px-1">
                    <Banknote className="h-2.5 w-2.5 mr-0.5" />
                    CE
                  </Badge>
                )}
              </div>
              <div className={`flex items-center text-sm font-semibold ${order.contraEntrega && !order.cePaymentConfirmed ? 'text-amber-700' : 'text-gray-900'}`}>
                <DollarSign className="h-3 w-3 mr-0.5" />
                {formatCurrency(order.total)}
              </div>
            </div>

            {/* CE Payment Status */}
            {order.contraEntrega && (
              <div className={`text-[10px] font-semibold mt-1 px-1.5 py-0.5 rounded text-center ${
                order.cePaymentConfirmed
                  ? 'bg-green-100 text-green-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>
                {order.cePaymentConfirmed ? '✓ Cobrado' : '○ Pendiente cobro'}
              </div>
            )}

            {/* Date */}
            <div className="flex items-center text-xs text-gray-500 mt-2">
              <Calendar className="h-3 w-3 mr-1" />
              {new Date(order.timestamp).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'short',
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Helper function for currency formatting
function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '₡0';
  return `₡${value.toLocaleString('es-CR')}`;
}
