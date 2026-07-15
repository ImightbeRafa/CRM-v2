'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    Archive,
    ArchiveRestore,
    Calendar,
    Check,
    CheckCircle2,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    Clock,
    DollarSign,
    FileDown,
    Package,
    RefreshCw,
    Search,
    Square,
    Truck,
} from 'lucide-react';
import { FALLBACK_TENANT_CONFIG, useTenantConfig } from '@/hooks/useTenantConfig';
import PaymentMethodWizard, { type PaymentConfirmPayload } from '@/app/logistics/components/PaymentMethodWizard';

const CR_TZ = 'America/Costa_Rica';
const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;
const glassHi = { background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14 } as const;

type Tab = 'pending' | 'archived';

interface PrivateDeliveryOrder {
    id: string;
    orderId: string;
    tenantId: string;
    crmStatus: string;
    timestamp: string;
    timestampCR: string;
    reportDate: string;
    reportDateCR: string;
    reportTimestampCR: string;
    customerName: string;
    phone: string | null;
    product: string | null;
    total: number;
    province: string | null;
    canton: string | null;
    district: string | null;
    address: string | null;
    comments: string | null;
    lmStatus: string | null;
    completedAt: string | null;
    billedWeekId: number | null;
    costAmount: number;
    deliveryConfirmedAt: string | null;
    paidConfirmedAt: string | null;
    archivedAt: string | null;
    notes: string;
    actor: string | null;
    settlementMethod: string | null;
    confirmationUpdatedAt: string | null;
    isContraEntrega: boolean;
    contraEntregaCollected: boolean;
    cePaymentMethod: string | null;
    ceConfirmedBy: string | null;
    privateStatus: 'Pendiente' | 'Confirmado' | 'Archivado';
}

interface ApiSummary {
    orders: number;
    delivered: number;
    paid: number;
    totalCost: number;
    periodSent?: number;
    periodConfirmed?: number;
    periodPending?: number;
    periodOwed?: number;
    periodSettledCost?: number;
}

function fmt(amount: number) {
    return `₡${(amount || 0).toLocaleString('es-CR')}`;
}

function toDateKeyCR(date = new Date()) {
    return date.toLocaleDateString('en-CA', { timeZone: CR_TZ });
}

