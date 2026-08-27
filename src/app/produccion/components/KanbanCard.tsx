'use client';

import React, { useEffect, useState } from 'react';
import type { Sale } from '../types/sales';
import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { ArrowRight, Banknote, Calendar, MapPin, Package, Phone, User } from 'lucide-react';

interface KanbanCardProps {
  order: Sale;
  statuses: Array<{ id?: string; label: string }>;
  onClick: () => void;
  onMove: (order: Sale, status: string) => Promise<void>;
  moving: boolean;
}

export function KanbanCard({ order, statuses, onClick, onMove, moving }: KanbanCardProps) {
  const [targetStatus, setTargetStatus] = useState(order.status);
  useEffect(() => setTargetStatus(order.status), [order.status]);
  const daysOld = (Date.now() - new Date(order.timestamp).getTime()) / (1000 * 60 * 60 * 24);
  const highPriority = daysOld > 3 && order.status.toLowerCase() === 'pendiente';
  const accentColor = highPriority ? '#ef4444' : order.contraEntrega ? '#f59e0b' : order.orderType === 'RA' ? '#8b5cf6' : '#3b82f6';

  return (
    <article className={`relative overflow-hidden rounded-xl glass-card shadow-premium ${highPriority ? 'ring-1 ring-red-500/30' : ''}`}>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}88)` }} />
      <button type="button" className="w-full p-3.5 pt-4 text-left space-y-2.5 hover:bg-white/[0.02]" onClick={onClick}>
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-sm">#{order.orderId}</p>
          {highPriority && <Badge className="bg-red-500/15 text-red-400 text-[10px]">Urgente</Badge>}
        </div>
        <div className="flex items-center text-[13px] font-medium"><User className="h-3 w-3 mr-1.5" /><span className="truncate">{order.customerName}</span></div>
        {order.phone && <div className="flex items-center text-xs text-muted-foreground"><Phone className="h-3 w-3 mr-1.5" />{order.phone}</div>}
        <div className="flex items-start text-xs"><Package className="h-3 w-3 mr-1.5 mt-0.5" /><span className="line-clamp-2">{order.product}</span></div>
        {order.orderType === 'EA' && order.district && <div className="flex items-center text-xs text-muted-foreground"><MapPin className="h-3 w-3 mr-1.5" /><span className="truncate">{order.district}</span></div>}
        <div className="flex items-center justify-between border-t border-white/[0.04] pt-2">
          <div className="flex gap-1"><Badge variant="outline">{order.orderType}</Badge>{order.contraEntrega && <Badge className="bg-amber-500/10 text-amber-400"><Banknote className="h-2.5 w-2.5 mr-0.5" />CE</Badge>}</div>
          <strong>₡{Number(order.total || 0).toLocaleString('es-CR')}</strong>
        </div>
        <div className="flex items-center text-[11px] text-muted-foreground"><Calendar className="h-3 w-3 mr-1.5" />{new Date(order.timestamp).toLocaleDateString('es-CR')}</div>
      </button>
      <div className="p-3 pt-0 flex gap-2" onClick={event => event.stopPropagation()}>
        <select
          aria-label={`Nuevo estado para ${order.orderId}`}
          value={targetStatus}
          onChange={event => setTargetStatus(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
          disabled={moving}
        >
          {!statuses.some(status => status.label === order.status) && <option value={order.status}>{order.status}</option>}
          {statuses.map(status => <option key={status.id || status.label} value={status.label}>{status.label}</option>)}
        </select>
        <Button
          type="button"
          size="sm"
          disabled={moving || targetStatus === order.status}
          onClick={() => void onMove(order, targetStatus)}
          aria-label={`Mover ${order.orderId} a ${targetStatus}`}
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}
