'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Sale } from '../types/sales';
import { Card } from '@/app/components/ui/card';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { useToast } from '@/app/hooks/use-toast';
import { Loader2 } from 'lucide-react';

interface KanbanBoardProps {
  orders: Sale[];
  onOrderUpdate: (orderId: string, updates: Partial<Sale>) => Promise<void>;
  onOrderClick: (order: Sale) => void;
}

interface KanbanStatus {
  key: string;
  label: string;
  color: string;
}

export function KanbanBoard({ orders, onOrderUpdate, onOrderClick }: KanbanBoardProps) {
  const [statuses, setStatuses] = useState<KanbanStatus[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Load statuses from API
  useEffect(() => {
    const loadStatuses = async () => {
      try {
        const response = await fetch('/api/config/status');
        const data = await response.json();
        
        if (data.status === 'success' && data.data.length > 0) {
          const statusesData = data.data.map((status: any) => ({
            key: status.key,
            label: status.label,
            color: getStatusColor(status.label),
          }));
          setStatuses(statusesData);
        } else {
          // Fallback to default statuses if API fails
          setStatuses([
            { key: 'pendiente', label: 'Pendiente', color: 'yellow' },
            { key: 'en-proceso', label: 'En Proceso', color: 'blue' },
            { key: 'completado', label: 'Completado', color: 'green' },
            { key: 'enviado', label: 'Enviado', color: 'purple' },
            { key: 'entregado', label: 'Entregado', color: 'emerald' },
          ]);
        }
      } catch (error) {
        console.error('Error loading statuses:', error);
        // Use fallback statuses
        setStatuses([
          { key: 'pendiente', label: 'Pendiente', color: 'yellow' },
          { key: 'en-proceso', label: 'En Proceso', color: 'blue' },
          { key: 'completado', label: 'Completado', color: 'green' },
          { key: 'enviado', label: 'Enviado', color: 'purple' },
          { key: 'entregado', label: 'Entregado', color: 'emerald' },
        ]);
      } finally {
        setLoading(false);
      }
    };

    loadStatuses();
  }, []);

  // Group orders by status
  const ordersByStatus = useMemo(() => {
    const grouped: Record<string, Sale[]> = {};
    
    statuses.forEach(status => {
      grouped[status.label] = orders.filter(
        order => order.status.toLowerCase() === status.label.toLowerCase()
      );
    });
    
    return grouped;
  }, [orders, statuses]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      return;
    }

    // Find the order being dragged
    const draggedOrder = orders.find(o => o.orderId === active.id);
    if (!draggedOrder) {
      setActiveId(null);
      return;
    }

    // Get the target status
    const targetStatus = over.id as string;
    const currentStatus = draggedOrder.status;

    if (currentStatus === targetStatus) {
      setActiveId(null);
      return;
    }

    // Update the order status
    setUpdatingOrder(draggedOrder.orderId);
    
    try {
      await onOrderUpdate(draggedOrder.orderId, { status: targetStatus });
      
      toast({
        title: 'Estado actualizado',
        description: `Pedido ${draggedOrder.orderId} movido a ${targetStatus}`,
      });
    } catch (error) {
      console.error('Error updating order status:', error);
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado del pedido',
        variant: 'destructive',
      });
    } finally {
      setUpdatingOrder(null);
      setActiveId(null);
    }
  };

  const activeOrder = activeId ? orders.find(o => o.orderId === activeId) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <span className="ml-2 text-gray-600">Cargando tablero...</span>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 px-2">
        {statuses.map(status => (
          <KanbanColumn
            key={status.label}
            status={status}
            orders={ordersByStatus[status.label] || []}
            onOrderClick={onOrderClick}
            isUpdating={updatingOrder !== null}
          />
        ))}
      </div>

      <DragOverlay>
        {activeOrder ? (
          <div className="opacity-80">
            <KanbanCard 
              order={activeOrder} 
              onClick={() => {}} 
              isDragging={true}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// Helper function to get status colors
function getStatusColor(status: string): string {
  const statusColors: Record<string, string> = {
    'Pendiente': 'yellow',
    'En Proceso': 'blue',
    'Completado': 'green',
    'Enviado': 'purple',
    'Entregado': 'emerald',
    'Drive': 'indigo',
    'Impreso': 'cyan',
    'PendienteDiseño': 'orange',
  };
  
  return statusColors[status] || 'gray';
}
