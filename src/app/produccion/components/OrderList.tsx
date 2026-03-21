"use client";

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { Sale } from '../types/sales';
import { StatusBadge } from "@/app/components/ui/StatusBadge";
import { Button } from "@/app/components/ui/button";
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface OrderListProps {
  orders: Sale[];
  onSelectOrder: (order: Sale) => void;
  loading: boolean;
  error: string;
  productFieldConfigs?: any[];
  businessInfoFields?: any[];
}

function parseCustomFields(order: Sale): Record<string, any> {
  try {
    const raw = (order as any).customFields;
    if (!raw) return {};
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

function buildLabelMap(productFieldConfigs: any[], businessInfoFields: any[]): Record<string, string> {
  const map: Record<string, string> = {};
  businessInfoFields.forEach((f: any) => {
    if (f?.name) map[f.name] = f.label || f.name;
  });
  productFieldConfigs.forEach((f: any) => {
    if (f?.key) map[f.key] = f.label || f.key;
  });
  return map;
}

export function OrderList({ orders, onSelectOrder, loading, error, productFieldConfigs = [], businessInfoFields = [] }: OrderListProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const labelMap = buildLabelMap(productFieldConfigs, businessInfoFields);

  const toggleRow = (orderId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        {error}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Orden</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Negocio</TableHead>
          <TableHead>Producto</TableHead>
          <TableHead>Canal</TableHead>
          <TableHead>Vendedor</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Fecha</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => {
          const cfData = parseCustomFields(order);
          const cfEntries = Object.entries(cfData).filter(
            ([, v]) => v !== undefined && v !== null && String(v).trim() !== ''
          );
          const hasCustomFields = cfEntries.length > 0;
          const isExpanded = expandedRows.has(order.orderId);

          return (
            <>
              <TableRow key={order.orderId}>
                <TableCell className="w-8 px-2">
                  {hasCustomFields && (
                    <button
                      onClick={() => toggleRow(order.orderId)}
                      className="p-1 rounded hover:bg-muted transition-colors"
                      aria-label={isExpanded ? 'Colapsar campos' : 'Expandir campos'}
                    >
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    </button>
                  )}
                </TableCell>
                <TableCell className="font-medium">{order.orderId}</TableCell>
                <TableCell>
                  <div>
                    <p>{order.customerName}</p>
                    <p className="text-sm text-muted-foreground">{order.phone}</p>
                  </div>
                </TableCell>
                <TableCell>
                  <p>{order.business || 'No especificado'}</p>
                </TableCell>
                <TableCell>
                  <div>
                    <p>{order.product}</p>
                    <p className="text-sm text-muted-foreground">
                      Cant: {order.quantity} - {order.size}
                    </p>
                    {(order as any).productCost && (
                      <p className="text-xs text-muted-foreground">
                        Costo: ₡{Number((order as any).productCost).toLocaleString()}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    {(order as any).funnel ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {(order as any).funnel}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No especificado</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div>
                    {(order as any).seller ? (
                      <span className="text-sm">{(order as any).seller}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No especificado</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={order.status} />
                </TableCell>
                <TableCell>
                  <div>
                    <p className="text-sm">
                      {(() => {
                        const date = new Date(order.timestamp);
                        return isNaN(date.getTime())
                          ? 'Fecha inválida'
                          : formatDistanceToNow(date, {
                              addSuffix: true,
                              locale: es
                            });
                      })()}
                    </p>
                    {order.orderType === 'EA' ? (
                      <p className="text-xs text-muted-foreground">Espera: {order.expectedDate}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Retiro: {order.agreedDate}</p>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectOrder(order)}
                  >
                    Ver detalles
                  </Button>
                </TableCell>
              </TableRow>
              {hasCustomFields && isExpanded && (
                <TableRow key={`${order.orderId}-cf`} className="bg-muted/30 hover:bg-muted/40">
                  <TableCell />
                  <TableCell colSpan={9} className="py-2">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                      {cfEntries.map(([key, value]) => (
                        <span key={key}>
                          <span className="font-medium">{labelMap[key] || key}:</span>{' '}
                          {typeof value === 'boolean' ? (value ? 'Sí' : 'No') : String(value)}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </>
          );
        })}
      </TableBody>
    </Table>
  );
}