function monthRange(monthKey: string) {
    const [year, month] = monthKey.split('-').map(Number);
    const start = new Date(year, month - 1, 1, 12);
    const end = new Date(year, month, 0, 12);
    return {
        dateFrom: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`,
        dateTo: toDateKeyCR(end),
    };
}

function fmtDate(dateKey: string) {
    return new Date(`${dateKey}T12:00:00`).toLocaleDateString('es-CR', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
}

function csvEscape(value: string) {
    if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
}

function downloadCSV(content: string, filename: string) {
    const anchor = document.createElement('a');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' }));
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function statusColor(status: string | null) {
    if (status === 'Entregado') return '#34d399';
    if (status === 'Devuelto') return '#fbbf24';
    if (status === 'En Tránsito' || status === 'En Transito') return '#c084fc';
    if (status === 'Pendiente') return '#94a3b8';
    return '#60a5fa';
}

function methodLabel(method: string | null | undefined) {
    if (method === 'sinpe') return 'Sinpe';
    if (method === 'efectivo') return 'Efectivo';
    return null;
}

export default function PrivateDeliveryPage() {
    const { tenants, getTenantName, getTenantColor } = useTenantConfig();
    const todayKey = toDateKeyCR();
    const [tab, setTab] = useState<Tab>('pending');
    const [month, setMonth] = useState(todayKey.slice(0, 7));
    const [search, setSearch] = useState('');
    const [selectedTenants, setSelectedTenants] = useState<string[]>(FALLBACK_TENANT_CONFIG.map((tenant) => tenant.id));
    const [orders, setOrders] = useState<PrivateDeliveryOrder[]>([]);
    const [summary, setSummary] = useState<ApiSummary>({
        orders: 0, delivered: 0, paid: 0, totalCost: 0,
        periodSent: 0, periodConfirmed: 0, periodPending: 0, periodOwed: 0, periodSettledCost: 0,
    });
    const [defaultCost, setDefaultCost] = useState(2500);
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
    const [gdWizardIds, setGdWizardIds] = useState<string[] | null>(null);
    const [ceWizardOrder, setCeWizardOrder] = useState<PrivateDeliveryOrder | null>(null);

    const { dateFrom, dateTo } = useMemo(() => monthRange(month), [month]);
    const activeTenantIds = useMemo(
        () => selectedTenants.length > 0 ? selectedTenants : tenants.map((tenant) => tenant.id),
        [selectedTenants, tenants],
    );

    const showToast = useCallback((message: string, type: 'success' | 'error') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                dateFrom,
                dateTo,
                archived: tab === 'archived' ? 'true' : 'false',
            });
            if (search.trim()) params.set('search', search.trim());
            for (const tenantId of activeTenantIds) params.append('tenantId', tenantId);

            const res = await fetch(`/api/logistics/private-delivery?${params}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error cargando mensajeria privada');

            setOrders(data.orders || []);
            setSummary(data.summary || {
                orders: 0, delivered: 0, paid: 0, totalCost: 0,
                periodSent: 0, periodConfirmed: 0, periodPending: 0, periodOwed: 0, periodSettledCost: 0,
            });
            setDefaultCost(Number(data.defaultCost) || 2500);
            setSelectedIds(new Set());
            setExpanded((prev) => {
                const next = { ...prev };
                for (const order of data.orders || []) {
                    if (next[order.tenantId] === undefined) next[order.tenantId] = true;
                }
                return next;
            });
        } catch (error: any) {
            showToast(error.message || 'Error cargando mensajeria privada', 'error');
        } finally {
            setLoading(false);
        }
    }, [activeTenantIds, dateFrom, dateTo, search, showToast, tab]);

    useEffect(() => { load(); }, [load]);

    const grouped = useMemo(() => {
        const map: Record<string, PrivateDeliveryOrder[]> = {};
        for (const order of orders) {
            if (!map[order.tenantId]) map[order.tenantId] = [];
            map[order.tenantId].push(order);
        }
        return Object.entries(map)
            .map(([tenantId, list]) => ({
                tenantId,
                orders: list,
                totalCost: list.reduce((sum, order) => sum + order.costAmount, 0),
                delivered: list.filter((order) => order.lmStatus === 'Entregado').length,
            }))
            .sort((a, b) => b.orders.length - a.orders.length);
    }, [orders]);

    const selectedOrders = useMemo(() => orders.filter((order) => selectedIds.has(order.id)), [orders, selectedIds]);
    const selectedCost = selectedOrders.length * defaultCost;
    const gdWizardAmount = (gdWizardIds?.length || 0) * defaultCost;

    function toggleTenant(tenantId: string) {
        setSelectedTenants((prev) => prev.includes(tenantId)
            ? prev.filter((id) => id !== tenantId)
            : [...prev, tenantId]);
    }

    function toggleAllTenants() {
        const allIds = tenants.map((tenant) => tenant.id);
        setSelectedTenants((prev) => prev.length === allIds.length ? [] : allIds);
    }

    function toggleSelected(orderId: string) {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(orderId)) next.delete(orderId);
            else next.add(orderId);
            return next;
        });
    }

    function toggleTenantSelection(tenantOrders: PrivateDeliveryOrder[]) {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            const selectable = tenantOrders.map((order) => order.id);
            const allSelected = selectable.every((id) => next.has(id));
            for (const id of selectable) {
                if (allSelected) next.delete(id);
                else next.add(id);
            }
            return next;
        });
    }

    function openGdWizard(orderIds: string[]) {
        const uniqueIds = [...new Set(orderIds)];
        if (uniqueIds.length === 0) return;
        setGdWizardIds(uniqueIds);
    }

    async function confirmGdSettlement(payload: PaymentConfirmPayload) {
        if (!gdWizardIds?.length) return;
        setBusy(`confirm-${gdWizardIds.join(',')}`);
        try {
            const res = await fetch('/api/logistics/private-delivery', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderIds: gdWizardIds,
                    settlementMethod: payload.method,
                    confirmedByEmployeeId: payload.employeeId,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo liquidar');

            showToast(`${data.confirmed} orden(es) liquidadas a ${fmt(data.costAmount || defaultCost)} c/u · ${payload.employeeName}`, 'success');
            setGdWizardIds(null);
            await load();
        } catch (error: any) {
            showToast(error.message || 'No se pudo liquidar', 'error');
        } finally {
            setBusy(null);
        }
    }

    async function confirmCePayment(payload: PaymentConfirmPayload) {
        if (!ceWizardOrder) return;
        setBusy(`ce-${ceWizardOrder.id}`);
        try {
            const res = await fetch('/api/logistics/contra-entrega', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderId: ceWizardOrder.id,
                    amount: ceWizardOrder.total || 0,
                    paymentMethod: payload.method,
                    confirmedByEmployeeId: payload.employeeId,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'No se pudo confirmar el cobro');

            setOrders((prev) => prev.map((order) => order.id === ceWizardOrder.id ? {
                ...order,
                isContraEntrega: true,
                contraEntregaCollected: true,
                cePaymentMethod: data.paymentMethod || payload.method,
                ceConfirmedBy: data.confirmedBy || payload.employeeName,
            } : order));
            setCeWizardOrder(null);
            showToast(`Cobro confirmado por ${payload.employeeName}`, 'success');
        } catch (error: any) {
            showToast(error.message || 'No se pudo confirmar el cobro', 'error');
        } finally {
            setBusy(null);
        }
    }

    async function restoreOrder(orderId: string) {
        setBusy(`restore-${orderId}`);
        try {
            const res = await fetch('/api/logistics/private-delivery', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, archived: false }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'No se pudo restaurar');
            showToast('Orden restaurada a pendientes de esta seccion', 'success');
            await load();
        } catch (error: any) {
            showToast(error.message || 'No se pudo restaurar', 'error');
        } finally {
            setBusy(null);
        }
    }

    function exportCSV() {
        const rows = [
            ['Cuenta', 'Orden', 'Cliente', 'Fecha reporte', 'Estado logistica', 'Estado privado', 'Costo GD', 'Metodo liquidacion', 'Actor', 'CE', 'Metodo CE', 'Confirmado CE por', 'Total venta', 'Producto', 'Provincia', 'Canton', 'Telefono'],
            ...orders.map((order) => [
                getTenantName(order.tenantId),
                order.orderId,
                order.customerName,
                order.reportTimestampCR,
                order.lmStatus || '',
                order.privateStatus,
                String(order.costAmount),
                order.settlementMethod || '',
                order.actor || '',
                order.isContraEntrega ? (order.contraEntregaCollected ? 'Cobrado' : 'Pendiente') : '',
                order.cePaymentMethod || '',
                order.ceConfirmedBy || '',
                String(order.total),
                order.product || '',
                order.province || '',
                order.canton || '',
                order.phone || '',
            ]),
        ];
        downloadCSV(rows.map((row) => row.map(csvEscape).join(',')).join('\n'), `mensajeria_privada_${month}_${tab}.csv`);
    }

    const allVisibleSelected = orders.length > 0 && orders.every((order) => selectedIds.has(order.id));
    const periodLabel = `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}`;

    return (
        <div>
            {toast && (
                <div style={{
                    position: 'fixed', top: 20, right: 20, zIndex: 9999, padding: '12px 20px', borderRadius: 10,
                    background: toast.type === 'success' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
                    border: `1px solid ${toast.type === 'success' ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'}`,
                    color: toast.type === 'success' ? '#34d399' : '#f87171', fontSize: 13, fontWeight: 700,
                    display: 'flex', alignItems: 'center', gap: 8, backdropFilter: 'blur(12px)',
                }}>
                    {toast.type === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
                    {toast.message}
                </div>
            )}

            <div style={{ marginBottom: 24 }}>
                <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 800, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Truck size={22} style={{ color: '#8b87ff' }} />
                    Mensajería Privada
                </h1>
                <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 13, margin: 0 }}>
                    Cuántas órdenes se enviaron por GD, cuántas ya se liquidaron y cuánto hay que pagar ({fmt(defaultCost)} por paquete). No cambia el Tablero de Envios.
                </p>
            </div>

            <div style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid rgba(255,255,255,0.07)', flexWrap: 'wrap' }}>
                {[
                    { id: 'pending' as const, label: 'Pendientes', icon: <Clock size={13} /> },
                    { id: 'archived' as const, label: 'Archivadas', icon: <Archive size={13} /> },
                ].map((item) => (
                    <button key={item.id} onClick={() => setTab(item.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: '8px 8px 0 0', border: 'none', borderBottom: tab === item.id ? '2px solid #8b87ff' : '2px solid transparent', background: tab === item.id ? 'rgba(139,135,255,0.08)' : 'transparent', color: tab === item.id ? '#F2F2F2' : 'rgba(255,255,255,0.38)', fontWeight: tab === item.id ? 800 : 500, fontSize: 13, cursor: 'pointer', marginBottom: -1 }}>
                        {item.icon}
                        {item.label}
                    </button>
                ))}
            </div>

            <div style={{ ...glass, padding: '14px 16px', marginBottom: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, alignItems: 'end' }}>
                <div>
                    <label style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 800, display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Mes</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Calendar size={13} style={{ color: '#8b87ff' }} />
                        <input type="month" value={month} onChange={(event) => setMonth(event.target.value)}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.25)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none' }} />
                    </div>
                </div>
                <div>
                    <label style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 800, display: 'block', marginBottom: 6, textTransform: 'uppercase' }}>Buscar</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Search size={13} style={{ color: 'rgba(255,255,255,0.35)' }} />
                        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Orden, cliente, telefono..."
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none' }} />
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button onClick={load} disabled={loading}
                        style={{ ...glass, padding: '8px 13px', color: '#60a5fa', cursor: loading ? 'default' : 'pointer', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, borderColor: 'rgba(96,165,250,0.25)' }}>
                        <RefreshCw size={12} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
                        Recargar
                    </button>
                    <button onClick={exportCSV} disabled={orders.length === 0}
                        style={{ ...glass, padding: '8px 13px', color: orders.length ? '#34d399' : 'rgba(255,255,255,0.22)', cursor: orders.length ? 'pointer' : 'default', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6, borderColor: orders.length ? 'rgba(52,211,153,0.25)' : 'rgba(255,255,255,0.08)' }}>
                        <FileDown size={12} />
                        CSV
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
                <button onClick={toggleAllTenants}
                    style={{ padding: '5px 11px', borderRadius: 20, border: '1px solid rgba(139,135,255,0.28)', background: selectedTenants.length === tenants.length ? 'rgba(139,135,255,0.12)' : 'transparent', color: '#8b87ff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                    Todas
                </button>
                {tenants.map((tenant) => {
                    const selected = selectedTenants.includes(tenant.id);
                    return (
                        <button key={tenant.id} onClick={() => toggleTenant(tenant.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 20, border: `1px solid ${selected ? tenant.color : 'rgba(255,255,255,0.08)'}`, background: selected ? `${tenant.color}18` : 'transparent', color: selected ? tenant.color : 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: tenant.color }} />
                            {tenant.name}
                        </button>
                    );
                })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 18 }}>
                {[
                    { label: 'Enviados', value: `${summary.periodSent ?? summary.orders}`, color: '#8b87ff', icon: <Package size={15} /> },
                    { label: 'Confirmados', value: `${summary.periodConfirmed ?? summary.paid}`, color: '#34d399', icon: <CheckCircle2 size={15} /> },
                    { label: 'Pendientes', value: `${summary.periodPending ?? (tab === 'pending' ? summary.orders : 0)}`, color: '#fbbf24', icon: <Clock size={15} /> },
                    { label: 'A pagar GD', value: fmt(summary.periodOwed ?? (tab === 'pending' ? summary.totalCost : 0)), color: '#60a5fa', icon: <Truck size={15} /> },
                    { label: 'Tarifa GD', value: fmt(defaultCost), color: '#fbbf24', icon: <DollarSign size={15} /> },
                ].map((item) => (
                    <div key={item.label} style={{ ...glassHi, padding: '16px 18px', borderColor: `${item.color}22` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9 }}>
                            <p style={{ color: 'rgba(255,255,255,0.38)', fontSize: 10, margin: 0, textTransform: 'uppercase', fontWeight: 800 }}>{item.label}</p>
                            <div style={{ color: item.color, opacity: 0.72 }}>{item.icon}</div>
                        </div>
                        <p style={{ color: item.color, fontSize: 22, fontWeight: 900, margin: 0 }}>{item.value}</p>
                    </div>
                ))}
            </div>

            {tab === 'pending' && orders.length > 0 && (
                <div style={{ ...glassHi, padding: '12px 16px', marginBottom: 16, borderColor: selectedIds.size ? 'rgba(52,211,153,0.28)' : 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <button onClick={() => setSelectedIds(allVisibleSelected ? new Set() : new Set(orders.map((order) => order.id)))}
                        style={{ ...glass, padding: '7px 12px', color: allVisibleSelected ? '#8b87ff' : 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {allVisibleSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                        {allVisibleSelected ? 'Deseleccionar' : 'Seleccionar visibles'}
                    </button>
                    <div style={{ color: 'rgba(255,255,255,0.42)', fontSize: 12 }}>
                        {selectedIds.size} seleccionada(s) · {selectedIds.size} × {fmt(defaultCost)} = {fmt(selectedCost)}
                    </div>
                    <button onClick={() => openGdWizard([...selectedIds])} disabled={selectedIds.size === 0 || !!busy}
                        style={{ padding: '8px 15px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.35)', background: selectedIds.size ? 'rgba(52,211,153,0.12)' : 'transparent', color: selectedIds.size ? '#34d399' : 'rgba(255,255,255,0.2)', cursor: selectedIds.size && !busy ? 'pointer' : 'default', fontSize: 12, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Archive size={13} />
                        Liquidar y archivar
                    </button>
                </div>
            )}

            {loading ? (
                <div style={{ ...glass, padding: 48, textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>
                    <RefreshCw size={22} style={{ animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 10px', color: '#8b87ff' }} />
                    Cargando {tab === 'pending' ? 'pendientes' : 'archivadas'}...
                </div>
            ) : orders.length === 0 ? (
                <div style={{ ...glass, padding: 48, textAlign: 'center' }}>
                    <Truck size={30} style={{ color: 'rgba(255,255,255,0.16)', marginBottom: 10 }} />
                    <p style={{ color: '#F2F2F2', fontSize: 15, fontWeight: 800, margin: '0 0 5px' }}>
                        No hay órdenes de Mensajería Privada {tab === 'pending' ? 'pendientes' : 'archivadas'}
                    </p>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: 0 }}>{periodLabel}</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 14 }}>
                    {grouped.map((group) => {
                        const tenantColor = getTenantColor(group.tenantId);
                        const isExpanded = expanded[group.tenantId] ?? true;
                        const allTenantSelected = group.orders.every((order) => selectedIds.has(order.id));

                        return (
                            <div key={group.tenantId}>
                                <div onClick={() => setExpanded((prev) => ({ ...prev, [group.tenantId]: !isExpanded }))}
                                    style={{ ...glassHi, padding: '14px 18px', borderColor: `${tenantColor}30`, borderBottomLeftRadius: isExpanded ? 0 : 14, borderBottomRightRadius: isExpanded ? 0 : 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                        <span style={{ color: tenantColor }}>{isExpanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</span>
                                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: tenantColor, flexShrink: 0 }} />
                                        <h2 style={{ color: tenantColor, fontSize: 16, fontWeight: 900, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getTenantName(group.tenantId)}</h2>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                                        <span style={{ color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>{group.delivered}/{group.orders.length} entregadas</span>
                                        <span style={{ color: '#34d399', fontSize: 14, fontWeight: 900 }}>{fmt(group.totalCost)}</span>
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div style={{ ...glass, borderTopLeftRadius: 0, borderTopRightRadius: 0, padding: '14px 16px' }}>
                                        {tab === 'pending' && (
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                                                <button onClick={() => toggleTenantSelection(group.orders)}
                                                    style={{ ...glass, padding: '5px 10px', color: allTenantSelected ? tenantColor : 'rgba(255,255,255,0.42)', cursor: 'pointer', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 5, borderColor: `${tenantColor}24` }}>
                                                    {allTenantSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                                                    {allTenantSelected ? 'Quitar cuenta' : 'Seleccionar cuenta'}
                                                </button>
                                            </div>
                                        )}

                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1040 }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                        {['', 'Orden', 'Cliente', 'Fecha', 'Estado LM', 'Producto', 'Ubicación', 'Costo GD', 'Venta', 'Cobro CE', 'Acción'].map((header) => (
                                                            <th key={header} style={{ padding: '8px 9px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 800, fontSize: 9.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{header}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {group.orders.map((order, index) => {
                                                        const selected = selectedIds.has(order.id);
                                                        const color = statusColor(order.lmStatus);
                                                        const ceMethod = methodLabel(order.cePaymentMethod);
                                                        const settleMethod = methodLabel(order.settlementMethod);
                                                        return (
                                                            <tr key={order.id} className="lm-table-row" style={{ borderBottom: index < group.orders.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: selected ? 'rgba(139,135,255,0.08)' : 'transparent' }}>
                                                                <td style={{ padding: '8px 9px' }}>
                                                                    {tab === 'pending' ? (
                                                                        <button onClick={() => toggleSelected(order.id)}
                                                                            style={{ background: 'none', border: 'none', padding: 0, color: selected ? '#8b87ff' : 'rgba(255,255,255,0.26)', cursor: 'pointer', display: 'flex' }}
                                                                            aria-label={selected ? 'Deseleccionar orden' : 'Seleccionar orden'}>
                                                                            {selected ? <CheckSquare size={15} /> : <Square size={15} />}
                                                                        </button>
                                                                    ) : (
                                                                        <CheckCircle2 size={14} style={{ color: '#34d399' }} />
                                                                    )}
                                                                </td>
                                                                <td style={{ padding: '8px 9px', color: '#F2F2F2', fontFamily: 'monospace', fontWeight: 800 }}>{order.orderId}</td>
                                                                <td style={{ padding: '8px 9px', color: 'rgba(255,255,255,0.72)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                    {order.customerName}
                                                                    {order.phone && <span style={{ color: 'rgba(255,255,255,0.28)', display: 'block', fontSize: 10, marginTop: 1 }}>{order.phone}</span>}
                                                                </td>
                                                                <td style={{ padding: '8px 9px', color: 'rgba(255,255,255,0.55)', whiteSpace: 'nowrap' }}>{order.reportTimestampCR}</td>
                                                                <td style={{ padding: '8px 9px' }}>
                                                                    <span style={{ padding: '2px 8px', borderRadius: 20, background: `${color}14`, color, border: `1px solid ${color}28`, fontSize: 10, fontWeight: 900 }}>
                                                                        {order.lmStatus || 'Sin estado'}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '8px 9px', color: 'rgba(255,255,255,0.48)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.product || '—'}</td>
                                                                <td style={{ padding: '8px 9px', color: 'rgba(255,255,255,0.45)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                    {[order.canton, order.province].filter(Boolean).join(', ') || '—'}
                                                                </td>
                                                                <td style={{ padding: '8px 9px' }}>
                                                                    <span style={{ color: '#60a5fa', fontWeight: 900 }}>{fmt(order.costAmount)}</span>
                                                                    {tab === 'archived' && settleMethod && (
                                                                        <span style={{ display: 'block', color: 'rgba(255,255,255,0.35)', fontSize: 10, marginTop: 2 }}>{settleMethod}{order.actor ? ` · ${order.actor}` : ''}</span>
                                                                    )}
                                                                </td>
                                                                <td style={{ padding: '8px 9px', color: '#34d399', fontWeight: 900 }}>{fmt(order.total)}</td>
                                                                <td style={{ padding: '8px 9px' }}>
                                                                    {!order.isContraEntrega ? (
                                                                        <span style={{ color: 'rgba(255,255,255,0.22)', fontSize: 11 }}>—</span>
                                                                    ) : order.contraEntregaCollected ? (
                                                                        <span title={order.ceConfirmedBy || undefined} style={{ color: '#34d399', fontSize: 11, fontWeight: 800 }}>
                                                                            ✓ {ceMethod || 'Cobrado'}
                                                                        </span>
                                                                    ) : tab === 'pending' ? (
                                                                        <button onClick={() => setCeWizardOrder(order)} disabled={!!busy}
                                                                            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24', cursor: busy ? 'default' : 'pointer', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap' }}>
                                                                            Confirmar cobro
                                                                        </button>
                                                                    ) : (
                                                                        <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>Pendiente</span>
                                                                    )}
                                                                </td>
                                                                <td style={{ padding: '8px 9px' }}>
                                                                    {tab === 'pending' ? (
                                                                        <button onClick={() => openGdWizard([order.id])} disabled={!!busy}
                                                                            style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.1)', color: '#34d399', cursor: busy ? 'default' : 'pointer', fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                                                                            <Archive size={12} />
                                                                            Liquidar
                                                                        </button>
                                                                    ) : (
                                                                        <button onClick={() => restoreOrder(order.id)} disabled={!!busy}
                                                                            style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(251,191,36,0.32)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24', cursor: busy ? 'default' : 'pointer', fontSize: 11, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                                                                            <ArchiveRestore size={12} />
                                                                            Restaurar
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <PaymentMethodWizard
                open={!!gdWizardIds?.length}
                title="Liquidar fee Green Delivery"
                subtitle={gdWizardIds ? `${gdWizardIds.length} × ${fmt(defaultCost)} = ${fmt(gdWizardAmount)}` : undefined}
                amountLabel="Total adeudado a mensajería privada"
                amount={gdWizardAmount}
                employeeLabel="Quién confirma el pago a GD"
                confirmLabel="Liquidar y archivar"
                busy={!!busy && !!gdWizardIds}
                onConfirm={confirmGdSettlement}
                onCancel={() => { if (!busy) setGdWizardIds(null); }}
            />

            <PaymentMethodWizard
                open={!!ceWizardOrder}
                title="Confirmar cobro contra entrega"
                subtitle={ceWizardOrder ? `#${ceWizardOrder.orderId} · ${ceWizardOrder.customerName}` : undefined}
                amountLabel="Monto del pedido"
                amount={ceWizardOrder?.total || 0}
                employeeLabel="Quién confirma el cobro"
                confirmLabel="Confirmar cobro"
                busy={!!busy && !!ceWizardOrder}
                onConfirm={confirmCePayment}
                onCancel={() => { if (!busy) setCeWizardOrder(null); }}
            />

            <style>{`
                .lm-table-row:hover{background:rgba(255,255,255,0.035)!important}
                @keyframes spin{to{transform:rotate(360deg)}}
                @media (max-width: 768px) {
                    input[type="month"] { min-width: 0; }
                }
            `}</style>
        </div>
    );
}
