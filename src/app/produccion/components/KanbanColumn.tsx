'use client';

import React from 'react';
import { Inbox, Loader2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import type { Sale } from '../types/sales';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  status: { id?: string; key: string; label: string; color: string };
  statuses: Array<{ id?: string; label: string }>;
  orders: Sale[];
  totalCount: number;
  onOrderClick: (order: Sale) => void;
  onMove: (order: Sale, status: string) => Promise<void>;
  movingOrderId: string | null;
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
}

function resolveColor(color: string) {
  if (color.startsWith('#')) return color;
  const colors: Record<string, string> = { yellow: '#eab308', blue: '#3b82f6', green: '#22c55e', purple: '#a855f7', emerald: '#10b981', indigo: '#6366f1', cyan: '#06b6d4', orange: '#f97316', gray: '#6b7280', red: '#ef4444' };
  return colors[color] || '#6b7280';
}

export function KanbanColumn(props: KanbanColumnProps) {
  const hex = resolveColor(props.status.color);
  return (
    <section className="kanban-column flex-shrink-0 w-[310px] rounded-xl overflow-hidden glass-column shadow-premium">
      <div className="h-[2px]" style={{ background: `linear-gradient(90deg, ${hex}, ${hex}66)` }} />
      <header className="px-4 py-3.5 border-b border-white/[0.04] flex items-center justify-between" style={{ background: `linear-gradient(180deg, ${hex}08, transparent)` }}>
        <h3 className="text-sm font-semibold" style={{ color: hex }}>{props.status.label}</h3>
        <span className="min-w-[24px] h-6 px-2 rounded-full text-xs font-semibold flex items-center justify-center" style={{ backgroundColor: `${hex}15`, color: hex }}>{props.totalCount}</span>
      </header>
      <div className="p-3 space-y-2.5 min-h-[400px] max-h-[70vh] overflow-y-auto scrollbar-kanban">
        {props.loading && props.orders.length === 0 ? (
          <div className="py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : props.orders.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground/50"><Inbox className="h-8 w-8 mx-auto mb-3" /><p className="text-xs">No hay pedidos</p></div>
        ) : props.orders.map(order => (
          <KanbanCard
            key={order.id}
            order={order}
            statuses={props.statuses}
            onClick={() => props.onOrderClick(order)}
            onMove={props.onMove}
            moving={props.movingOrderId === order.id}
          />
        ))}
        {props.hasMore && (
          <Button type="button" variant="outline" className="w-full" disabled={props.loadingMore} onClick={props.onLoadMore}>
            {props.loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Cargar más'}
          </Button>
        )}
      </div>
    </section>
  );
}
