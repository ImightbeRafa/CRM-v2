'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Sale } from '../types/sales';
import { Card, CardHeader, CardTitle, CardContent } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  status: {
    key: string;
    label: string;
    color: string;
  };
  orders: Sale[];
  onOrderClick: (order: Sale) => void;
  isUpdating: boolean;
}

export function KanbanColumn({ status, orders, onOrderClick, isUpdating }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status.label,
  });

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

  return (
    <div className="flex-shrink-0 w-80">
      <Card className={`${colors.border} border-2 ${isOver ? 'ring-2 ring-blue-400 ring-offset-2' : ''}`}>
        <CardHeader className={`${colors.bg} border-b ${colors.border}`}>
          <div className="flex items-center justify-between">
            <CardTitle className={`text-lg font-semibold ${colors.text}`}>
              {status.label}
            </CardTitle>
            <Badge variant="secondary" className={colors.badge}>
              {orders.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent 
          ref={setNodeRef}
          className={`p-4 space-y-3 min-h-[500px] max-h-[70vh] overflow-y-auto ${
            isOver ? 'bg-blue-50' : ''
          }`}
        >
          <SortableContext
            items={orders.map(o => o.orderId)}
            strategy={verticalListSortingStrategy}
          >
            {orders.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                <p className="text-sm">No hay pedidos</p>
                <p className="text-xs mt-1">Arrastra pedidos aquí</p>
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
