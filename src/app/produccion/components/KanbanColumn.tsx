'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Sale } from '../types/sales';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { KanbanCard } from './KanbanCard';
import { GripVertical } from 'lucide-react';

interface KanbanColumnProps {
  status: {
    key: string;
    label: string;
    color: string;
  };
  orders: Sale[];
  onOrderClick: (order: Sale) => void;
  isUpdating: boolean;
  isDragging?: boolean;
}

export function KanbanColumn({ status, orders, onOrderClick, isUpdating, isDragging = false }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status.label,
  });

  const {
    attributes,
    listeners,
    setNodeRef: setSortableRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({
    id: status.label,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.5 : 1,
  };

  // Check if color is hex code
  const isHexColor = status.color.startsWith('#');

  // Helper to convert hex to rgba
  const hexToRgba = (hex: string, opacity: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  const colorClasses: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    yellow: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      text: 'text-yellow-800',
      badge: 'bg-yellow-100 text-yellow-800',
    },
    blue: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-800',
      badge: 'bg-blue-100 text-blue-800',
    },
    green: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      text: 'text-green-800',
      badge: 'bg-green-100 text-green-800',
    },
    purple: {
      bg: 'bg-purple-50',
      border: 'border-purple-200',
      text: 'text-purple-800',
      badge: 'bg-purple-100 text-purple-800',
    },
    emerald: {
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      text: 'text-emerald-800',
      badge: 'bg-emerald-100 text-emerald-800',
    },
    indigo: {
      bg: 'bg-indigo-50',
      border: 'border-indigo-200',
      text: 'text-indigo-800',
      badge: 'bg-indigo-100 text-indigo-800',
    },
    cyan: {
      bg: 'bg-cyan-50',
      border: 'border-cyan-200',
      text: 'text-cyan-800',
      badge: 'bg-cyan-100 text-cyan-800',
    },
    orange: {
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      text: 'text-orange-800',
      badge: 'bg-orange-100 text-orange-800',
    },
    gray: {
      bg: 'bg-gray-50',
      border: 'border-gray-200',
      text: 'text-gray-800',
      badge: 'bg-gray-100 text-gray-800',
    },
  };

  const colors = colorClasses[status.color] || colorClasses.gray;

  // If hex color, use inline styles
  const headerStyle = isHexColor ? {
    backgroundColor: hexToRgba(status.color, 0.1),
    borderColor: status.color,
  } : {};

  const borderStyle = isHexColor ? {
    borderColor: status.color,
  } : {};

  return (
    <div 
      ref={setSortableRef}
      style={style}
      className="kanban-column flex-shrink-0 w-80"
    >
      <Card 
        className={`border-2 ${isOver ? 'ring-2 ring-blue-400 ring-offset-2' : ''} ${!isHexColor ? colors.border : ''} ${
          isSortableDragging ? 'shadow-xl scale-105 rotate-1' : ''
        }`}
        style={isHexColor ? borderStyle : {}}
      >
        <CardHeader 
          className={`border-b border-2 ${!isHexColor ? `${colors.bg} ${colors.border}` : ''}`}
          style={isHexColor ? headerStyle : {}}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="cursor-grab active:cursor-grabbing p-1 hover:bg-white/20 rounded transition-colors"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-4 w-4 text-gray-500" />
              </button>
              <CardTitle 
                className={`text-lg font-semibold ${!isHexColor ? colors.text : ''}`}
                style={isHexColor ? { color: status.color } : {}}
              >
                {status.label}
              </CardTitle>
            </div>
            <Badge variant="secondary" className={!isHexColor ? colors.badge : ''}>
              {orders.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent 
          ref={setNodeRef}
          className={`p-4 space-y-3 min-h-[500px] max-h-[70vh] overflow-y-auto transition-colors duration-200 ${
            isOver ? 'bg-blue-50 border-blue-300' : ''
          }`}
        >
          <SortableContext
            items={orders.map(o => o.orderId)}
            strategy={verticalListSortingStrategy}
          >
            {orders.length === 0 ? (
              <div className={`text-center py-8 transition-colors duration-200 ${
                isOver ? 'text-blue-600' : 'text-gray-400'
              }`}>
                <p className="text-sm">No hay pedidos</p>
                <p className="text-xs mt-1">
                  {isOver ? 'Suelta aquí' : 'Arrastra pedidos aquí'}
                </p>
              </div>
            ) : (
              orders.map(order => (
                <KanbanCard
                  key={order.orderId}
                  order={order}
                  onClick={() => onOrderClick(order)}
                  isDragging={false}
                />
              ))
            )}
          </SortableContext>
        </CardContent>
      </Card>
    </div>
  );
}
