"use client";
import React, { useState, useMemo, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { Input } from "@/app/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Button } from "@/app/components/ui/button";
import { Badge } from "@/app/components/ui/badge";
import { useSalesStream } from '@/app/hooks/useSalesStream';
import { useTenantSettings } from '@/app/contexts/TenantSettingsContext';
import { Sale } from '../types/sales';
import { Loader2, Search, Filter, Download, Printer, Eye, Edit, CheckCircle, Clock, AlertCircle, Truck, Package, Users, TrendingUp, LayoutGrid, List, Kanban, FileText } from 'lucide-react';
import { useToast } from "@/app/hooks/use-toast";
import { EnhancedOrderCard } from './EnhancedOrderCard';
import { ProductionStats } from './ProductionStats';
import { BulkOperations } from './BulkOperations';
import { AdvancedFilters } from './AdvancedFilters';
import { ExportManager } from './ExportManager';
import { OrderDetails } from './OrderDetail';
import { MobileProductionWorkflow } from './MobileProductionWorkflow';
import { ProductionWorkflowGuide } from './ProductionWorkflowGuide';
import { GuiaGenerator } from './GuiaGenerator';
import { InvoiceGenerator } from '@/app/config/components/InvoiceGenerator';
import { KanbanBoard } from './KanbanBoard';

// Dynamic Status Filter Component
const StatusFilterSelect = ({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) => {
  const [statuses, setStatuses] = useState<Array<{key: string; label: string}>>([]);

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

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder="Filtrar por estado" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos los estados</SelectItem>
        {statuses.map((status) => (
          <SelectItem key={status.key} value={status.label.toLowerCase()}>
            {status.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

// Enhanced filter function with more options
const filterOrders = (
  orders: Sale[], 
  statusFilter: string, 
  searchTerm: string, 
  dateRange: { from: string; to: string },
  priorityFilter: string,
  courierFilter: string
) => {
  const searchLower = searchTerm.toLowerCase();
  return orders.filter(order => {
    // Status filter
    if (statusFilter !== 'all' && order.status.toLowerCase() !== statusFilter.toLowerCase()) {
      return false;
    }
    
    // Search filter
    const matchesSearch = (
      order.customerName.toLowerCase().includes(searchLower) ||
      order.orderId.toLowerCase().includes(searchLower) ||
      order.product.toLowerCase().includes(searchLower) ||
      order.phone.toLowerCase().includes(searchLower) ||
      order.business.toLowerCase().includes(searchLower)
    );
    
    if (!matchesSearch) return false;
    
    // Date range filter
    if (dateRange.from || dateRange.to) {
      const orderDate = new Date(order.timestamp);
      if (dateRange.from && orderDate < new Date(dateRange.from)) return false;
      if (dateRange.to && orderDate > new Date(dateRange.to)) return false;
    }
    
    // Priority filter (based on order age and status)
    if (priorityFilter !== 'all') {
      const orderAge = Date.now() - new Date(order.timestamp).getTime();
      const isUrgent = orderAge > 24 * 60 * 60 * 1000 && order.status === 'Pendiente';
      const isHigh = orderAge > 12 * 60 * 60 * 1000 && order.status === 'En Proceso';
      
      if (priorityFilter === 'urgent' && !isUrgent) return false;
      if (priorityFilter === 'high' && !isHigh) return false;
      if (priorityFilter === 'normal' && (isUrgent || isHigh)) return false;
    }
    
    // Courier filter
    if (courierFilter !== 'all' && order.orderType === 'EA') {
      const eaOrder = order as any;
      if (eaOrder.courier && !eaOrder.courier.toLowerCase().includes(courierFilter.toLowerCase())) {
        return false;
      }
    }
    
    return true;
  });
};

// Get status color and icon
const getStatusInfo = (status: string) => {
  const statusMap: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
    'Pendiente': { 
      color: 'bg-yellow-100 text-yellow-800 border-yellow-200', 
      icon: <Clock className="h-3 w-3" />, 
      label: 'Pendiente' 
    },
    'En Proceso': { 
      color: 'bg-blue-100 text-blue-800 border-blue-200', 
      icon: <Package className="h-3 w-3" />, 
      label: 'En Proceso' 
    },
    'Completado': { 
      color: 'bg-green-100 text-green-800 border-green-200', 
      icon: <CheckCircle className="h-3 w-3" />, 
      label: 'Completado' 
    },
    'Enviado': { 
      color: 'bg-purple-100 text-purple-800 border-purple-200', 
      icon: <Truck className="h-3 w-3" />, 
      label: 'Enviado' 
    },
    'Entregado': { 
      color: 'bg-emerald-100 text-emerald-800 border-emerald-200', 
      icon: <CheckCircle className="h-3 w-3" />, 
      label: 'Entregado' 
    },
    'Drive': { 
      color: 'bg-indigo-100 text-indigo-800 border-indigo-200', 
      icon: <Truck className="h-3 w-3" />, 
      label: 'Drive' 
    },
    'Impreso': { 
      color: 'bg-cyan-100 text-cyan-800 border-cyan-200', 
      icon: <Printer className="h-3 w-3" />, 
      label: 'Impreso' 
    },
    'PendienteDiseño': { 
      color: 'bg-orange-100 text-orange-800 border-orange-200', 
      icon: <AlertCircle className="h-3 w-3" />, 
      label: 'Pendiente Diseño' 
    }
  };
  
  return statusMap[status] || { 
    color: 'bg-gray-100 text-gray-800 border-gray-200', 
    icon: <Clock className="h-3 w-3" />, 
    label: status 
  };
};

// Enhanced header component
const EnhancedHeader = React.memo(({ 
  loading, 
  searchTerm, 
  onSearchChange, 
  statusFilter, 
  onStatusChange,
  onGenerateGuias,
  onGenerateInvoices,
  onExport,
  onBulkOperations,
  onShowStats,
  onShowGuide,
  viewMode,
  onViewModeChange,
  totalOrders,
  filteredCount
}: {
  loading: boolean;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  onGenerateGuias: () => void;
  onGenerateInvoices: () => void;
  onExport: () => void;
  onBulkOperations: () => void;
  onShowStats: () => void;
  onShowGuide: () => void;
  viewMode: 'table' | 'mobile' | 'kanban';
  onViewModeChange: (mode: 'table' | 'mobile' | 'kanban') => void;
  totalOrders: number;
  filteredCount: number;
}) => (
  <div className="space-y-4">
    {/* Main Header */}
    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
      <div className="flex items-center gap-4">
        <CardTitle className="flex items-center gap-2 text-2xl">
          🏭 Panel de Producción
          {loading && <Loader2 className="h-5 w-5 animate-spin" />}
        </CardTitle>
        <Badge variant="outline" className="text-sm">
          {filteredCount} de {totalOrders} órdenes
        </Badge>
      </div>
      
      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={onBulkOperations} variant="outline" size="sm">
          <Users className="h-4 w-4 mr-2" />
          Operaciones Masivas
        </Button>
        <Button onClick={onGenerateGuias} variant="outline" size="sm">
          <Truck className="h-4 w-4 mr-2" />
          Generar Guías
        </Button>
        <Button onClick={onGenerateInvoices} variant="outline" size="sm" className="bg-purple-50 border-purple-200 hover:bg-purple-100">
          <FileText className="h-4 w-4 mr-2" />
          Generar Facturas
        </Button>
        <Button onClick={onExport} variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" />
          Exportar
        </Button>
      </div>
    </div>

    {/* Filters Row */}
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
        <Input
          placeholder="Buscar por cliente, orden, producto..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>
      
      <StatusFilterSelect value={statusFilter} onValueChange={onStatusChange} />
      
      <Button variant="outline" size="sm" className="justify-start">
        <Filter className="h-4 w-4 mr-2" />
        Filtros Avanzados
      </Button>
      
      <Button 
        variant="outline" 
        size="sm" 
        className="justify-start"
        onClick={onShowStats}
      >
        <TrendingUp className="h-4 w-4 mr-2" />
        Estadísticas
      </Button>
      
      <Button 
        variant="outline" 
        size="sm" 
        className="justify-start"
        onClick={onShowGuide}
      >
        <Users className="h-4 w-4 mr-2" />
        Guía de Uso
      </Button>
      
      {/* View Mode Toggle */}
      <div className="flex gap-1 border rounded-md p-1">
        <Button 
          variant={viewMode === 'table' ? 'default' : 'ghost'}
          size="sm"
          className="px-3"
          onClick={() => onViewModeChange('table')}
          title="Vista de Tabla"
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button 
          variant={viewMode === 'kanban' ? 'default' : 'ghost'}
          size="sm"
          className="px-3"
          onClick={() => onViewModeChange('kanban')}
          title="Vista Kanban"
        >
          <Kanban className="h-4 w-4" />
        </Button>
        <Button 
          variant={viewMode === 'mobile' ? 'default' : 'ghost'}
          size="sm"
          className="px-3"
          onClick={() => onViewModeChange('mobile')}
          title="Vista Móvil"
        >
          <List className="h-4 w-4" />
        </Button>
      </div>
    </div>
  </div>
));

EnhancedHeader.displayName = 'EnhancedHeader';

export interface EnhancedProductionDashboardProps {
  onGenerateGuias: () => void;
  isGuiaGeneratorOpen: boolean;
  onGuiaGeneratorClose: () => void;
  onGenerateInvoices?: () => void;
  isInvoiceGeneratorOpen?: boolean;
  onInvoiceGeneratorClose?: () => void;
}

export function EnhancedProductionDashboard({ 
  onGenerateGuias, 
  isGuiaGeneratorOpen, 
  onGuiaGeneratorClose,
  onGenerateInvoices,
  isInvoiceGeneratorOpen = false,
  onInvoiceGeneratorClose
}: EnhancedProductionDashboardProps) {
  const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [orderTypeFilter, setOrderTypeFilter] = useState<'all' | 'EA' | 'RA' | 'urgent'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Define handleStatsFilter callback at the top level
  const handleStatsFilter = React.useCallback((filter: 'all' | 'EA' | 'RA' | 'urgent') => {
    setOrderTypeFilter(filter);
  }, []);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [courierFilter, setCourierFilter] = useState('all');
  const [showBulkOperations, setShowBulkOperations] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'table' | 'mobile' | 'kanban'>('table');
  const [showGuide, setShowGuide] = useState(false);
  const { toast } = useToast();

  const { sales: orders, isLoading: loading, error, refresh } = useSalesStream({
    pollingInterval: 30000,
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al cargar los pedidos: ${error}`,
      });
    }
  });

  const filteredOrders = useMemo(() => {
    let filtered = filterOrders(orders, statusFilter, searchTerm, dateRange, priorityFilter, courierFilter);
    
    // Apply order type filter from stat cards
    if (orderTypeFilter === 'EA') {
      filtered = filtered.filter(o => o.orderType === 'EA');
    } else if (orderTypeFilter === 'RA') {
      filtered = filtered.filter(o => o.orderType === 'RA');
    } else if (orderTypeFilter === 'urgent') {
      filtered = filtered.filter(o => {
        const orderAge = Date.now() - new Date(o.timestamp).getTime();
        return orderAge > 24 * 60 * 60 * 1000 && o.status === 'Pendiente';
      });
    }
    
    return filtered;
  }, [orders, statusFilter, searchTerm, dateRange, priorityFilter, courierFilter, orderTypeFilter]);

  const groupedOrders = useMemo(() => ({
    EA: filteredOrders.filter(order => order.orderType === 'EA'),
    RA: filteredOrders.filter(order => order.orderType === 'RA')
  }), [filteredOrders]);

  const handleStatusUpdate = async (newStatus: string) => {
    if (selectedOrder) {
      await updateOrderStatus(selectedOrder.orderId, newStatus);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      const response = await fetch('/api/orders/status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          orderId,
          status: newStatus
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      refresh();
      toast({
        title: "Estado actualizado",
        description: "El estado de la orden ha sido actualizado exitosamente.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: `No se pudo actualizar el estado de la orden: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      });
    }
  };

  const handleOrderUpdate = async (orderId: string, updatedData: Partial<Sale>): Promise<Sale> => {
    try {
      const response = await fetch('/api/orders/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          orderId,
          ...updatedData
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Server error:', errorData);
        throw new Error(errorData.error || `Failed to update order: ${response.status}`);
      }

      const responseData = await response.json();
      // API returns { status: 'success', data: order, message: '...' }
      const updatedOrder: Sale = responseData.data || responseData;
      
      refresh();
      toast({
        title: "Orden actualizada",
        description: "La información de la orden ha sido actualizada exitosamente.",
      });
      return updatedOrder;
    } catch (error) {
      console.error('Error updating order:', error);
      const errorMessage = error instanceof Error ? error.message : 'No se pudo actualizar la información de la orden.';
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
      throw error;
    }
  };

  const handleBulkStatusUpdate = async (orderIds: string[], newStatus: string) => {
    let successCount = 0;
    let failCount = 0;
    
    try {
      toast({
        title: "Procesando...",
        description: `Actualizando ${orderIds.length} órdenes...`,
      });

      // Process one at a time with progress
      for (let i = 0; i < orderIds.length; i++) {
        try {
          await updateOrderStatus(orderIds[i], newStatus);
          successCount++;
          
          // Show progress every 10 orders
          if ((i + 1) % 10 === 0 || i === orderIds.length - 1) {
            console.log(`Progress: ${i + 1}/${orderIds.length} orders updated`);
          }
        } catch (error) {
          console.error(`Failed to update order ${orderIds[i]}:`, error);
          failCount++;
        }
      }
      
      // Show final result
      if (failCount === 0) {
        toast({
          title: "✅ Completado",
          description: `${successCount} órdenes actualizadas exitosamente.`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "⚠️ Completado con errores",
          description: `${successCount} exitosos, ${failCount} fallidos.`,
        });
      }
      
      setSelectedOrders([]);
      refresh(); // Refresh data
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error en operación masiva: ${successCount} exitosos, ${failCount} fallidos.`,
      });
    }
  };

  if (loading && !orders.length) {
    return (
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Panel de Producción</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Stats Overview */}
      <ProductionStats 
        orders={orders} 
        onFilterChange={handleStatsFilter}
      />
      
      {/* Main Dashboard */}
      <Card>
        <CardHeader>
          <EnhancedHeader 
            loading={loading}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            onGenerateGuias={onGenerateGuias}
            onGenerateInvoices={onGenerateInvoices || (() => {})}
            onExport={() => setShowExport(true)}
            onBulkOperations={() => setShowBulkOperations(true)}
            onShowStats={() => setShowStats(true)}
            onShowGuide={() => setShowGuide(true)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            totalOrders={orders.length}
            filteredCount={filteredOrders.length}
          />
        </CardHeader>
        <CardContent>
          {viewMode === 'mobile' ? (
            <MobileProductionWorkflow
              orders={filteredOrders}
              onOrderSelect={setSelectedOrder}
              onStatusUpdate={handleStatusUpdate}
            />
          ) : viewMode === 'kanban' ? (
            <KanbanBoard
              orders={filteredOrders}
              onOrderUpdate={async (orderId, updates) => {
                await handleOrderUpdate(orderId, updates);
              }}
              onOrderClick={setSelectedOrder}
            />
          ) : (
            <Tabs defaultValue="EA" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="EA" className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Envíos (EA)
                  <Badge variant="secondary" className="ml-2">
                    {groupedOrders.EA.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="RA" className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Retiros (RA)
                  <Badge variant="secondary" className="ml-2">
                    {groupedOrders.RA.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>
              
              {['EA', 'RA'].map((type) => (
                <TabsContent key={type} value={type} className="mt-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {groupedOrders[type as keyof typeof groupedOrders].map((order) => (
                      <EnhancedOrderCard
                        key={order.orderId}
                        order={order}
                        onSelectOrder={setSelectedOrder}
                        onStatusUpdate={updateOrderStatus}
                        isSelected={selectedOrders.includes(order.orderId)}
                        onToggleSelection={(orderId: string) => {
                          setSelectedOrders(prev => 
                            prev.includes(orderId) 
                              ? prev.filter(id => id !== orderId)
                              : [...prev, orderId]
                          );
                        }}
                      />
                    ))}
                  </div>
                  
                  {groupedOrders[type as keyof typeof groupedOrders].length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No hay órdenes {type === 'EA' ? 'de envío' : 'de retiro'} que coincidan con los filtros</p>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* Modals and Overlays */}
      {selectedOrder && (
        <OrderDetails
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdateStatus={handleStatusUpdate}
          onUpdateOrder={handleOrderUpdate}
        />
      )}

      {showBulkOperations && (
        <BulkOperations
          selectedOrders={selectedOrders}
          allOrders={filteredOrders}
          onClose={() => setShowBulkOperations(false)}
          onBulkStatusUpdate={handleBulkStatusUpdate}
          onSelectAll={() => setSelectedOrders(filteredOrders.map(o => o.orderId))}
          onDeselectAll={() => setSelectedOrders([])}
        />
      )}

      {showExport && (
        <ExportManager
          orders={filteredOrders}
          onClose={() => setShowExport(false)}
        />
      )}

      {showAdvancedFilters && (
        <AdvancedFilters
          filters={{ dateRange, priorityFilter, courierFilter }}
          onFiltersChange={{ setDateRange, setPriorityFilter, setCourierFilter }}
          onClose={() => setShowAdvancedFilters(false)}
        />
      )}

      {showStats && (
        <ProductionStats 
          orders={orders} 
          onClose={() => setShowStats(false)}
          detailed={true}
        />
      )}

      {showGuide && (
        <ProductionWorkflowGuide
          onClose={() => setShowGuide(false)}
        />
      )}

      <GuiaGenerator
        orders={filteredOrders.filter(order => order.orderType === 'EA')}
        isOpen={isGuiaGeneratorOpen}
        onClose={onGuiaGeneratorClose}
        onUpdateOrder={handleOrderUpdate}
      />

      {onInvoiceGeneratorClose && (
        <InvoiceGenerator
          orders={filteredOrders.map(order => ({
            id: order.orderId,
            orderId: order.orderId,
            customerName: order.customerName,
            email: order.email,
            phone: order.phone,
            address: order.address,
            product: order.product,
            quantity: order.quantity,
            total: order.total,
            timestamp: order.timestamp
          }))}
          isOpen={isInvoiceGeneratorOpen}
          onClose={onInvoiceGeneratorClose}
          onInvoiceGenerated={(invoiceIds) => {
            console.log('Invoices generated:', invoiceIds);
            toast({
              title: "Facturas generadas",
              description: `${invoiceIds.length} factura(s) creadas exitosamente.`,
            });
          }}
        />
      )}
    </div>
  );
}
