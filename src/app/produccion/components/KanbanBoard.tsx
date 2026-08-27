'use client';

import React, { useMemo, useState } from 'react';
import type { Sale } from '../types/sales';
import { KanbanColumn } from './KanbanColumn';
import { useProductionOrders, useProductionStatusMove, type ProductionFilters } from '@/app/hooks/useProductionServer';
import { useToast } from '@/app/hooks/use-toast';

interface KanbanStatus { id?: string; key: string; label: string; color: string | null; }

interface KanbanBoardProps {
  orders: Sale[];
  statuses?: KanbanStatus[];
  serverDriven?: boolean;
  filters?: ProductionFilters;
  statusFilter?: string;
  onOrderClick: (order: Sale) => void;
  onOrderUpdate?: (orderId: string, updates: Partial<Sale>) => Promise<void>;
}

function fallbackColor(label: string) {
  const colors: Record<string, string> = { Pendiente: 'yellow', 'En Proceso': 'blue', Completado: 'green', Enviado: 'purple', Entregado: 'emerald' };
  return colors[label] || 'gray';
}

function ServerColumn({ status, statuses, filters, onOrderClick, onMove, movingOrderId }: {
  status: KanbanStatus;
  statuses: KanbanStatus[];
  filters: ProductionFilters;
  onOrderClick: (order: Sale) => void;
  onMove: (order: Sale, status: string) => Promise<void>;
  movingOrderId: string | null;
}) {
  const unconfigured = status.key === '__unconfigured__';
  const query = useProductionOrders({
    enabled: true,
    view: 'column',
    statusId: unconfigured ? undefined : status.id,
    unconfigured,
    filters,
    limit: 20,
  });
  return <KanbanColumn
    status={{ ...status, color: status.color || fallbackColor(status.label) }}
    statuses={statuses}
    orders={query.orders}
    totalCount={query.totalCount}
    onOrderClick={onOrderClick}
    onMove={onMove}
    movingOrderId={movingOrderId}
    loading={query.isLoading}
    hasMore={query.hasNextPage}
    loadingMore={query.isFetchingNextPage}
    onLoadMore={() => void query.fetchNextPage()}
  />;
}

function KanbanBoardComponent({ orders, statuses: provided = [], serverDriven = false, filters = {}, statusFilter = 'all', onOrderClick }: KanbanBoardProps) {
  const { toast } = useToast();
  const moveStatus = useProductionStatusMove();
  const [movingOrderId, setMovingOrderId] = useState<string | null>(null);
  const statuses = useMemo<KanbanStatus[]>(() => [
    ...provided,
    { id: undefined, key: '__unconfigured__', label: 'Sin configurar', color: '#6b7280' },
  ], [provided]);
  const configuredStatuses = statuses.filter(status => status.key !== '__unconfigured__');
  const visibleStatuses = statusFilter === 'all'
    ? statuses
    : statuses.filter(status => statusFilter === '__unconfigured__'
      ? status.key === '__unconfigured__'
      : status.label.toLowerCase() === statusFilter.toLowerCase());
  const onMove = async (order: Sale, status: string) => {
    setMovingOrderId(order.id);
    try {
      await moveStatus(order, status);
      toast({ title: 'Estado actualizado', description: `${order.orderId} → ${status}` });
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      toast({
        variant: 'destructive',
        title: code === 'STALE_ORDER' ? 'El pedido cambió' : 'No se pudo mover',
        description: code === 'STALE_ORDER' ? 'Se recargó la información. Intenta de nuevo.' : (error instanceof Error ? error.message : 'Error desconocido'),
      });
    } finally {
      setMovingOrderId(null);
    }
  };

  if (serverDriven) {
    return <div className="flex gap-4 overflow-x-auto pb-4 px-1">
      {visibleStatuses.map(status => <ServerColumn key={status.key} status={status} statuses={configuredStatuses} filters={filters} onOrderClick={onOrderClick} onMove={onMove} movingOrderId={movingOrderId} />)}
    </div>;
  }

  const grouped = new Map(statuses.map(status => [status.key, [] as Sale[]]));
  for (const order of orders) {
    const match = configuredStatuses.find(status => status.label.toLowerCase() === order.status.toLowerCase());
    grouped.get(match?.key || '__unconfigured__')?.push(order);
  }
  return <div className="flex gap-4 overflow-x-auto pb-4 px-1">
    {visibleStatuses.map(status => {
      const columnOrders = (grouped.get(status.key) || []).sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
      return <KanbanColumn key={status.key} status={{ ...status, color: status.color || fallbackColor(status.label) }} statuses={configuredStatuses} orders={columnOrders} totalCount={columnOrders.length} onOrderClick={onOrderClick} onMove={onMove} movingOrderId={movingOrderId} />;
    })}
  </div>;
}

export const KanbanBoard = React.memo(KanbanBoardComponent);
