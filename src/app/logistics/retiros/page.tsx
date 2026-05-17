'use client';

import { useState, useEffect, useCallback } from 'react';
import { PackageCheck, Search, RefreshCw, Phone, MapPin, Calendar, Clock, User, Copy, Check, DollarSign, Archive } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 } as const;

type StatusFilter = 'all' | 'Pendiente' | 'Entregado';

function effectiveStatus(order: any) {
    return order.lmStatus || order.delivery || order.status || 'Pendiente';
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

async function terminateOrders(orderIds: string[]) {
    const res = await fetch('/api/logistics/orders/terminate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds }),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const details = Array.isArray(data.details) ? data.details.join('\n') : '';
        throw new Error(details || data.error || `Terminate failed: ${res.status}`);
    }
}

export default function RetirosPage() {
    const { tenants, getTenantName, getTenantColor } = useTenantConfig();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [tenantFilter, setTenantFilter] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [actionId, setActionId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams({ limit: '500' });
            if (search) p.set('search', search);
            const data = await (await fetch(`/api/logistics/orders?${p}`)).json();
            const raOrders = (data.orders || []).filter((o: any) => o.orderType === 'RA');
            setOrders(raOrders);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [search]);

    useEffect(() => { load(); }, [load]);

    const afterStatus = statusFilter === 'all' ? orders : orders.filter(o => {
        const status = effectiveStatus(o);
        if (statusFilter === 'Pendiente') return status !== 'Entregado' && status !== 'Devuelto';
        return status === statusFilter;
    });
    const visible = tenantFilter ? afterStatus.filter(o => o.tenantId === tenantFilter) : afterStatus;
    const activeTenantIds = Array.from(new Set(orders.map(o => o.tenantId)));

    const pendingCount = orders.filter(o => {
        const status = effectiveStatus(o);
        return status !== 'Entregado' && status !== 'Devuelto';
    }).length;
    const completedCount = orders.filter(o => effectiveStatus(o) === 'Entregado').length;

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
        try { return new Date(d).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' }); } catch { return d; }
    }

    async function assignToRetiros(order: any) {
        setActionId(order.id);
        try {
            await patchLogisticsOrder(order.id, { lmCarrier: 'retiro', lmStatus: order.lmStatus || 'Pendiente' });
            setOrders(prev => prev.map(o => o.id === order.id ? { ...o, lmCarrier: 'retiro', lmStatus: o.lmStatus || 'Pendiente' } : o));
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
            setOrders(prev => prev.map(o => o.id === order.id ? { ...o, isContraEntrega: value, contraEntrega: value, contraEntregaCollected: value ? o.contraEntregaCollected : false, cePaymentConfirmed: value ? o.cePaymentConfirmed : false } : o));
        } catch (e: any) {
            alert(e.message || 'No se pudo actualizar contra entrega.');
        } finally {
            setActionId(null);
        }
    }

    async function confirmPayment(order: any) {
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
                body: JSON.stringify({ orderId: order.id, amount: order.total || 0, notes: 'Confirmado en retiros' }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'No se pudo confirmar el pago.');
            }
            setOrders(prev => prev.map(o => o.id === order.id ? { ...o, lmCarrier: o.lmCarrier || 'retiro', lmStatus: o.lmStatus || 'Pendiente', isContraEntrega: true, contraEntrega: true, contraEntregaCollected: true, cePaymentConfirmed: true } : o));
        } catch (e: any) {
            alert(e.message || 'No se pudo confirmar el pago.');
        } finally {
            setActionId(null);
        }
    }

    async function markDeliveredAndArchive(order: any) {
        const isContraEntrega = order.isContraEntrega || order.contraEntrega;
        const isCollected = order.contraEntregaCollected || order.cePaymentConfirmed;
        if (isContraEntrega && !isCollected) {
            alert('Este retiro es contra entrega. Confirme el pago antes de marcarlo como Entregado.');
            return;
        }
        setActionId(order.id);
        try {
            await patchLogisticsOrder(order.id, { lmCarrier: order.lmCarrier || 'retiro', lmStatus: 'Entregado' });
            await terminateOrders([order.id]);
            setOrders(prev => prev.filter(o => o.id !== order.id));
        } catch (e: any) {
            alert(e.message || 'No se pudo entregar y archivar el retiro.');
        } finally {
            setActionId(null);
        }
    }

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: 22 }}>
                <h1 style={{ color: '#F2F2F2', fontSize: 22, fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <PackageCheck size={20} style={{ color: '#22c55e' }} /> Retiros en Local
                </h1>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>
                    Órdenes tipo RA — el cliente recoge en tu ubicación
                </p>
            </div>

            {/* Stats row */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
                <div style={{ ...glass, padding: '12px 20px', flex: 1 }}>
                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Total Retiros</div>
                    <div style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 900 }}>{orders.length}</div>
                </div>
                <div style={{ ...glass, padding: '12px 20px', flex: 1, borderColor: 'rgba(251,191,36,0.15)' }}>
                    <div style={{ color: 'rgba(251,191,36,0.6)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Pendientes</div>
                    <div style={{ color: '#fbbf24', fontSize: 24, fontWeight: 900 }}>{pendingCount}</div>
                </div>
                <div style={{ ...glass, padding: '12px 20px', flex: 1, borderColor: 'rgba(34,197,94,0.15)' }}>
                    <div style={{ color: 'rgba(34,197,94,0.6)', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>Entregados</div>
                    <div style={{ color: '#22c55e', fontSize: 24, fontWeight: 900 }}>{completedCount}</div>
                </div>
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Search */}
                <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                    <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, orden..."
                        style={{ width: '100%', padding: '8px 12px 8px 32px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>

                {/* Status tabs */}
                <div style={{ display: 'flex', gap: 4 }}>
                    {([
                        ['all', 'Todos', `${orders.length}`, 'rgba(255,255,255,0.4)'],
                        ['Pendiente', 'Pendientes', `${pendingCount}`, '#fbbf24'],
                        ['Entregado', 'Entregados', `${completedCount}`, '#22c55e'],
                    ] as [StatusFilter, string, string, string][]).map(([id, label, count, color]) => (
                        <button key={id} onClick={() => setStatusFilter(id)}
                            style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${statusFilter === id ? color + '60' : 'rgba(255,255,255,0.08)'}`, background: statusFilter === id ? color + '14' : 'transparent', color: statusFilter === id ? color : 'rgba(255,255,255,0.35)', fontSize: 12.5, fontWeight: statusFilter === id ? 700 : 400, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                            {label}
                            <span style={{ padding: '1px 6px', borderRadius: 20, background: statusFilter === id ? color + '25' : 'rgba(255,255,255,0.06)', fontSize: 10.5 }}>{count}</span>
                        </button>
                    ))}
                </div>

                {/* Tenant filter */}
                <select value={tenantFilter} onChange={e => setTenantFilter(e.target.value)}
                    style={{ padding: '7px 12px', ...glass, color: tenantFilter ? '#F2F2F2' : 'rgba(255,255,255,0.35)', fontSize: 12, outline: 'none', cursor: 'pointer', minWidth: 130 }}>
                    <option value="">Todas las cuentas</option>
                    {activeTenantIds.map(id => (
                        <option key={id} value={id}>{getTenantName(id)}</option>
                    ))}
                </select>

                <button onClick={load} style={{ padding: '7px 10px', ...glass, color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><RefreshCw size={13} /></button>
            </div>

            {/* Orders list */}
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
                    {visible.map(o => {
                        const age = daysSince(o.timestamp);
                        const isExpanded = expandedId === o.id;
                        const status = effectiveStatus(o);
                        const isDelivered = status === 'Entregado';
                        const isAssignedRetiro = o.lmCarrier === 'retiro';
                        const isCOD = o.isContraEntrega || o.contraEntrega;
                        const isCollected = o.contraEntregaCollected || o.cePaymentConfirmed;
                        const busy = actionId === o.id;
                        const tColor = getTenantColor(o.tenantId);
                        const agreedDate = o.agreedDate || o.pickupDate;

                        return (
                            <div key={o.id}
                                onClick={() => setExpandedId(isExpanded ? null : o.id)}
                                style={{
                                    ...glass,
                                    padding: 0,
                                    overflow: 'hidden',
                                    cursor: 'pointer',
                                    border: `1px solid ${isDelivered ? 'rgba(34,197,94,0.2)' : 'rgba(255,255,255,0.08)'}`,
                                    background: isDelivered ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.04)',
                                    transition: 'all 0.15s',
                                }}>
                                {/* Main row */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                                    {/* Tenant color dot */}
                                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: tColor, flexShrink: 0 }} />

                                    {/* Customer info */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <span style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13 }}>{o.customerName}</span>
                                            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10 }}>#{o.orderId}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3 }}>
                                            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{getTenantName(o.tenantId)}</span>
                                            {o.product && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>· {o.product}{o.quantity > 1 ? ` ×${o.quantity}` : ''}</span>}
                                        </div>
                                    </div>

                                    {/* Agreed date */}
                                    {agreedDate && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                                            <Calendar size={11} />
                                            {formatDate(agreedDate)}
                                        </div>
                                    )}

                                    {/* Age badge */}
                                    <span style={{
                                        padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                                        background: age > 5 ? 'rgba(239,68,68,0.15)' : age > 2 ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.06)',
                                        color: age > 5 ? '#ef4444' : age > 2 ? '#fbbf24' : 'rgba(255,255,255,0.4)',
                                    }}>
                                        {age}d
                                    </span>

                                    {/* Total */}
                                    <span style={{ color: '#34d399', fontWeight: 900, fontSize: 13, minWidth: 65, textAlign: 'right' }}>
                                        ₡{(o.total || 0).toLocaleString('es-CR')}
                                    </span>

                                    {/* Status badge */}
                                    <span style={{
                                        padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                                        background: isDelivered ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.12)',
                                        color: isDelivered ? '#22c55e' : '#fbbf24',
                                    }}>
                                        {isDelivered ? 'Entregado' : status || 'Pendiente'}
                                    </span>
                                </div>

                                {/* Expanded details */}
                                {isExpanded && (
                                    <div style={{ padding: '0 16px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                            {/* Phone */}
                                            {o.phone && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <Phone size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{o.phone}</span>
                                                    <button onClick={e => { e.stopPropagation(); copyPhone(o.phone, o.id); }}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'rgba(255,255,255,0.3)' }}>
                                                        {copiedId === o.id ? <Check size={11} style={{ color: '#22c55e' }} /> : <Copy size={11} />}
                                                    </button>
                                                </div>
                                            )}

                                            {/* Email */}
                                            {o.email && (
                                                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                                                    ✉ {o.email}
                                                </div>
                                            )}

                                            {/* Seller */}
                                            {o.seller && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <User size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Vendedor: {o.seller}</span>
                                                </div>
                                            )}

                                            {/* Created date */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <Clock size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Creada: {new Date(o.timestamp).toLocaleDateString('es-CR')}</span>
                                            </div>

                                            {/* Pickup date */}
                                            {o.pickupDate && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <Calendar size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Retiro: {formatDate(o.pickupDate)}</span>
                                                </div>
                                            )}

                                            {/* Agreed date */}
                                            {o.agreedDate && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <Calendar size={11} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>Acordada: {formatDate(o.agreedDate)}</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Comments */}
                                        {o.comments && (
                                            <div style={{ marginTop: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, color: 'rgba(255,255,255,0.4)', fontSize: 11, fontStyle: 'italic' }}>
                                                💬 {o.comments}
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                                            {!isAssignedRetiro && (
                                                <button onClick={e => { e.stopPropagation(); assignToRetiros(o); }} disabled={busy}
                                                    style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                                                    <PackageCheck size={12} /> Asignar a retiros
                                                </button>
                                            )}
                                            <button onClick={e => { e.stopPropagation(); toggleContraEntrega(o, !isCOD); }} disabled={busy || isDelivered}
                                                style={{ padding: '7px 12px', borderRadius: 7, border: `1px solid ${isCOD ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)'}`, background: isCOD ? 'rgba(251,191,36,0.08)' : 'transparent', color: isCOD ? '#fbbf24' : 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: 700, cursor: busy || isDelivered ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                                                <DollarSign size={12} /> {isCOD ? 'Quitar contra entrega' : 'Marcar contra entrega'}
                                            </button>
                                            {isCOD && !isCollected && (
                                                <button onClick={e => { e.stopPropagation(); confirmPayment(o); }} disabled={busy || isDelivered}
                                                    style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 12, fontWeight: 700, cursor: busy || isDelivered ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                                                    <Check size={12} /> Confirmar pago
                                                </button>
                                            )}
                                            {!isDelivered && (
                                                <button onClick={e => { e.stopPropagation(); markDeliveredAndArchive(o); }} disabled={busy || (isCOD && !isCollected)}
                                                    title={isCOD && !isCollected ? 'Confirme el pago contra entrega primero' : 'Marcar Entregado y archivar'}
                                                    style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 7, border: `1px solid ${isCOD && !isCollected ? 'rgba(255,255,255,0.1)' : 'rgba(34,197,94,0.45)'}`, background: isCOD && !isCollected ? 'transparent' : 'rgba(34,197,94,0.12)', color: isCOD && !isCollected ? 'rgba(255,255,255,0.25)' : '#22c55e', fontSize: 12, fontWeight: 800, cursor: busy || (isCOD && !isCollected) ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                                                    <Archive size={12} /> {busy ? 'Procesando...' : 'Entregado y archivar'}
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

            <style>{`
                @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
}
