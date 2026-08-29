"use client";
import React, { useState, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
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
import { useConfig } from '@/app/contexts/ConfigContext';
import { OrderStatus } from '@/app/config/components/StatusManager';
import { Sale } from '../types/sales';
import { Loader2, Search, Filter, Download, Printer, Eye, Edit, CheckCircle, Clock, AlertCircle, Truck, Package, Users, TrendingUp, LayoutGrid, List, Kanban, FileText, RefreshCw } from 'lucide-react';
import { useToast } from "@/app/hooks/use-toast";
import { EnhancedOrderCard } from './EnhancedOrderCard';
import { ProductionStats } from './ProductionStats';
import { BulkOperations } from './BulkOperations';
import { AdvancedFilters } from './AdvancedFilters';
import { ExportManager } from './ExportManager';
import { OrderDetails } from './OrderDetail';
import { MobileProductionWorkflow } from './MobileProductionWorkflow';
import { ProductionWorkflowGuide } from './ProductionWorkflowGuide';
import {
  useProductionMetadata,
  useProductionOrders,
  useProductionStatusMove,
  useProductionSummary,
  type ProductionFilters,
} from '@/app/hooks/useProductionServer';

const GuiaGenerator = dynamic(
  () => import('./GuiaGenerator').then((module) => module.GuiaGenerator),
  { ssr: false },
);
const InvoiceGenerator = dynamic(
  () => import('@/app/config/components/InvoiceGenerator').then((module) => module.InvoiceGenerator),
  { ssr: false },
);
const KanbanBoard = dynamic(
  () => import('./KanbanBoard').then((module) => module.KanbanBoard),
  { ssr: false },
);

// Dynamic Status Filter Component - now using global config
const StatusFilterSelect = ({ value, onValueChange, statuses }: { value: string; onValueChange: (value: string) => void; statuses: OrderStatus[] }) => {
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
        <SelectItem value="__unconfigured__">Sin configurar</SelectItem>
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
      color: 'bg-yellow-100 dark:bg-yellow-950/40 text-yellow-800 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
      icon: <Clock className="h-3 w-3" />,
      label: 'Pendiente'
    },
    'En Proceso': {
      color: 'bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-400 border-blue-200 dark:border-blue-800',
      icon: <Package className="h-3 w-3" />,
      label: 'En Proceso'
    },
    'Completado': {
      color: 'bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-400 border-green-200 dark:border-green-800',
      icon: <CheckCircle className="h-3 w-3" />,
      label: 'Completado'
    },
    'Enviado': {
      color: 'bg-purple-100 dark:bg-purple-950/40 text-purple-800 dark:text-purple-400 border-purple-200 dark:border-purple-800',
      icon: <Truck className="h-3 w-3" />,
      label: 'Enviado'
    },
    'Entregado': {
      color: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
      icon: <CheckCircle className="h-3 w-3" />,
      label: 'Entregado'
    },
    'Drive': {
      color: 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800',
      icon: <Truck className="h-3 w-3" />,
      label: 'Drive'
    },
    'Impreso': {
      color: 'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-800 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800',
      icon: <Printer className="h-3 w-3" />,
      label: 'Impreso'
    },
    'PendienteDiseño': {
      color: 'bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-400 border-orange-200 dark:border-orange-800',
      icon: <AlertCircle className="h-3 w-3" />,
      label: 'Pendiente Diseño'
    }
  };

  return statusMap[status] || {
    color: 'bg-gray-100 dark:bg-gray-800/40 text-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700',
    icon: <Clock className="h-3 w-3" />,
    label: status
  };
};

