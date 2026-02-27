'use client';

import { useState, useEffect, useCallback } from 'react';
import { Truck, Printer, CheckSquare, Square, Search, RefreshCw, Package } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 } as const;

export default function GuiaMensajeriaPage() {
    const { tenants, getTenantName } = useTenantConfig();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [ceFilter, setCeFilter] = useState(false);
    const [tenantFilter, setTenantFilter] = useState('');
    const [printing, setPrinting] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams({ limit: '300', lmCarrier: 'mensajeria' });
            if (search) p.set('search', search);
            const data = await (await fetch(`/api/logistics/orders?${p}`)).json();
            const active = (data.orders || []).filter((o: any) => !['Entregado', 'Devuelto'].includes(o.lmStatus || ''));
            setOrders(active);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [search]);

    useEffect(() => { load(); }, [load]);

    const afterTenant = tenantFilter ? orders.filter(o => o.tenantId === tenantFilter) : orders;
    const visible = ceFilter ? afterTenant.filter(o => o.isContraEntrega) : afterTenant;
    const ceCount = orders.filter(o => o.isContraEntrega).length;
    const activeTenantIds = Array.from(new Set(orders.map(o => o.tenantId)));

    function toggle(id: string) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); }
    function selectAll() { setSelected(new Set(visible.map(o => o.id))); }
    function clearAll() { setSelected(new Set()); }

    async function printGuias() {
        if (selected.size === 0) return;
        setPrinting(true);
        // Log guia_generated events
        for (const orderId of selected) {
            try {
                await fetch('/api/logistics/order-events', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId, eventType: 'guia_generated', payload: { carrier: 'mensajeria' } }),
                });
            } catch { }
        }
        setPrinting(false);
        window.print();
    }

    const selectedOrders = orders.filter(o => selected.has(o.id));
    const fmt = (n: number) => `₡${(n || 0).toLocaleString('es-CR')}`;

    return (
        <div>
            {/* Screen UI — hidden on print */}
            <div className="no-print">
                <div style={{ marginBottom: 22 }}>
                    <h1 style={{ color: '#F2F2F2', fontSize: 22, fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Truck size={20} style={{ color: '#8b87ff' }} /> Guías — Mensajería Privada
                    </h1>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>Selecciona las órdenes y genera las guías para imprimir</p>
                </div>

                {/* Toolbar */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                        <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)' }} />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, orden..."
                            style={{ width: '100%', padding: '8px 12px 8px 33px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                    <button onClick={() => setCeFilter(f => !f)}
                        style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${ceFilter ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.08)'}`, background: ceFilter ? 'rgba(251,191,36,0.14)' : 'transparent', color: ceFilter ? '#fbbf24' : 'rgba(255,255,255,0.35)', fontSize: 12.5, fontWeight: ceFilter ? 700 : 400, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                        💵 Contra Entrega
                        <span style={{ padding: '1px 6px', borderRadius: 20, background: ceFilter ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.06)', fontSize: 10.5 }}>{ceCount}</span>
                    </button>
                    <select value={tenantFilter} onChange={e => setTenantFilter(e.target.value)}
                        style={{ padding: '8px 12px', ...glass, color: tenantFilter ? '#F2F2F2' : 'rgba(255,255,255,0.35)', fontSize: 12, outline: 'none', cursor: 'pointer', minWidth: 130 }}>
                        <option value="">Todas las cuentas</option>
                        {activeTenantIds.map(id => (
                            <option key={id} value={id}>{getTenantName(id)}</option>
                        ))}
                    </select>
                    <button onClick={selectAll} style={{ padding: '8px 14px', ...glass, color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12 }}>Seleccionar Todo</button>
                    <button onClick={clearAll} style={{ padding: '8px 14px', ...glass, color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 12 }}>Limpiar</button>
                    <button onClick={load} style={{ padding: '8px 12px', ...glass, color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><RefreshCw size={13} /></button>
                    <button onClick={printGuias} disabled={selected.size === 0 || printing}
                        style={{ padding: '8px 20px', borderRadius: 9, border: '1px solid rgba(139,135,255,0.5)', background: selected.size > 0 ? 'rgba(139,135,255,0.15)' : 'transparent', color: selected.size > 0 ? '#8b87ff' : 'rgba(255,255,255,0.2)', cursor: selected.size > 0 ? 'pointer' : 'default', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
                        {printing ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Printer size={13} />}
                        Imprimir {selected.size > 0 ? `(${selected.size})` : ''}
                    </button>
                </div>

                {/* Order selection list */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)' }}><Package size={28} style={{ display: 'block', margin: '0 auto 10px', opacity: 0.3 }} />Cargando...</div>
                ) : (
                    <div style={{ ...glass, overflow: 'hidden' }}>
                        {visible.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.2)' }}>{ceFilter ? 'No hay órdenes Contra Entrega' : 'No hay órdenes de Mensajería activas'}</div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                        {['', 'Cliente', 'Cuenta', 'Producto', 'Provincia', 'Teléfono', 'Total', 'Estado'].map(h => (
                                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map((o, idx) => (
                                        <tr key={o.id} onClick={() => toggle(o.id)} style={{ borderBottom: idx < visible.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', cursor: 'pointer', background: selected.has(o.id) ? 'rgba(139,135,255,0.07)' : 'transparent', transition: 'background 0.1s' }} className="lm-table-row">
                                            <td style={{ padding: '9px 12px', width: 32 }}>
                                                {selected.has(o.id) ? <CheckSquare size={14} style={{ color: '#8b87ff' }} /> : <Square size={14} style={{ color: 'rgba(255,255,255,0.2)' }} />}
                                            </td>
                                            <td style={{ padding: '9px 12px', color: '#F2F2F2', fontWeight: 600 }}>{o.customerName}<div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>#{o.orderId}</div></td>
                                            <td style={{ padding: '9px 12px', color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>{getTenantName(o.tenantId)}</td>
                                            <td style={{ padding: '9px 12px', color: 'rgba(255,255,255,0.5)', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.product || '—'}{o.quantity > 1 ? ` ×${o.quantity}` : ''}</td>
                                            <td style={{ padding: '9px 12px', color: 'rgba(255,255,255,0.4)' }}>{o.province || '—'}</td>
                                            <td style={{ padding: '9px 12px', color: 'rgba(255,255,255,0.4)' }}>{o.phone || '—'}</td>
                                            <td style={{ padding: '9px 12px', color: '#34d399', fontWeight: 700 }}>{fmt(o.total)}</td>
                                            <td style={{ padding: '9px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(139,135,255,0.12)', color: '#8b87ff', fontSize: 10.5, fontWeight: 600 }}>{o.lmStatus || 'Pendiente'}</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

            {/* ── PRINTABLE GUÍAS (2-up compact) ──────────────────── */}
            <div className="print-only" style={{ display: 'none' }}>
                <div className="guia-grid">
                    {selectedOrders.map(o => {
                        const addr = [o.address, o.district, o.canton, o.province].filter(Boolean).join(', ');
                        return (
                            <div key={o.id} className="guia-ticket">
                                <div style={{ background: '#3730a3', color: '#fff', padding: '5px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontWeight: 900, fontSize: 10, letterSpacing: 0.3 }}>🚚 MENSAJERÍA PRIVADA</span>
                                    <span style={{ fontSize: 9, opacity: 0.85 }}>{getTenantName(o.tenantId)}</span>
                                </div>
                                <div style={{ padding: '8px 10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, paddingBottom: 5, borderBottom: '1px solid #ddd' }}>
                                        <div>
                                            <div style={{ fontSize: 7, color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>Guía</div>
                                            <div style={{ fontWeight: 900, fontSize: 13, letterSpacing: 0.5 }}>#{o.orderId}</div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 7, color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>Fecha</div>
                                            <div style={{ fontSize: 9 }}>{new Date(o.timestamp).toLocaleDateString('es-CR')}</div>
                                        </div>
                                    </div>
                                    <div style={{ background: '#f5f5f5', padding: '6px 8px', borderRadius: 4, marginBottom: 6 }}>
                                        <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', color: '#666', marginBottom: 2 }}>Destinatario</div>
                                        <div style={{ fontWeight: 900, fontSize: 12 }}>{o.customerName}</div>
                                        {o.phone && <div style={{ fontSize: 9, marginTop: 1 }}>📞 {o.phone}</div>}
                                        {addr && <div style={{ fontSize: 9, marginTop: 1, color: '#444' }}>📍 {addr}</div>}
                                    </div>
                                    <div style={{ marginBottom: 6 }}>
                                        <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', color: '#666' }}>Contenido</div>
                                        <div style={{ fontSize: 10 }}>{o.product || 'Paquete'}{o.quantity && o.quantity > 1 ? ` × ${o.quantity}` : ''}</div>
                                        {o.comments && <div style={{ fontSize: 8, color: '#666', fontStyle: 'italic' }}>Nota: {o.comments}</div>}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 5, borderTop: '1px solid #ddd' }}>
                                        <div>
                                            {o.isContraEntrega && (
                                                <div style={{ border: '2px solid #d97706', borderRadius: 4, padding: '3px 7px', textAlign: 'center' }}>
                                                    <div style={{ fontWeight: 900, fontSize: 8, color: '#92400e' }}>CONTRA ENTREGA</div>
                                                    <div style={{ fontWeight: 900, fontSize: 12, color: '#92400e' }}>{fmt(o.total)}</div>
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontSize: 7, color: '#888' }}>Total</div>
                                            <div style={{ fontWeight: 900, fontSize: 14 }}>{fmt(o.total)}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <style>{`
                .lm-table-row:hover { background: rgba(255,255,255,0.03) !important; }
                @keyframes spin { to { transform: rotate(360deg); } }
                @media print {
                    .no-print { display: none !important; }
                    .print-only { display: block !important; }
                    body { background: white !important; margin: 0; padding: 0; }
                    .guia-grid {
                        display: flex; flex-wrap: wrap; gap: 8px;
                        font-family: Arial, Helvetica, sans-serif;
                    }
                    .guia-ticket {
                        width: 48%; box-sizing: border-box;
                        border: 1.5px solid #333; border-radius: 6px; overflow: hidden;
                        break-inside: avoid; page-break-inside: avoid;
                        margin-bottom: 4px;
                    }
                }
            `}</style>
        </div>
    );
}
