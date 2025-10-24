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
  DragOverEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
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
  onStatusReorder?: (statuses: KanbanStatus[]) => Promise<void>;
}

interface KanbanStatus {
  key: string;
  label: string;
  color: string;
}

export function KanbanBoard({ orders, onOrderUpdate, onOrderClick, onStatusReorder }: KanbanBoardProps) {
  const [statuses, setStatuses] = useState<KanbanStatus[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null);
  const [isDraggingColumn, setIsDraggingColumn] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStartX, setPanStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [boardRef, setBoardRef] = useState<HTMLDivElement | null>(null);
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Must move 8px before drag starts (prevents accidental clicks)
        tolerance: 5,
        delay: 50, // 50ms delay to distinguish between click and drag
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

  // Panning handlers for carousel navigation
  const handlePanStart = (e: React.MouseEvent | React.TouchEvent) => {
    // Only start panning if not dragging a column or card
    if (isDraggingColumn || activeId) return;
    
    // Check if clicking on a card (don't pan when clicking on cards)
    const target = e.target as HTMLElement;
    if (target.closest('.kanban-card')) {
      return;
    }
    
    // Allow panning when clicking on column headers or empty space
    // But not when clicking on the grip handle for column reordering
    if (target.closest('.grip-handle')) {
      return;
    }
    
    // Prevent default to avoid text selection
    e.preventDefault();
    
    setIsPanning(true);
    const clientX = 'clientX' in e ? e.clientX : e.touches[0].clientX;
    setPanStartX(clientX);
    if (boardRef) {
      setScrollLeft(boardRef.scrollLeft);
    }
  };

  const handlePanMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isPanning || !boardRef) return;
    
    e.preventDefault();
    const clientX = 'clientX' in e ? e.clientX : e.touches[0].clientX;
    const deltaX = clientX - panStartX;
    
    // Add some momentum for smoother panning
    const momentum = 1.2;
    boardRef.scrollLeft = scrollLeft - (deltaX * momentum);
  };

  const handlePanEnd = () => {
    setIsPanning(false);
  };

  // Save column order to database
  const saveColumnOrder = async (reorderedStatuses: any[]) => {
    try {
      const response = await fetch('/api/config/status/reorder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          statuses: reorderedStatuses.map((status, index) => ({
            id: status.id,
            order: index
          }))
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save column order');
      }
    } catch (error) {
      console.error('Error saving column order:', error);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const activeId = event.active.id as string;
    setActiveId(activeId);
    
    // Stop panning when dragging starts
    setIsPanning(false);
    
    // Check if we're dragging a column (status) or a card (order)
    const isColumn = statuses.some(status => status.label === activeId);
    setIsDraggingColumn(isColumn);
    
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
    setIsDraggingColumn(false);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over, delta } = event;

    // Check if there was actual movement (more than 10px in any direction)
    const actualMovement = Math.abs(delta.x) > 10 || Math.abs(delta.y) > 10;

    // Always clear active state first
    setActiveId(null);
    setDragStartPos(null);
    setIsDraggingColumn(false);

    // If no actual movement, treat as a click and ignore
    if (!actualMovement) {
      return;
    }

    if (!over) {
      return;
    }

    // Handle column reordering
    if (isDraggingColumn) {
      const oldIndex = statuses.findIndex(status => status.label === active.id);
      const newIndex = statuses.findIndex(status => status.label === over.id);
      
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newStatuses = arrayMove(statuses, oldIndex, newIndex);
        setStatuses(newStatuses);
        
        // Call the callback if provided
        if (onStatusReorder) {
          try {
            await onStatusReorder(newStatuses);
            // Save the new order to database
            await saveColumnOrder(newStatuses);
            toast({
              title: 'Columnas reordenadas',
              description: 'El orden de las columnas se ha actualizado',
            });
          } catch (error) {
            console.error('Error reordering statuses:', error);
            // Revert on error
            setStatuses(statuses);
            toast({
              title: 'Error',
              description: 'No se pudo reordenar las columnas',
              variant: 'destructive',
            });
          }
        }
      }
      return;
    }

    // Handle card dragging (existing logic)
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
    <div className="relative">
      {/* Panning indicator */}
      {!isPanning && !activeId && (
        <div className="absolute top-2 right-2 z-10 bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-medium opacity-0 hover:opacity-100 transition-opacity duration-200 pointer-events-none shadow-sm">
          ← → Arrastra para navegar
        </div>
      )}
      
      {/* Panning active indicator */}
      {isPanning && (
        <div className="absolute top-2 left-1/2 transform -translate-x-1/2 z-10 bg-blue-500 text-white px-3 py-1 rounded-full text-xs font-medium shadow-lg">
          Navegando...
        </div>
      )}
      
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div 
          ref={setBoardRef}
          className={`flex gap-4 overflow-x-auto pb-4 px-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 hover:scrollbar-thumb-gray-400 ${
            isPanning ? 'cursor-grabbing' : 'cursor-grab'
          } select-none transition-all duration-200 ${
            isPanning ? 'shadow-xl bg-blue-50/30' : 'hover:shadow-lg hover:bg-gray-50/50'
          } rounded-lg border-2 border-dashed border-transparent hover:border-blue-200 ${
            isPanning ? 'border-blue-300 bg-blue-50/50' : ''
          }`}
          onMouseDown={handlePanStart}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanEnd}
          onMouseLeave={handlePanEnd}
          onTouchStart={handlePanStart}
          onTouchMove={handlePanMove}
          onTouchEnd={handlePanEnd}
        >
        <SortableContext
          items={statuses.map(status => status.label)}
          strategy={horizontalListSortingStrategy}
        >
          {statuses.map(status => (
            <KanbanColumn
              key={status.label}
              status={status}
              orders={ordersByStatus[status.label] || []}
              onOrderClick={onOrderClick}
              isUpdating={updatingOrder !== null}
              isDragging={isDraggingColumn && activeId === status.label}
            />
          ))}
        </SortableContext>
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
          ) : isDraggingColumn && activeId ? (
            <div className="opacity-80">
              <KanbanColumn
                status={statuses.find(s => s.label === activeId)!}
                orders={[]}
                onOrderClick={() => {}}
                isUpdating={false}
                isDragging={true}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
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
