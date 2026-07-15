'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  PackageCheck, Search, RefreshCw, Phone, Calendar, Clock, User, Copy, Check,
  DollarSign, AlertTriangle, CalendarClock,
} from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';
import PaymentMethodWizard, { type PaymentConfirmPayload } from '@/app/logistics/components/PaymentMethodWizard';
import LauraStockPanel, { type LauraStockItem } from '@/app/logistics/components/LauraStockPanel';
import RetiroConfirmWizard, { type RetiroLinePreview } from '@/app/logistics/components/RetiroConfirmWizard';
import { buildAliasMapFromRows, mapOrderLinesLocal } from '@/lib/retiro-stock-utils';

const glass = {
  background: 'rgba(255,255,255,0.05)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
} as const;

type StatusFilter = 'all' | 'Pendiente' | 'Entregado';

type HandoffInfo = {
  scheduledAt: string | null;
  handedByName: string | null;
  confirmedAt: string | null;
  stockApplied: boolean;
};

type Kpis = {
  pending: number;
  scheduledToday: number;
  overdue: number;
  deliveredToday: number;
  unitsOnHand: number;
  lowStockCount: number;
};

function effectiveStatus(order: any) {
  return order.lmStatus || order.delivery || order.status || 'Pendiente';
}

function toDatetimeLocalValue(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function patchLogisticsOrder(orderId: string, patch: object) {
  const res = await fetch('/api/logistics/orders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, ...patch }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `PATCH failed: ${res.status}`);
  }
}

export default function RetirosPage() {
  const { getTenantName, getTenantColor } = useTenantConfig();
  const [orders, setOrders] = useState<any[]>([]);
  const [handoffs, setHandoffs] = useState<Record<string, HandoffInfo>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tenantFilter, setTenantFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [ceWizardOrder, setCeWizardOrder] = useState<any | null>(null);
  const [ceBusy, setCeBusy] = useState(false);
  const [confirmOrder, setConfirmOrder] = useState<any | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [stock, setStock] = useState<LauraStockItem[]>([]);
  const [unitsOnHand, setUnitsOnHand] = useState(0);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [movements, setMovements] = useState<any[]>([]);
  const [aliases, setAliases] = useState<any[]>([]);
  const [stockBusy, setStockBusy] = useState(false);
  const [kpis, setKpis] = useState<Kpis>({
    pending: 0,
    scheduledToday: 0,
    overdue: 0,
    deliveredToday: 0,
    unitsOnHand: 0,
    lowStockCount: 0,
  });

  const aliasMap = useMemo(
    () => buildAliasMapFromRows(aliases, stock),
    [aliases, stock],
  );

  const loadStock = useCallback(async () => {
    setStockBusy(true);
    try {
      const [stockRes, kpiRes] = await Promise.all([
        fetch('/api/logistics/retiros/stock'),
        fetch('/api/logistics/retiros/kpis'),
      ]);
      const stockData = await stockRes.json().catch(() => ({}));
      const kpiData = await kpiRes.json().catch(() => ({}));
      if (stockRes.ok) {
        setStock(stockData.stock || []);
        setUnitsOnHand(stockData.unitsOnHand || 0);
        setLowStockCount(stockData.lowStockCount || 0);
        setMovements(stockData.movements || []);
        setAliases(stockData.aliases || []);
      }
      if (kpiRes.ok) {
        setKpis({
          pending: kpiData.pending || 0,
          scheduledToday: kpiData.scheduledToday || 0,
          overdue: kpiData.overdue || 0,
          deliveredToday: kpiData.deliveredToday || 0,
          unitsOnHand: kpiData.unitsOnHand || 0,
          lowStockCount: kpiData.lowStockCount || 0,
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setStockBusy(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ limit: '500' });
      if (search) p.set('search', search);
      const data = await (await fetch(`/api/logistics/orders?${p}`)).json();
      const raOrders = (data.orders || []).filter((o: any) => o.orderType === 'RA' && !o.archivedAt);
      setOrders(raOrders);

      if (raOrders.length > 0) {
        const ids = raOrders.map((o: any) => o.id).join(',');
        const handoffRes = await fetch(`/api/logistics/retiros/schedule?ids=${encodeURIComponent(ids)}`);
        const handoffData = await handoffRes.json().catch(() => ({}));
        if (handoffRes.ok) setHandoffs(handoffData.handoffs || {});
      } else {
        setHandoffs({});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadStock(); }, [loadStock]);

  const afterStatus = statusFilter === 'all' ? orders : orders.filter((o) => {
    const status = effectiveStatus(o);
    if (statusFilter === 'Pendiente') return status !== 'Entregado' && status !== 'Devuelto';
    return status === statusFilter;
  });
  const visible = tenantFilter ? afterStatus.filter((o) => o.tenantId === tenantFilter) : afterStatus;
  const activeTenantIds = Array.from(new Set(orders.map((o) => o.tenantId)));

  const pendingCount = orders.filter((o) => {
    const status = effectiveStatus(o);
    return status !== 'Entregado' && status !== 'Devuelto';
  }).length;
  const completedCount = orders.filter((o) => effectiveStatus(o) === 'Entregado').length;

  function copyPhone(phone: string, id: string) {
    navigator.clipboard.writeText(phone).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  function daysSince(ts: string) {
    return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  }

  function formatDate(d: string | null | undefined) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString('es-CR', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return d;
    }
  }

  function linesForOrder(order: any): RetiroLinePreview[] {
    return mapOrderLinesLocal(order, aliasMap);
  }

  async function assignToRetiros(order: any) {
    setActionId(order.id);
    try {
      await patchLogisticsOrder(order.id, { lmCarrier: 'retiro', lmStatus: order.lmStatus || 'Pendiente' });
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, lmCarrier: 'retiro', lmStatus: o.lmStatus || 'Pendiente' } : o)));
    } catch (e: any) {
      alert(e.message || 'No se pudo asignar el retiro.');
    } finally {
      setActionId(null);
    }
  }

  async function toggleContraEntrega(order: any, value: boolean) {
    setActionId(order.id);
    try {
      await patchLogisticsOrder(order.id, { isContraEntrega: value, ...(value ? {} : { contraEntregaCollected: false }) });
      setOrders((prev) => prev.map((o) => (o.id === order.id ? {
        ...o,
        isContraEntrega: value,
        contraEntrega: value,
        contraEntregaCollected: value ? o.contraEntregaCollected : false,
        cePaymentConfirmed: value ? o.cePaymentConfirmed : false,
      } : o)));
    } catch (e: any) {
      alert(e.message || 'No se pudo actualizar contra entrega.');
    } finally {
      setActionId(null);
    }
  }

  async function confirmPayment(order: any) {
    if (order.contraEntregaCollected || order.cePaymentConfirmed) return;
    setCeWizardOrder(order);
  }

  async function submitCePayment(payload: PaymentConfirmPayload) {
    if (!ceWizardOrder) return;
    const order = ceWizardOrder;
    setCeBusy(true);
    setActionId(order.id);
    try {
      if (!order.lmCarrier) {
        await patchLogisticsOrder(order.id, { lmCarrier: 'retiro', lmStatus: order.lmStatus || 'Pendiente', isContraEntrega: true });
      } else if (!order.isContraEntrega && !order.contraEntrega) {
        await patchLogisticsOrder(order.id, { isContraEntrega: true });
      }
      const res = await fetch('/api/logistics/contra-entrega', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          amount: order.total || 0,
          notes: 'Confirmado en retiros',
          paymentMethod: payload.method,
          confirmedByEmployeeId: payload.employeeId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo confirmar el pago.');
      setOrders((prev) => prev.map((o) => (o.id === order.id ? {
        ...o,
        lmCarrier: o.lmCarrier || 'retiro',
        lmStatus: o.lmStatus || 'Pendiente',
        isContraEntrega: true,
        contraEntrega: true,
        contraEntregaCollected: true,
        cePaymentConfirmed: true,
        cePaymentMethod: data.paymentMethod || payload.method,
        ceConfirmedBy: data.confirmedBy || payload.employeeName,
      } : o)));
      setCeWizardOrder(null);
    } catch (e: any) {
      alert(e.message || 'No se pudo confirmar el pago.');
    } finally {
      setActionId(null);
      setCeBusy(false);
    }
  }

  async function saveSchedule(order: any, value: string) {
    setActionId(order.id);
    try {
      const scheduledAt = value ? new Date(value).toISOString() : null;
      const res = await fetch('/api/logistics/retiros/schedule', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, scheduledAt }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar la cita');
      setHandoffs((prev) => ({
        ...prev,
        [order.id]: {
          scheduledAt: data.scheduledAt,
          handedByName: prev[order.id]?.handedByName || null,
          confirmedAt: prev[order.id]?.confirmedAt || null,
          stockApplied: prev[order.id]?.stockApplied || false,
        },
      }));
      setOrders((prev) => prev.map((o) => (o.id === order.id ? {
        ...o,
        pickupDate: data.pickupDate,
        agreedDate: data.pickupDate,
      } : o)));
      loadStock();
    } catch (e: any) {
      alert(e.message || 'No se pudo guardar la cita de retiro.');
    } finally {
      setActionId(null);
    }
  }

  async function submitRetiroConfirm(payload: { employeeId: string; employeeName: string }) {
    if (!confirmOrder) return;
    const order = confirmOrder;
    setConfirmBusy(true);
    setActionId(order.id);
    try {
      const res = await fetch('/api/logistics/retiros/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          employeeId: payload.employeeId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No se pudo confirmar el retiro');
      setOrders((prev) => prev.filter((o) => o.id !== order.id));
      setConfirmOrder(null);
      await loadStock();
    } catch (e: any) {
      alert(e.message || 'No se pudo confirmar el retiro.');
    } finally {
      setActionId(null);
      setConfirmBusy(false);
    }
  }

  async function onRestock(sku: string, delta: number, notes: string) {
    const res = await fetch('/api/logistics/retiros/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, delta, notes }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo actualizar stock');
    setStock(data.stock || []);
    await loadStock();
  }

  const kpiCards: Array<{ label: string; value: number; color: string; hint?: string }> = [
    { label: 'Pendientes', value: kpis.pending || pendingCount, color: '#fbbf24' },
    { label: 'Hoy programados', value: kpis.scheduledToday, color: '#60a5fa' },
    { label: 'Vencidos', value: kpis.overdue, color: kpis.overdue > 0 ? '#ef4444' : 'rgba(255,255,255,0.55)', hint: 'Cita pasada sin entregar' },
    { label: 'Entregados hoy', value: kpis.deliveredToday, color: '#22c55e' },
    { label: 'Unidades Laura', value: kpis.unitsOnHand || unitsOnHand, color: '#F2F2F2' },
    { label: 'SKUs bajos', value: kpis.lowStockCount || lowStockCount, color: (kpis.lowStockCount || lowStockCount) > 0 ? '#f97316' : '#22c55e' },
  ];

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ color: '#F2F2F2', fontSize: 22, fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <PackageCheck size={20} style={{ color: '#22c55e' }} /> Retiros en Local
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>
          Órdenes RA · inventario Casa de Laura · citas y quién entrega
        </p>
      </div>

      <LauraStockPanel
        stock={stock}
        unitsOnHand={unitsOnHand}
        lowStockCount={lowStockCount}
        movements={movements}
        busy={stockBusy}
        onRestock={onRestock}
        onRefresh={loadStock}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
        {kpiCards.map((card) => (
          <div key={card.label} style={{ ...glass, padding: '12px 14px', borderColor: `${card.color}22` }} title={card.hint}>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>
              {card.label}
            </div>
            <div style={{ color: card.color, fontSize: 24, fontWeight: 900 }}>{card.value}</div>
          </div>
        ))}
      </div>

      {(kpis.overdue > 0 || lowStockCount > 0) && (
        <div style={{
          ...glass, padding: '10px 12px', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 8,
          borderColor: 'rgba(251,191,36,0.25)', background: 'rgba(251,191,36,0.06)',
          color: '#fbbf24', fontSize: 12.5, fontWeight: 600,
        }}>
          <AlertTriangle size={14} />
          {kpis.overdue > 0 ? `${kpis.overdue} retiro(s) con cita vencida. ` : ''}
          {lowStockCount > 0 ? `${lowStockCount} producto(s) bajos en Casa de Laura.` : ''}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente, orden..."
            style={{ width: '100%', padding: '8px 12px 8px 32px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {([
            ['all', 'Todos', `${orders.length}`, 'rgba(255,255,255,0.4)'],
            ['Pendiente', 'Pendientes', `${pendingCount}`, '#fbbf24'],
            ['Entregado', 'Entregados', `${completedCount}`, '#22c55e'],
          ] as [StatusFilter, string, string, string][]).map(([id, label, count, color]) => (
            <button
              key={id}
              onClick={() => setStatusFilter(id)}
              style={{
                padding: '7px 14px', borderRadius: 8,
                border: `1px solid ${statusFilter === id ? `${color}60` : 'rgba(255,255,255,0.08)'}`,
                background: statusFilter === id ? `${color}14` : 'transparent',
                color: statusFilter === id ? color : 'rgba(255,255,255,0.35)',
                fontSize: 12.5, fontWeight: statusFilter === id ? 700 : 400,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
              }}
            >
              {label}
              <span style={{ padding: '1px 6px', borderRadius: 20, background: statusFilter === id ? `${color}25` : 'rgba(255,255,255,0.06)', fontSize: 10.5 }}>{count}</span>
            </button>
          ))}
        </div>

        <select
          value={tenantFilter}
          onChange={(e) => setTenantFilter(e.target.value)}
          style={{ padding: '7px 12px', ...glass, color: tenantFilter ? '#F2F2F2' : 'rgba(255,255,255,0.35)', fontSize: 12, outline: 'none', cursor: 'pointer', minWidth: 130 }}
        >
          <option value="">Todas las cuentas</option>
          {activeTenantIds.map((id) => (
            <option key={id} value={id}>{getTenantName(id)}</option>
          ))}
        </select>

        <button
          onClick={() => { load(); loadStock(); }}
          style={{ padding: '7px 10px', ...glass, color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)' }}>
          <PackageCheck size={28} style={{ display: 'block', margin: '0 auto 10px', opacity: 0.3 }} />Cargando...
        </div>
      ) : visible.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)', ...glass }}>
          {tenantFilter || statusFilter !== 'all' ? 'No hay retiros con esos filtros' : 'No hay retiros activos'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visible.map((o) => {
            const age = daysSince(o.timestamp);
            const isExpanded = expandedId === o.id;
            const status = effectiveStatus(o);
            const isDelivered = status === 'Entregado';
            const isAssignedRetiro = o.lmCarrier === 'retiro';
            const isCOD = o.isContraEntrega || o.contraEntrega;
            const isCollected = o.contraEntregaCollected || o.cePaymentConfirmed;
            const busy = actionId === o.id;
            const tColor = getTenantColor(o.tenantId);
            const handoff = handoffs[o.id];
            const scheduledAt = handoff?.scheduledAt || null;
            const isOverdue = scheduledAt && !isDelivered && new Date(scheduledAt).getTime() < Date.now();
            const lines = linesForOrder(o);
            const unmappedCount = lines.filter((l) => !l.sku).length;

            return (
              <div
                key={o.id}
                onClick={() => setExpandedId(isExpanded ? null : o.id)}
                style={{
                  ...glass,
                  padding: 0,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: `1px solid ${isOverdue ? 'rgba(239,68,68,0.35)' : isDelivered ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)'}`,
                  background: isDelivered ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: tColor, flexShrink: 0 }} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13 }}>{o.customerName}</span>
                      <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>#{o.orderId}</span>
                      {unmappedCount > 0 && (
                        <span style={{ padding: '1px 7px', borderRadius: 20, background: 'rgba(239,68,68,0.15)', color: '#f87171', fontSize: 10, fontWeight: 700 }}>
                          sin mapear
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
                      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{getTenantName(o.tenantId)}</span>
                      {o.product && (
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
                          · {o.product}{o.quantity > 1 ? ` ×${o.quantity}` : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  {scheduledAt && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      color: isOverdue ? '#ef4444' : 'rgba(255,255,255,0.45)',
                      fontSize: 11, fontWeight: isOverdue ? 700 : 400,
                    }}>
                      <CalendarClock size={11} />
                      {formatDate(scheduledAt)}
                    </div>
                  )}

                  <span style={{
                    padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                    background: age > 5 ? 'rgba(239,68,68,0.15)' : age > 2 ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.06)',
                    color: age > 5 ? '#ef4444' : age > 2 ? '#fbbf24' : 'rgba(255,255,255,0.4)',
                  }}>
                    {age}d
                  </span>

                  <span style={{ color: '#34d399', fontWeight: 900, fontSize: 13, minWidth: 65, textAlign: 'right' }}>
                    ₡{(o.total || 0).toLocaleString('es-CR')}
                  </span>

                  <span style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                    background: isDelivered ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.12)',
                    color: isDelivered ? '#22c55e' : '#fbbf24',
                  }}>
                    {isDelivered ? 'Entregado' : status || 'Pendiente'}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      {o.phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Phone size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{o.phone}</span>
                          <button
                            onClick={() => copyPhone(o.phone, o.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'rgba(255,255,255,0.3)' }}
                          >
                            {copiedId === o.id ? <Check size={11} style={{ color: '#22c55e' }} /> : <Copy size={11} />}
                          </button>
                        </div>
                      )}

                      {o.email && (
                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>✉ {o.email}</div>
                      )}

                      {o.seller && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <User size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Vendedor: {o.seller}</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Clock size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                          Creada: {new Date(o.timestamp).toLocaleDateString('es-CR')}
                        </span>
                      </div>
                    </div>

                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                        <Calendar size={11} /> Cita de retiro
                      </div>
                      <input
                        type="datetime-local"
                        value={toDatetimeLocalValue(scheduledAt)}
                        disabled={busy || isDelivered}
                        onChange={(e) => saveSchedule(o, e.target.value)}
                        style={{
                          width: '100%', maxWidth: 280, boxSizing: 'border-box',
                          padding: '8px 10px', borderRadius: 8,
                          border: '1px solid rgba(255,255,255,0.12)',
                          background: 'rgba(255,255,255,0.04)', color: '#F2F2F2', fontSize: 13, outline: 'none',
                        }}
                      />
                      {isOverdue && (
                        <div style={{ marginTop: 6, color: '#ef4444', fontSize: 11, fontWeight: 700 }}>Cita vencida — el cliente aún no retiró</div>
                      )}
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>
                        Productos vs Laura
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {lines.map((line, idx) => (
                          <div key={`${line.rawName}-${idx}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: line.sku ? 'rgba(255,255,255,0.55)' : '#f87171' }}>
                            <span>{line.displayName || line.rawName}{line.sku ? '' : ' (sin mapear)'}</span>
                            <span>×{line.qty}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {(isCOD || o.cePaymentMethod) && (
                      <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(251,191,36,0.06)', borderRadius: 8, color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>
                        <DollarSign size={11} style={{ display: 'inline', marginRight: 4, verticalAlign: -1 }} />
                        Pago: {isCollected ? `CONFIRMADO${o.cePaymentMethod ? ` · ${String(o.cePaymentMethod).toUpperCase()}` : ''}${o.ceConfirmedBy ? ` · ${o.ceConfirmedBy}` : ''}` : 'Contra entrega pendiente'}
                      </div>
                    )}

                    {o.comments && (
                      <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, color: 'rgba(255,255,255,0.4)', fontSize: 11, fontStyle: 'italic' }}>
                        💬 {o.comments}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      {!isAssignedRetiro && (
                        <button
                          onClick={() => assignToRetiros(o)}
                          disabled={busy}
                          style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                        >
                          <PackageCheck size={12} /> Asignar a retiros
                        </button>
                      )}
                      <button
                        onClick={() => toggleContraEntrega(o, !isCOD)}
                        disabled={busy || isDelivered}
                        style={{
                          padding: '7px 12px', borderRadius: 7,
                          border: `1px solid ${isCOD ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)'}`,
                          background: isCOD ? 'rgba(251,191,36,0.08)' : 'transparent',
                          color: isCOD ? '#fbbf24' : 'rgba(255,255,255,0.45)',
                          fontSize: 12, fontWeight: 700, cursor: busy || isDelivered ? 'default' : 'pointer',
                          display: 'flex', alignItems: 'center', gap: 5,
                        }}
                      >
                        <DollarSign size={12} /> {isCOD ? 'Quitar contra entrega' : 'Marcar contra entrega'}
                      </button>
                      {isCOD && !isCollected && (
                        <button
                          onClick={() => confirmPayment(o)}
                          disabled={busy || isDelivered}
                          style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: busy || isDelivered ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                        >
                          <Check size={12} /> Confirmar pago
                        </button>
                      )}
                      {!isDelivered && (
                        <button
                          onClick={() => {
                            if (isCOD && !isCollected) {
                              alert('Este retiro es contra entrega. Confirmá el pago antes de marcarlo como retirado.');
                              return;
                            }
                            setConfirmOrder(o);
                          }}
                          disabled={busy || (isCOD && !isCollected)}
                          title={isCOD && !isCollected ? 'Confirmá el pago contra entrega primero' : 'Confirmar retiro por Laura y descontar stock'}
                          style={{
                            marginLeft: 'auto', padding: '7px 12px', borderRadius: 7,
                            border: `1px solid ${isCOD && !isCollected ? 'rgba(255,255,255,0.1)' : 'rgba(34,197,94,0.45)'}`,
                            background: isCOD && !isCollected ? 'transparent' : 'rgba(34,197,94,0.12)',
                            color: isCOD && !isCollected ? 'rgba(255,255,255,0.25)' : '#22c55e',
                            fontSize: 12, fontWeight: 800,
                            cursor: busy || (isCOD && !isCollected) ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 5,
                          }}
                        >
                          <PackageCheck size={12} /> {busy ? 'Procesando...' : 'Confirmar retiro (Laura)'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <PaymentMethodWizard
        open={!!ceWizardOrder}
        title="Confirmar cobro contra entrega"
        subtitle={ceWizardOrder ? `#${ceWizardOrder.orderId} · ${ceWizardOrder.customerName}` : undefined}
        amountLabel="Monto del pedido"
        amount={ceWizardOrder?.total || 0}
        employeeLabel="Quién confirma el cobro"
        confirmLabel="Confirmar cobro"
        busy={ceBusy}
        onConfirm={submitCePayment}
        onCancel={() => { if (!ceBusy) setCeWizardOrder(null); }}
      />

      <RetiroConfirmWizard
        open={!!confirmOrder}
        subtitle={confirmOrder ? `#${confirmOrder.orderId} · ${confirmOrder.customerName}` : undefined}
        lines={confirmOrder ? linesForOrder(confirmOrder) : []}
        busy={confirmBusy}
        onConfirm={submitRetiroConfirm}
        onCancel={() => { if (!confirmBusy) setConfirmOrder(null); }}
      />
    </div>
  );
}
