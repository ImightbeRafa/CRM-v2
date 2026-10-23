'use client';

import { orderLabelHash } from '@/lib/orders/order-label';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Clock } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { PaymentStatusBadge } from '@/app/components/orders/PaymentStatusBadge';
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import OrderItemsList from '@/components/orders/OrderItemsList';
import ShippingMethodBadge from '@/components/orders/ShippingMethodBadge';

interface OrderData {
  orderId: string;
  customerName: string;
  product?: string;
  quantity?: number;
  itemLines?: string[] | null;
  courier?: string;
  total?: number;
  status: string;
  timestamp: string;
  phone?: string;
  email?: string;
  address?: string;
  orderType?: 'EA' | 'RA';
  contraEntrega?: boolean;
  cePaymentConfirmed?: boolean;
  customFields?: unknown;
}

interface MobileOrderCardProps {
  order: OrderData;
  formatCurrency?: (value: number) => string;
  className?: string;
}

export function MobileOrderCard({ order, formatCurrency, className = '' }: MobileOrderCardProps) {
  const [expanded, setExpanded] = useState(false);

  const displayCurrency = (val: number) =>
    formatCurrency ? formatCurrency(val) : `₡${val.toLocaleString()}`;

  const timeAgo = (() => {
    try {
      return formatDistanceToNow(new Date(order.timestamp), { addSuffix: true, locale: es });
    } catch {
      return '';
    }
  })();

  return (
    <div className={`bg-card rounded-xl border shadow-sm ${className}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left px-4 py-3.5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-semibold text-sm text-foreground" title={order.orderId}>{orderLabelHash(order)}</span>
              {order.orderType && <ShippingMethodBadge order={order} size="xs" showCod={false} />}
            </div>
            <p className="text-sm text-foreground truncate">{order.customerName}</p>
            {order.product && (
              <OrderItemsList
                order={order}
                open={expanded}
                maxItems={2}
                style={{ marginTop: 2 }}
                itemStyle={{ fontSize: 12, color: 'hsl(var(--muted-foreground))' }}
              />
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <StatusBadge status={order.status} />
            <PaymentStatusBadge order={order} />
            {order.total != null && (
              <span className="text-sm font-bold text-foreground">{displayCurrency(order.total)}</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </span>
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-border space-y-2">
              {order.phone && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Teléfono</span>
                  <a href={`tel:${order.phone}`} className="text-blue-600">{order.phone}</a>
                </div>
              )}
              {order.email && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Email</span>
                  <span className="text-foreground truncate max-w-[200px]">{order.email}</span>
                </div>
              )}
              {order.address && order.orderType !== 'RA' && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Dirección</span>
                  <span className="text-foreground truncate max-w-[200px]">{order.address}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
