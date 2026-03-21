'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Sale } from '../types/sales';
import { KanbanCard } from './KanbanCard';
import { GripVertical, Inbox } from 'lucide-react';

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

  const resolveColor = (color: string): string => {
    if (color.startsWith('#')) return color;
    const tailwindToHex: Record<string, string> = {
      yellow: '#eab308', blue: '#3b82f6', green: '#22c55e',
      purple: '#a855f7', emerald: '#10b981', indigo: '#6366f1',
      cyan: '#06b6d4', orange: '#f97316', gray: '#6b7280',
      red: '#ef4444', pink: '#ec4899', teal: '#14b8a6',
    };
    return tailwindToHex[color] || '#6b7280';
  };

  const hex = resolveColor(status.color);

  return (
    <div 
      ref={setSortableRef}
      style={style}
      className="kanban-column flex-shrink-0 w-[310px]"
    >
      <div
        className={`
          relative rounded-xl overflow-hidden
          glass-column
          transition-all duration-200
          ${isOver ? 'drop-pulse ring-1 ring-blue-400/30' : ''}
          ${isSortableDragging ? 'shadow-premium-drag scale-[1.02] rotate-1' : 'shadow-premium'}
        `}
      >
        {/* Top gradient accent */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: `linear-gradient(90deg, ${hex}, ${hex}66)` }}
        />

        {/* Column header */}
        <div
          className="relative px-4 py-3.5 border-b border-white/[0.04]"
          style={{ background: `linear-gradient(180deg, ${hex}08, transparent)` }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="cursor-grab active:cursor-grabbing p-0.5 rounded-md
                  text-muted-foreground/40 hover:text-muted-foreground/70
                  hover:bg-white/5 transition-colors"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </button>
              <h3
                className="text-sm font-semibold tracking-tight"
                style={{ color: hex }}
              >
                {status.label}
              </h3>
            </div>
            <div
              className="min-w-[24px] h-6 px-2 flex items-center justify-center
                rounded-full text-xs font-semibold tabular-nums"
              style={{
                backgroundColor: `${hex}15`,
                color: hex,
              }}
            >
              {orders.length}
            </div>
          </div>
        </div>

        {/* Cards area */}
        <div
          ref={setNodeRef}
          className={`
            p-3 space-y-2.5
            min-h-[400px] max-h-[70vh]
            overflow-y-auto scrollbar-kanban
            transition-colors duration-300
            ${isOver ? 'bg-blue-500/[0.03]' : ''}
          `}
        >
          <SortableContext
            items={orders.map(o => o.orderId)}
            strategy={verticalListSortingStrategy}
          >
            {orders.length === 0 ? (
              <div className={`
                flex flex-col items-center justify-center py-16
                transition-colors duration-200
                ${isOver ? 'text-blue-400/60' : 'text-muted-foreground/30'}
              `}>
                <Inbox className={`h-8 w-8 mb-3 ${isOver ? 'text-blue-400/40' : 'text-muted-foreground/20'}`} />
                <p className="text-xs font-medium">
                  {isOver ? 'Suelta aquí' : 'No hay pedidos'}
                </p>
                {!isOver && (
                  <p className="text-[11px] mt-1 text-muted-foreground/20">
                    Arrastra pedidos aquí
                  </p>
                )}
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
        </div>
      </div>
    </div>
  );
}