// Compact header component
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
  onAdvancedFilters,
  statuses,
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
  onAdvancedFilters: () => void;
  statuses: OrderStatus[];
  onShowGuide: () => void;
  viewMode: 'table' | 'mobile' | 'kanban';
  onViewModeChange: (mode: 'table' | 'mobile' | 'kanban') => void;
  totalOrders: number;
  filteredCount: number;
}) => (
  <div className="space-y-3">
    {/* Compact Header */}
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
      <div className="flex items-center gap-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          🏭 Producción
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        </CardTitle>
        <Badge variant="outline" className="text-xs">
          {filteredCount}/{totalOrders}
        </Badge>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-1.5">
        <Button onClick={onBulkOperations} variant="outline" size="sm" className="text-xs px-3 py-1.5 min-h-[36px]">
          <Users className="h-4 w-4 mr-1" />
          Masivas
        </Button>
        <Button onClick={onGenerateGuias} variant="outline" size="sm" className="text-xs px-3 py-1.5 min-h-[36px]">
          <Truck className="h-4 w-4 mr-1" />
          Guías
        </Button>
        <Button onClick={onGenerateInvoices} variant="outline" size="sm" className="text-xs px-3 py-1.5 min-h-[36px] bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900">
          <FileText className="h-4 w-4 mr-1" />
          Facturas
        </Button>
        <Button onClick={onExport} variant="outline" size="sm" className="text-xs px-3 py-1.5 min-h-[36px]">
          <Download className="h-4 w-4 mr-1" />
          Exportar
        </Button>
      </div>
    </div>

    {/* Filters Row */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>

      <StatusFilterSelect value={statusFilter} onValueChange={onStatusChange} statuses={statuses} />

      <Button variant="outline" size="sm" className="justify-start h-9 text-xs min-h-[36px]" onClick={onAdvancedFilters}>
        <Filter className="h-4 w-4 mr-1" />
        Filtros
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="justify-start h-9 text-xs min-h-[36px]"
        onClick={onShowStats}
      >
        <TrendingUp className="h-4 w-4 mr-1" />
        Stats
      </Button>

      {/* View Mode Toggle */}
      <div className="flex gap-1 border rounded-md p-1 h-9">
        <Button
          variant={viewMode === 'table' ? 'default' : 'ghost'}
          size="sm"
          className="px-2.5 h-7"
          onClick={() => onViewModeChange('table')}
          title="Tabla"
        >
          <LayoutGrid className="h-4 w-4" />
        </Button>
        <Button
          variant={viewMode === 'kanban' ? 'default' : 'ghost'}
          size="sm"
          className="px-2.5 h-7"
          onClick={() => onViewModeChange('kanban')}
          title="Kanban"
        >
          <Kanban className="h-4 w-4" />
        </Button>
        <Button
          variant={viewMode === 'mobile' ? 'default' : 'ghost'}
          size="sm"
          className="px-2.5 h-7"
          onClick={() => onViewModeChange('mobile')}
          title="Móvil"
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
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const { getState } = useConfig();
  const statusesState = getState<OrderStatus[]>('statuses');
  const statuses = statusesState.data ?? [];
  const businessInfoFieldsState = getState<any[]>('businessInfoFields');
  const businessInfoFields = businessInfoFieldsState.data ?? [];
  const fieldsState = getState<any[]>('fields');
  const productFieldConfigs = fieldsState.data ?? [];

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
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const { toast } = useToast();
  const metadataQuery = useProductionMetadata();
  const serverDriven = metadataQuery.data?.enabled === true;
  const activeStatuses = metadataQuery.data?.statuses?.length ? metadataQuery.data.statuses : statuses;
  const selectedStatusId = statusFilter === 'all'
    ? undefined
    : activeStatuses.find(status => status.label.toLowerCase() === statusFilter.toLowerCase())?.id;
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);
  const serverFilters = useMemo<ProductionFilters>(() => ({
    search: debouncedSearch,
    orderType: orderTypeFilter === 'EA' || orderTypeFilter === 'RA' ? orderTypeFilter : '',
    dateFrom: dateRange.from,
    dateTo: dateRange.to,
    courier: courierFilter,
    priority: orderTypeFilter === 'urgent' ? 'urgent' : priorityFilter === 'all' ? '' : priorityFilter as ProductionFilters['priority'],
  }), [debouncedSearch, orderTypeFilter, dateRange, courierFilter, priorityFilter]);
  const productionOrders = useProductionOrders({
    enabled: serverDriven,
    view: 'list',
    statusId: selectedStatusId,
    unconfigured: statusFilter === '__unconfigured__',
    filters: serverFilters,
    limit: 60,
  });
  const productionSummary = useProductionSummary(serverFilters, serverDriven);
  const moveProductionStatus = useProductionStatusMove();
  const legacyEnabled = metadataQuery.isError || (!metadataQuery.isLoading && !serverDriven);
  const legacySales = useSalesStream({
    pollingInterval: 30000,
    enabled: legacyEnabled,
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: `Error al cargar los pedidos: ${error}`,
      });
    }
  });
  const orders = serverDriven ? productionOrders.orders : legacySales.sales;
  const loading = metadataQuery.isLoading || (serverDriven ? productionOrders.isLoading : legacySales.isLoading);
  const error = serverDriven ? productionOrders.error?.message || null : legacySales.error;
  const refresh = () => {
    if (serverDriven) {
      void Promise.all([productionOrders.refetch(), productionSummary.refetch(), metadataQuery.refetch()]);
    } else {
      legacySales.refresh();
    }
  };

  // Config data now comes from global context - no need to load separately

  // Update last sync time when orders change
  useEffect(() => {
    if (!loading && orders.length > 0) {
      setLastSync(new Date());
    }
  }, [orders, loading]);

  const filteredOrders = useMemo(() => {
    if (serverDriven) return orders;
    const effectiveStatusFilter = statusFilter === '__unconfigured__' ? 'all' : statusFilter;
    let filtered = filterOrders(orders, effectiveStatusFilter, searchTerm, dateRange, priorityFilter, courierFilter);
    if (statusFilter === '__unconfigured__') {
      filtered = filtered.filter(order => !activeStatuses.some(status => status.label.toLowerCase() === order.status.toLowerCase()));
    }

    // Apply order type filter from stat cards
    if (orderTypeFilter === 'EA') {
      filtered = filtered.filter(o => o.orderType === 'EA');
    } else if (orderTypeFilter === 'RA') {
      filtered = filtered.filter(o => o.orderType === 'RA');
    } else if (orderTypeFilter === 'urgent') {
      filtered = filtered.filter(o => {
        // Check if status is manually set to "Urgente" (case-insensitive)
        const isMarkedUrgent = o.status.toLowerCase() === 'urgente' || o.status.toLowerCase() === 'urgent';

        // Check if order is old and pending
        const orderAge = Date.now() - new Date(o.timestamp).getTime();
        const isOldAndPending = orderAge > 24 * 60 * 60 * 1000 && o.status === 'Pendiente';

        return isMarkedUrgent || isOldAndPending;
      });
    }

    return filtered;
  }, [orders, statusFilter, searchTerm, dateRange, priorityFilter, courierFilter, orderTypeFilter, serverDriven, activeStatuses]);

  const groupedOrders = useMemo(() => ({
    EA: filteredOrders.filter(order => order.orderType === 'EA'),
    RA: filteredOrders.filter(order => order.orderType === 'RA')
  }), [filteredOrders]);

  const handleStatusUpdate = async (newStatus: string) => {
    if (selectedOrder) {
      await updateOrderStatus(selectedOrder.orderId, newStatus);
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: string, skipRefresh = false) => {
    try {
      if (serverDriven) {
        const current = orders.find(order => order.orderId === orderId);
        if (!current) throw new Error('La orden no está en la página cargada');
        await moveProductionStatus(current, newStatus);
        if (!skipRefresh) {
          toast({ title: "Estado actualizado", description: "El estado de la orden ha sido actualizado exitosamente." });
        }
        return;
      }
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

      // Only refresh if not in bulk operation
      if (!skipRefresh) {
        refresh();
        toast({
          title: "Estado actualizado",
          description: "El estado de la orden ha sido actualizado exitosamente.",
        });
      }
    } catch (error) {
      if (!skipRefresh) {
        toast({
          variant: "destructive",
          title: "Error",
          description: `No se pudo actualizar el estado de la orden: ${error instanceof Error ? error.message : 'Error desconocido'}`,
        });
      }
      throw error; // Re-throw for bulk operations to count failures
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

  const handleConfirmPayment = async (orderId: string) => {
    try {
      const response = await fetch('/api/orders/confirm-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderId })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to confirm payment');
      }

      refresh();
      toast({
        title: "Pago confirmado",
        description: `Pago de la orden #${orderId} confirmado exitosamente.`,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: `No se pudo confirmar el pago: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      });
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

      // Process one at a time with progress (skip refresh during bulk)
      for (let i = 0; i < orderIds.length; i++) {
        try {
          await updateOrderStatus(orderIds[i], newStatus, true); // Skip individual refreshes
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
      <div className="space-y-4 py-6">
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
    <div className="space-y-4">
      {/* Compact Sync Status */}
      <div className="flex justify-between items-center bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>
            Sincronizado: {lastSync.toLocaleTimeString('es-CR', {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
          <Badge variant="secondary" className="ml-2 text-xs">
            {serverDriven ? `${orders.length} / ${productionOrders.totalCount}` : orders.length}
          </Badge>
          {serverDriven && <span className="hidden sm:inline">Acciones masivas: solo filas cargadas</span>}
        </div>
        <Button
          onClick={() => {
            console.log('[Dashboard] Manual refresh triggered');
            refresh();
          }}
          variant="outline"
          size="sm"
          className="gap-1 bg-card text-xs"
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Sync...
            </>
          ) : (
            <>
              <RefreshCw className="h-3 w-3" />
              Sync
            </>
          )}
        </Button>
      </div>

      {/* Stats Overview */}
      <ProductionStats
        orders={orders}
        onFilterChange={handleStatsFilter}
        serverSummary={serverDriven ? productionSummary.data : undefined}
        availableStatuses={activeStatuses}
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
            onGenerateInvoices={onGenerateInvoices || (() => { })}
            onExport={() => setShowExport(true)}
            onBulkOperations={() => setShowBulkOperations(true)}
            onShowStats={() => setShowStats(true)}
            onAdvancedFilters={() => setShowAdvancedFilters(true)}
            statuses={activeStatuses}
            onShowGuide={() => setShowGuide(true)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            totalOrders={serverDriven ? productionOrders.totalCount : orders.length}
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
              statuses={activeStatuses}
              serverDriven={serverDriven}
              filters={serverFilters}
              statusFilter={statusFilter}
              onOrderUpdate={async (orderId, updates) => {
                await handleOrderUpdate(orderId, updates);
              }}
              onOrderClick={setSelectedOrder}
            />
          ) : (
            <Tabs defaultValue="EA" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="EA" className="flex items-center gap-1 text-sm">
                  <Truck className="h-3 w-3" />
                  Envíos
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {groupedOrders.EA.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="RA" className="flex items-center gap-1 text-sm">
                  <Package className="h-3 w-3" />
                  Retiros
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {groupedOrders.RA.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              {['EA', 'RA'].map((type) => (
                <TabsContent key={type} value={type} className="mt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
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
                        availableStatuses={activeStatuses}
                        businessInfoFields={businessInfoFields}
                        productFieldConfigs={productFieldConfigs}
                        onConfirmPayment={handleConfirmPayment}
                      />
                    ))}
                  </div>

                  {groupedOrders[type as keyof typeof groupedOrders].length === 0 && (
                    <div className="text-center py-12 text-muted-foreground">
                      <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>No hay órdenes {type === 'EA' ? 'de envío' : 'de retiro'} que coincidan con los filtros</p>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
          {serverDriven && viewMode !== 'kanban' && productionOrders.hasNextPage && (
            <div className="flex justify-center pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={productionOrders.isFetchingNextPage}
                onClick={() => void productionOrders.fetchNextPage()}
              >
                {productionOrders.isFetchingNextPage ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Cargar más pedidos
              </Button>
            </div>
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
          productFieldConfigs={productFieldConfigs}
          businessInfoFields={businessInfoFields}
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
          serverSummary={serverDriven ? productionSummary.data : undefined}
          availableStatuses={activeStatuses}
        />
      )}

      {showGuide && (
        <ProductionWorkflowGuide
          onClose={() => setShowGuide(false)}
        />
      )}

      <GuiaGenerator
        orders={filteredOrders.filter(order => order.orderType === 'EA')}
        open={isGuiaGeneratorOpen}
        onClose={onGuiaGeneratorClose}
        onUpdateOrder={handleOrderUpdate}
      />

      {onInvoiceGeneratorClose && (
        <InvoiceGenerator
          orders={filteredOrders.map(order => ({
            id: order.id,
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
