'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, Search, Filter, RefreshCw } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

interface Order {
    id: string; orderId: string; tenantId: string; status: string;
    timestamp: string; customerName: string; phone: string | null;
    product: string | null; quantity: number | null; province: string | null;
    total: number; lmCarrier: string | null; lmStatus: string | null;
    tenant?: { name: string; slug: string; businessName: string | null };
}

const STATUS_COLORS: Record<string, string> = {
    'Pendiente': '#94a3b8', 'En Proceso': '#8b87ff', 'Urgente': '#f87171',
    'Completado': '#34d399', 'Enviado': '#c084fc', 'Entregado': '#10b981', 'Devuelto': '#fbbf24',
    'En Tránsito': '#c084fc', 'Guía Creada': '#60a5fa', 'Impreso': '#22d3ee',
};
const CARRIER_COLORS: Record<string, string> = { 'mensajeria': '#8b87ff', 'correos': '#60a5fa' };

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;
const glassHi = { background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14 } as const;

export default function LogisticsDashboardPage() {
    const { getTenantName, getTenantColor } = useTenantConfig();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [tenantFilter, setTenantFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [carrierFilter, setCarrierFilter] = useState('');
    const [refreshing, setRefreshing] = useState(false);

    const loadOrders = useCallback(async () => {
        const p = new URLSearchParams({ limit: '300' });
        if (search) p.set('search', search);
        if (tenantFilter) p.set('tenantId', tenantFilter);
        if (statusFilter) p.set('status', statusFilter);
        try {
            const res = await fetch(`/api/logistics/orders?${p}`);
            const data = await res.json();
            let list: Order[] = data.orders || [];
            if (carrierFilter === 'none') list = list.filter(o => !o.lmCarrier);
            else if (carrierFilter) list = list.filter(o => o.lmCarrier === carrierFilter);
            setOrders(list);
        } catch (e) { console.error(e); }
        finally { setLoading(false); setRefreshing(false); }
    }, [search, tenantFilter, statusFilter, carrierFilter]);

    useEffect(() => { loadOrders(); }, [loadOrders]);

    const total = orders.length;
    const today = orders.filter(o => { const d = new Date(o.timestamp), n = new Date(); return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear(); }).length;
    const pending = orders.filter(o => o.status === 'Pendiente').length;
    const printed = orders.filter(o => o.lmStatus === 'Impreso').length;
    const transit = orders.filter(o => o.lmStatus === 'En Tránsito').length;
    const delivered = orders.filter(o => o.lmStatus === 'Entregado').length;
    const unassigned = orders.filter(o => !o.lmCarrier).length;

    const MANAGED_IDS = ['cmh32z0ol0000k004hvx9tg3p', 'cmhsibjue0004js04gie724nx', 'cmhutd1th0000jp04oqibtz54', 'cmigornmw0000lb04kl75262e', 'cmjdabz4d0000il04dyc5qmcc', 'cmln5u7k70000ld042qify2og', 'cmh44aerw0006vijg0640vfl0', 'cmm4pv8fl0000jr045en1nik9'];

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>
                <Package size={40} style={{ margin: '0 auto 12px', display: 'block' }} />
                <p style={{ margin: 0, fontSize: 14 }}>Cargando órdenes...</p>
            </div>
        </div>
    );

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
                <div>
                    <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Todas las Órdenes</h1>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>Vista unificada de todas las cuentas gestionadas</p>
                </div>
                <button onClick={() => { setRefreshing(true); loadOrders(); }} style={{ ...glass, display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', transition: 'all 0.2s' }} className="lm-btn-ghost">
                    <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
                    Actualizar
                </button>
            </div>

            {/* Stat cards */}
            <div className="lm-stat-grid" style={{ display: 'grid', gap: 12, marginBottom: 28 }}>
                {[
                    { label: 'Total', value: total, color: '#8b87ff' },
                    { label: 'Hoy', value: today, color: '#34d399' },
                    { label: 'Pendientes', value: pending, color: '#fbbf24' },
                    { label: 'Impresos', value: printed, color: '#22d3ee' },
                    { label: 'En Tránsito', value: transit, color: '#c084fc' },
                    { label: 'Entregados', value: delivered, color: '#10b981' },
                    { label: 'Sin Carrier', value: unassigned, color: '#f87171' },
                ].map(({ label, value, color }) => (
                    <div key={label} style={{ ...glassHi, padding: '16px 18px' }}>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                        <p style={{ color, fontSize: 28, fontWeight: 700, margin: 0 }}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                    <Search size={13} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, orden..."
                        style={{ width: '100%', padding: '9px 12px 9px 34px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                {[
                    {
                        value: tenantFilter, onChange: setTenantFilter, default: 'Todas las cuentas',
                        options: MANAGED_IDS.map(id => ({ value: id, label: getTenantName(id) }))
                    },
                    {
                        value: statusFilter, onChange: setStatusFilter, default: 'Todos los estados',
                        options: ['Pendiente', 'En Proceso', 'Urgente', 'Enviado', 'Completado', 'Entregado', 'Devuelto'].map(s => ({ value: s, label: s }))
                    },
                    {
                        value: carrierFilter, onChange: setCarrierFilter, default: 'Todos los carriers',
                        options: [{ value: 'mensajeria', label: 'Mensajería' }, { value: 'correos', label: 'Correos CR' }, { value: 'none', label: 'Sin asignar' }]
                    },
                ].map((f, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                        <Filter size={12} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
                        <select value={f.value} onChange={e => f.onChange(e.target.value)} style={{ padding: '9px 14px 9px 30px', ...glass, color: f.value ? '#F2F2F2' : 'rgba(255,255,255,0.3)', fontSize: 13, cursor: 'pointer', outline: 'none' }}>
                            <option value="">{f.default}</option>
                            {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                    </div>
                ))}
            </div>

            {/* Table */}
            <div style={{ ...glass, overflowX: 'auto', overflowY: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 900 }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                            {['Cuenta', 'Cliente', 'Teléfono', 'Producto', 'Provincia', 'Estado CRM', 'Carrier', 'Estado LM', 'Total', 'Fecha'].map(h => (
                                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {orders.length === 0 ? (
                            <tr><td colSpan={10} style={{ textAlign: 'center', padding: '52px', color: 'rgba(255,255,255,0.2)' }}>
                                <Package size={28} style={{ margin: '0 auto 8px', display: 'block', opacity: 0.3 }} />No hay órdenes
                            </td></tr>
                        ) : orders.map((o, idx) => {
                            const sc = STATUS_COLORS[o.status] || '#94a3b8';
                            const lmSc = STATUS_COLORS[o.lmStatus || ''] || null;
                            const cc = o.lmCarrier ? CARRIER_COLORS[o.lmCarrier] : null;
                            const tc = getTenantColor(o.tenantId);
                            return (
                                <tr key={o.id} style={{ borderBottom: idx < orders.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', transition: 'background 0.1s' }} className="lm-table-row">
                                    <td style={{ padding: '9px 14px' }}>
                                        <span style={{ padding: '2px 9px', borderRadius: 20, background: `${tc}20`, color: tc, fontSize: 10.5, fontWeight: 700 }}>
                                            {getTenantName(o.tenantId)}
                                        </span>
                                    </td>
                                    <td style={{ padding: '9px 14px', color: '#F2F2F2', fontWeight: 500 }}>{o.customerName}</td>
                                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.4)' }}>{o.phone || '—'}</td>
                                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.4)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.product || '—'}</td>
                                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.4)' }}>{o.province || '—'}</td>
                                    <td style={{ padding: '9px 14px' }}>
                                        <span style={{ padding: '2px 8px', borderRadius: 20, background: `${sc}18`, color: sc, fontSize: 11, fontWeight: 600 }}>{o.status}</span>
                                    </td>
                                    <td style={{ padding: '9px 14px' }}>
                                        {cc ? <span style={{ padding: '2px 8px', borderRadius: 20, background: `${cc}18`, color: cc, fontSize: 11, fontWeight: 600 }}>{o.lmCarrier === 'mensajeria' ? 'Mensajería' : 'Correos'}</span>
                                            : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>—</span>}
                                    </td>
                                    <td style={{ padding: '9px 14px' }}>
                                        {lmSc ? <span style={{ padding: '2px 8px', borderRadius: 20, background: `${lmSc}18`, color: lmSc, fontSize: 11, fontWeight: 600 }}>{o.lmStatus}</span>
                                            : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>—</span>}
                                    </td>
                                    <td style={{ padding: '9px 14px', color: '#34d399', fontWeight: 700 }}>₡{o.total.toLocaleString('es-CR')}</td>
                                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>{new Date(o.timestamp).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 10, textAlign: 'right' }}>{orders.length} órdenes</p>
            <style>{`.lm-table-row:hover{background:rgba(255,255,255,0.03)} .lm-btn-ghost:hover{background:rgba(255,255,255,0.08)!important;color:#F2F2F2!important;box-shadow:0 0 14px rgba(108,99,255,0.2)}`}</style>
        </div>
    );
}
