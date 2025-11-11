'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  closestCorners,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
  CollisionDetection,
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
  statuses?: Array<{key: string; label: string; color: string | null}>;
  onOrderUpdate: (orderId: string, updates: Partial<Sale>) => Promise<void>;
  onOrderClick: (order: Sale) => void;
  onStatusReorder?: (statuses: KanbanStatus[]) => Promise<void>;
}

interface KanbanStatus {
  key: string;
  label: string;
  color: string;
}

function KanbanBoardComponent({ orders, statuses: statusesProp, onOrderUpdate, onOrderClick, onStatusReorder }: KanbanBoardProps) {
  const [statuses, setStatuses] = useState<KanbanStatus[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingOrder, setUpdatingOrder] = useState<string | null>(null);
  const [isDraggingColumn, setIsDraggingColumn] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  
  // Defer heavy rendering to prevent blocking
  useEffect(() => {
    const timer = setTimeout(() => setIsRendered(true), 100);
    return () => clearTimeout(timer);
  }, []);
  const [isPanning, setIsPanning] = useState(false);
  const [panStartX, setPanStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [boardRef, setBoardRef] = useState<HTMLDivElement | null>(null);
  
  // Local state for optimistic updates
  const [localOrders, setLocalOrders] = useState<Sale[]>(orders);
  // Track pending updates to avoid race conditions
  const [pendingUpdates, setPendingUpdates] = useState<Map<string, string>>(new Map());
  
  // Ref to prevent multiple simultaneous status loads
  const statusLoadingRef = React.useRef(false);
  
  const { toast } = useToast();

  // Sync local orders with prop changes, but preserve pending updates
  useEffect(() => {
    // Only sync if we're not currently updating
    if (updatingOrder) {
      return; // Skip sync while update is in progress
    }
    
    if (pendingUpdates.size === 0) {
      // No pending updates, safe to sync
      setLocalOrders(orders);
    } else {
      // Check if parent data has caught up with pending updates
      const updatedOrders = orders.map(order => {
        const pendingStatus = pendingUpdates.get(order.orderId);
        if (pendingStatus) {
          // If parent data matches pending status, clear the pending update
          if (order.status === pendingStatus) {
            setPendingUpdates(prev => {
              const newMap = new Map(prev);
              newMap.delete(order.orderId);
              return newMap;
            });
            return order; // Use parent data
          } else {
            // Parent still has stale data, preserve pending
            return { ...order, status: pendingStatus };
          }
        }
        return order;
      });
      setLocalOrders(updatedOrders);
    }
  }, [orders, pendingUpdates, updatingOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Reduced from 8px for faster response
        tolerance: 3,
        delay: 0, // Removed delay for instant drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Custom collision detection that prioritizes columns over cards
  const customCollisionDetection: CollisionDetection = (args) => {
    // First, try to find column collisions (status labels)
    const pointerCollisions = pointerWithin(args);
    const columnCollisions = pointerCollisions.filter(collision => 
      statuses.some(status => status.label === collision.id)
    );
    
    if (columnCollisions.length > 0) {
      console.log('[KanbanBoard] Column collision detected:', columnCollisions[0].id);
      return columnCollisions;
    }
    
    // If no column collision, use closest center
    return closestCenter(args);
  };

  // Use statuses from props if provided, otherwise load from API
  useEffect(() => {
    if (statusesProp && statusesProp.length > 0) {
      const statusesData = statusesProp.map((status) => ({
        key: status.key,
        label: status.label,
        color: status.color || getStatusColor(status.label),
      }));
      setStatuses(statusesData);
      setLoading(false);
      return;
    }
    
    // Prevent duplicate loads if no props provided
    if (statusLoadingRef.current) {
      return;
    }
    
    let isMounted = true;
    statusLoadingRef.current = true;
    
    const loadStatuses = async () => {
      try {
        const response = await fetch('/api/config/status', {
          credentials: 'include',
        });
        
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!isMounted) return;
        
        if (data.status === 'success' && data.data.length > 0) {
          const statusesData = data.data.map((status: any) => ({
            key: status.key,
            label: status.label,
            color: status.color || getStatusColor(status.label),
          }));
          setStatuses(statusesData);
        } else {
          setStatuses([
            { key: 'pendiente', label: 'Pendiente', color: '#FCD34D' },
          ]);
        }
      } catch (error) {
        console.error('[KanbanBoard] Error loading statuses:', error);
        if (isMounted) {
          setStatuses([
            { key: 'pendiente', label: 'Pendiente', color: '#FCD34D' },
          ]);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          statusLoadingRef.current = false;
        }
      }
    };

    loadStatuses();
    
    return () => {
      isMounted = false;
      statusLoadingRef.current = false;
    };
  }, [statusesProp]);

  // Group orders by status and sort by timestamp (oldest first)
  // OPTIMIZED: Limit orders per column to prevent UI freeze
  const ordersByStatus = useMemo(() => {
    const grouped: Record<string, Sale[]> = {};
    
    // If no statuses loaded yet, return empty groups
    if (statuses.length === 0) {
      return grouped;
    }
    
    // Initialize all status columns
    statuses.forEach(status => {
      grouped[status.label] = [];
    });

    // OPTIMIZATION: Limit to recent orders only (last 100)
    const recentOrders = localOrders.slice(0, 100);
    
    // Group orders by status with case-insensitive matching
    recentOrders.forEach(order => {
      // Find matching status (case-insensitive)
      const matchingStatus = statuses.find(
        status => status.label.toLowerCase() === order.status.toLowerCase()
      );
      
      if (matchingStatus) {
        grouped[matchingStatus.label].push(order);
      } else {
        // Try to find a close match or add to first column
        const firstStatus = statuses[0];
        if (firstStatus) {
          grouped[firstStatus.label].push(order);
        }
      }
    });
    
    // Sort each column by timestamp (oldest first - at the top)
    // OPTIMIZATION: Limit each column to 20 orders max for performance
    Object.keys(grouped).forEach(status => {
      grouped[status].sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        return dateA - dateB; // Oldest first
      });
      // Limit to 20 orders per column
      grouped[status] = grouped[status].slice(0, 20);
    });
    
    return grouped;
  }, [localOrders, statuses]);

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

    // Handle card dragging
    const draggedOrder = localOrders.find(o => o.orderId === active.id);
    if (!draggedOrder) {
      return;
    }

    // Get the target status
    const targetStatus = over.id as string;
    const currentStatus = draggedOrder.status;

    // SAFETY CHECK: If target is an orderId instead of a status, abort
    if (targetStatus.startsWith('ORDER-')) {
      console.error('[KanbanBoard] ERROR: Dropped on an order instead of a column!');
      return;
    }

    if (currentStatus === targetStatus) {
      return;
    }

    // OPTIMISTIC UPDATE: Track pending update to prevent race conditions
    setPendingUpdates(prev => new Map(prev).set(draggedOrder.orderId, targetStatus));
    
    const updatedOrders = localOrders.map(order => 
      order.orderId === draggedOrder.orderId 
        ? { ...order, status: targetStatus }
        : order
    );
    setLocalOrders(updatedOrders);

    // Mark as updating
    setUpdatingOrder(draggedOrder.orderId);
    
    // Perform server update in background (non-blocking)
    (async () => {
      try {
        const response = await fetch('/api/orders/status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({
            orderId: draggedOrder.orderId,
            status: targetStatus
          })
        });

        if (!response.ok) {
          throw new Error('Failed to update status');
        }
        
        const result = await response.json();
        
        // Update local state with server response FIRST
        if (result.data) {
          setLocalOrders(prev => prev.map(order => 
            order.orderId === draggedOrder.orderId 
              ? { ...order, ...result.data }
              : order
          ));
        }
        
        // Notify parent to refresh ONCE (debounced via timeout)
        // This prevents multiple rapid refreshes
        setTimeout(() => {
          onOrderUpdate(draggedOrder.orderId, { status: targetStatus }).catch(err => {
            console.error('[KanbanBoard] Parent update failed (non-fatal):', err);
          });
        }, 100);
        
        // Success - show subtle confirmation
        toast({
          title: '✓ Actualizado',
          description: `${draggedOrder.orderId} → ${targetStatus}`,
          duration: 2000,
        });
      } catch (error) {
        console.error('Error updating order status:', error);
        
        // Clear pending update and revert
        setPendingUpdates(prev => {
          const newMap = new Map(prev);
          newMap.delete(draggedOrder.orderId);
          return newMap;
        });
        
        // Revert to original status
        const revertedOrders = localOrders.map(order => 
          order.orderId === draggedOrder.orderId 
            ? { ...order, status: currentStatus }
            : order
        );
        setLocalOrders(revertedOrders);
        
        toast({
          title: 'Error al actualizar',
          description: 'El cambio fue revertido. Intenta nuevamente.',
          variant: 'destructive',
          duration: 4000,
        });
      } finally {
        setUpdatingOrder(null);
      }
    })();
  };

  const activeOrder = activeId ? orders.find(o => o.orderId === activeId) : null;

  // Show loading state while deferred or loading statuses
  if (!isRendered || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm text-gray-500">
            {!isRendered ? 'Preparando tablero...' : 'Cargando estados...'}
          </p>
        </div>
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
        collisionDetection={customCollisionDetection}
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

// Export memoized version to prevent unnecessary re-renders
export const KanbanBoard = React.memo(KanbanBoardComponent);

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
