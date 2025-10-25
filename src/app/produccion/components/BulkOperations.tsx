"use client";
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Checkbox } from "@/app/components/ui/checkbox";
import { Badge } from "@/app/components/ui/badge";
import { Sale } from '../types/sales';
import { 
  Users, 
  CheckCircle, 
  Clock, 
  Package, 
  Truck, 
  AlertCircle,
  Loader2
} from 'lucide-react';
import { useToast } from "@/app/hooks/use-toast";

interface BulkOperationsProps {
  selectedOrders: string[];
  allOrders: Sale[];
  onClose: () => void;
  onBulkStatusUpdate: (orderIds: string[], newStatus: string) => Promise<void>;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export function BulkOperations({ 
  selectedOrders, 
  allOrders, 
  onClose, 
  onBulkStatusUpdate,
  onSelectAll,
  onDeselectAll 
}: BulkOperationsProps) {
  const [newStatus, setNewStatus] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [statuses, setStatuses] = useState<Array<{key: string; label: string; color: string}>>([]);
  const { toast } = useToast();

  // Load statuses from API
  useEffect(() => {
    const loadStatuses = async () => {
      try {
        const response = await fetch('/api/config/status', { credentials: 'include' });
        const data = await response.json();
        if (data.status === 'success' && data.data.length > 0) {
          setStatuses(data.data);
        }
      } catch (error) {
        console.error('Error loading statuses:', error);
      }
    };
    loadStatuses();
  }, []);

  const selectedOrdersData = allOrders.filter(order => selectedOrders.includes(order.orderId));
  
  const filteredOrders = allOrders.filter(order => {
    if (filterStatus === 'all') return true;
    return order.status.toLowerCase() === filterStatus.toLowerCase();
  });

  const handleBulkUpdate = async () => {
    if (!newStatus || selectedOrders.length === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Selecciona un estado y al menos una orden.",
      });
      return;
    }

    setIsUpdating(true);
    try {
      await onBulkStatusUpdate(selectedOrders, newStatus);
      onClose();
    } catch (error) {
      console.error('Error in bulk update:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusInfo = (status: string) => {
    const statusMap: Record<string, { color: string; icon: React.ReactNode }> = {
      'Pendiente': { 
        color: 'bg-yellow-100 text-yellow-800', 
        icon: <Clock className="h-3 w-3" /> 
      },
      'En Proceso': { 
        color: 'bg-blue-100 text-blue-800', 
        icon: <Package className="h-3 w-3" /> 
      },
      'Completado': { 
        color: 'bg-green-100 text-green-800', 
        icon: <CheckCircle className="h-3 w-3" /> 
      },
      'Enviado': { 
        color: 'bg-purple-100 text-purple-800', 
        icon: <Truck className="h-3 w-3" /> 
      },
      'Entregado': { 
        color: 'bg-emerald-100 text-emerald-800', 
        icon: <CheckCircle className="h-3 w-3" /> 
      },
      'Drive': { 
        color: 'bg-indigo-100 text-indigo-800', 
        icon: <Truck className="h-3 w-3" /> 
      },
      'Impreso': { 
        color: 'bg-cyan-100 text-cyan-800', 
        icon: <Package className="h-3 w-3" /> 
      },
      'PendienteDiseño': { 
        color: 'bg-orange-100 text-orange-800', 
        icon: <AlertCircle className="h-3 w-3" /> 
      }
    };
    
    return statusMap[status] || { 
      color: 'bg-gray-100 text-gray-800', 
      icon: <Clock className="h-3 w-3" /> 
    };
  };

  const statusCounts = selectedOrdersData.reduce((acc, order) => {
    acc[order.status] = (acc[order.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Operaciones Masivas
            <Badge variant="secondary">
              {selectedOrders.length} órdenes seleccionadas
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Selection Controls */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={onSelectAll}
                disabled={selectedOrders.length === allOrders.length}
              >
                Seleccionar Todas
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDeselectAll}
                disabled={selectedOrders.length === 0}
              >
                Deseleccionar Todas
              </Button>
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Filtrar por estado:</span>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {statuses.map((status) => (
                    <SelectItem key={status.key} value={status.label.toLowerCase()}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Selected Orders Summary */}
          {selectedOrders.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-semibold">Órdenes Seleccionadas</h3>
              
              {/* Status Breakdown */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(statusCounts).map(([status, count]) => {
                  const statusInfo = getStatusInfo(status);
                  return (
                    <div key={status} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                      <Badge className={`${statusInfo.color} flex items-center gap-1`}>
                        {statusInfo.icon}
                        {status}
                      </Badge>
                      <span className="font-semibold">{count}</span>
                    </div>
                  );
                })}
              </div>

              {/* Order List */}
              <div className="max-h-40 overflow-y-auto border rounded-lg">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3">
                  {selectedOrdersData.map((order) => {
                    const statusInfo = getStatusInfo(order.status);
                    return (
                      <div key={order.orderId} className="flex items-center justify-between p-2 bg-white border rounded">
                        <div>
                          <span className="font-medium">#{order.orderId}</span>
                          <span className="text-sm text-gray-600 ml-2">{order.customerName}</span>
                        </div>
                        <Badge className={`${statusInfo.color} flex items-center gap-1`}>
                          {statusInfo.icon}
                          {order.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Bulk Action */}
          <div className="space-y-3">
            <h3 className="font-semibold">Acción Masiva</h3>
            
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium">Cambiar estado a:</span>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Seleccionar nuevo estado" />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((status) => (
                    <SelectItem key={status.key} value={status.label}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {newStatus && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Confirmación:</strong> Se cambiará el estado de {selectedOrders.length} órdenes a &quot;{newStatus}&quot;.
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button 
            onClick={handleBulkUpdate}
            disabled={!newStatus || selectedOrders.length === 0 || isUpdating}
            className="min-w-32"
          >
            {isUpdating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Actualizando...
              </>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Actualizar {selectedOrders.length} Órdenes
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
