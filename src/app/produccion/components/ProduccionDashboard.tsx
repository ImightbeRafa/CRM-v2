"use client";
import React from 'react';
import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/app/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import { Input } from "@/app/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { useSalesStream } from '@/app/hooks/useSalesStream';
import { OrderList } from './OrderList';
import { OrderDetails } from './OrderDetail';
import { Sale } from '../types/sales';
import { Loader2 } from 'lucide-react';
import { Loading, LoadingCard } from "@/app/components/ui/loading";
import { useToast } from "@/app/hooks/use-toast";
import { GuiaGenerator } from './GuiaGenerator';
import { Button } from "@/app/components/ui/button";

// Dynamic Status Filter Component
const StatusFilterSelectLegacy = ({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) => {
  const [statuses, setStatuses] = useState<Array<{key: string; label: string}>>([]);

  useEffect(() => {
    const loadStatuses = async () => {
      try {
        const response = await fetch('/api/config/status');
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
      <SelectTrigger className="w-full sm:w-[180px]">
        <SelectValue placeholder="Estado" />
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

// Updated Filter function
const filterOrders = (orders: Sale[], statusFilter: string, searchTerm: string) => {
  const searchLower = searchTerm.toLowerCase();
  return orders.filter(order => {
    if (statusFilter !== 'all' && order.status.toLowerCase() !== statusFilter) {
      return false;
    }
    return (
      order.customerName.toLowerCase().includes(searchLower) ||
      order.orderId.toLowerCase().includes(searchLower) ||
      order.product.toLowerCase().includes(searchLower) ||
      order.phone.toLowerCase().includes(searchLower)
    );
  });
};

// Header component
const DashboardHeader = React.memo(({ 
  loading, 
  searchTerm, 
  onSearchChange, 
  statusFilter, 
  onStatusChange,
  onGenerateGuias
}: {
  loading: boolean;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusChange: (value: string) => void;
  onGenerateGuias: () => void;
}) => (
  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
    <div className="flex items-center gap-4">
      <CardTitle className="flex items-center gap-2">
        Panel de Producción
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      </CardTitle>
      <Button onClick={onGenerateGuias}>Generar Guías</Button>
    </div>
    <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
      <Input
        placeholder="Buscar por cliente, teléfono, orden o producto..."
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full sm:w-64"
      />
      <StatusFilterSelectLegacy value={statusFilter} onValueChange={onStatusChange} />
    </div>
  </div>
));

DashboardHeader.displayName = 'DashboardHeader';

export interface ProductionDashboardProps {
  onGenerateGuias: () => void;
  isGuiaGeneratorOpen: boolean;
  onGuiaGeneratorClose: () => void;
}

export function ProductionDashboard({ onGenerateGuias, isGuiaGeneratorOpen, onGuiaGeneratorClose }: ProductionDashboardProps) {
  const [selectedOrder, setSelectedOrder] = useState<Sale | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [productFieldConfigs, setProductFieldConfigs] = useState<any[]>([]);
  const [businessInfoFields, setBusinessInfoFields] = useState<any[]>([]);
  const { toast } = useToast();

  useEffect(() => {
    const fetchFieldConfigs = async () => {
      try {
        const [fieldsRes, bizRes] = await Promise.all([
          fetch('/api/config/fields', { credentials: 'include' }),
          fetch('/api/config/business-info', { credentials: 'include' }),
        ]);
        const fieldsData = await fieldsRes.json();
        const bizData = await bizRes.json();
        if (fieldsData?.status === 'success') setProductFieldConfigs(fieldsData.data || []);
        if (bizData?.status === 'success') setBusinessInfoFields(bizData.data || []);
      } catch {
        // Non-critical: custom field labels will fall back to raw keys
      }
    };
    fetchFieldConfigs();
  }, []);

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

  const filteredOrders = useMemo(() => 
    filterOrders(orders, statusFilter, searchTerm),
    [orders, statusFilter, searchTerm]
  );

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
        body: JSON.stringify({
          orderId,
          ...updatedData
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update order');
      }

      const updatedOrder: Sale = await response.json();
      refresh();
      toast({
        title: "Orden actualizada",
        description: "La información de la orden ha sido actualizada exitosamente.",
      });
      return updatedOrder;
    } catch (error) {
      console.error('Error updating order:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "No se pudo actualizar la información de la orden.",
      });
      throw error;
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
    <div className="container mx-auto px-4 py-6">
      <Card>
        <CardHeader>
          <DashboardHeader 
            loading={loading}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            statusFilter={statusFilter}
            onStatusChange={setStatusFilter}
            onGenerateGuias={() => {
              console.log('Generate Guias clicked');
              onGenerateGuias();
            }}
          />
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="EA" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="EA" className="flex items-center gap-2">
                Envíos (EA)
                <span className="inline-flex items-center justify-center rounded-full bg-primary/10 px-2.5 py-0.5 text-sm">
                  {groupedOrders.EA.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="RA" className="flex items-center gap-2">
                Retiros (RA)
                <span className="inline-flex items-center justify-center rounded-full bg-primary/10 px-2.5 py-0.5 text-sm">
                  {groupedOrders.RA.length}
                </span>
              </TabsTrigger>
            </TabsList>
            
            {['EA', 'RA'].map((type) => (
              <TabsContent key={type} value={type} className="mt-4">
                <OrderList
                  orders={groupedOrders[type as keyof typeof groupedOrders]}
                  onSelectOrder={setSelectedOrder}
                  loading={loading}
                  error={error || ''}
                  productFieldConfigs={productFieldConfigs}
                  businessInfoFields={businessInfoFields}
                />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {selectedOrder && (
        <OrderDetails
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdateStatus={handleStatusUpdate}
          onUpdateOrder={handleOrderUpdate}
        />
      )}

      <GuiaGenerator
        orders={groupedOrders.EA}
        open={isGuiaGeneratorOpen}
        onClose={onGuiaGeneratorClose}
        onUpdateOrder={handleOrderUpdate}
      />
    </div>
  );
}