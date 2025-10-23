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
        distance: 10, // Must move 10px before drag starts (prevents accidental clicks)
        tolerance: 5,
        delay: 100, // 100ms delay to distinguish between click and drag
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
            color: status.color || getStatusColor(status.label), // Use hex color directly or fallback
          }));
          setStatuses(statusesData);
        } else {
          // Fallback to default statuses if API fails
          setStatuses([
            { key: 'pendiente', label: 'Pendiente', color: '#FCD34D' },
            { key: 'en-proceso', label: 'En Proceso', color: '#60A5FA' },
            { key: 'urgente', label: 'Urgente', color: '#EF4444' },
            { key: 'completado', label: 'Completado', color: '#10B981' },
            { key: 'enviado', label: 'Enviado', color: '#A855F7' },
            { key: 'entregado', label: 'Entregado', color: '#059669' },
          ]);
        }
      } catch (error) {
        console.error('Error loading statuses:', error);
        // Use fallback statuses
        setStatuses([
          { key: 'pendiente', label: 'Pendiente', color: '#FCD34D' },
          { key: 'en-proceso', label: 'En Proceso', color: '#60A5FA' },
          { key: 'urgente', label: 'Urgente', color: '#EF4444' },
          { key: 'completado', label: 'Completado', color: '#10B981' },
          { key: 'enviado', label: 'Enviado', color: '#A855F7' },
          { key: 'entregado', label: 'Entregado', color: '#059669' },
        ]);
      } finally {
        setLoading(false);
      }
    };

    loadStatuses();
  }, []);

  // Group orders by status and sort by timestamp (oldest first)
  const ordersByStatus = useMemo(() => {
    const grouped: Record<string, Sale[]> = {};
    
    // Initialize all status columns
    statuses.forEach(status => {
      grouped[status.label] = [];
    });

    // Group orders by status with case-insensitive matching
    orders.forEach(order => {
      // Find matching status (case-insensitive)
      const matchingStatus = statuses.find(
        status => status.label.toLowerCase() === order.status.toLowerCase()
      );
      
      if (matchingStatus) {
        grouped[matchingStatus.label].push(order);
      } else {
        // If no matching status found, log it for debugging
        console.warn(`Order ${order.orderId} has unmapped status: "${order.status}"`);
        
        // Try to find a close match or add to first column
        const firstStatus = statuses[0];
        if (firstStatus) {
          grouped[firstStatus.label].push(order);
        }
      }
    });
    
    // Sort each column by timestamp (oldest first - at the top)
    Object.keys(grouped).forEach(status => {
      grouped[status].sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        return dateA - dateB; // Oldest first
      });
    });
    
    return grouped;
  }, [orders, statuses]);

  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    const orderId = event.active.id as string;
    setActiveId(orderId);
    // Record starting position
    if (event.activatorEvent instanceof MouseEvent || event.activatorEvent instanceof TouchEvent) {
      const clientX = 'clientX' in event.activatorEvent ? event.activatorEvent.clientX : event.activatorEvent.touches[0].clientX;
      const clientY = 'clientY' in event.activatorEvent ? event.activatorEvent.clientY : event.activatorEvent.touches[0].clientY;
      setDragStartPos({ x: clientX, y: clientY });
    }
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setDragStartPos(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over, delta } = event;

    // Check if there was actual movement (more than 15px in any direction)
    const actualMovement = Math.abs(delta.x) > 15 || Math.abs(delta.y) > 15;

    // Always clear active state first
    setActiveId(null);
    setDragStartPos(null);

    // If no actual movement, treat as a click and ignore
    if (!actualMovement) {
      return;
    }

    if (!over) {
      return;
    }

    // Find the order being dragged
    const draggedOrder = orders.find(o => o.orderId === active.id);
    if (!draggedOrder) {
      return;
    }

    // Get the target status
    const targetStatus = over.id as string;
    const currentStatus = draggedOrder.status;

    if (currentStatus === targetStatus) {
      return;
    }

    // Optimistic update: Update UI immediately
    const originalOrder = { ...draggedOrder };
    draggedOrder.status = targetStatus;

    // Mark as updating
    setUpdatingOrder(draggedOrder.orderId);
    
    try {
      // Perform the actual update
      await onOrderUpdate(draggedOrder.orderId, { status: targetStatus });
      
      toast({
        title: 'Estado actualizado',
        description: `Pedido ${draggedOrder.orderId} movido a ${targetStatus}`,
      });
    } catch (error) {
      console.error('Error updating order status:', error);
      
      // Revert optimistic update on error
      draggedOrder.status = originalOrder.status;
      
      toast({
        title: 'Error',
        description: 'No se pudo actualizar el estado. Reintentando...',
        variant: 'destructive',
      });
      
      // Retry once
      try {
        await onOrderUpdate(draggedOrder.orderId, { status: targetStatus });
        draggedOrder.status = targetStatus;
      } catch (retryError) {
        console.error('Retry failed:', retryError);
      }
    } finally {
      setUpdatingOrder(null);
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
      onDragCancel={handleDragCancel}
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
