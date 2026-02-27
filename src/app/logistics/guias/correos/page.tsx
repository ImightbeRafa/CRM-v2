'use client';

import { useState, useEffect, useCallback } from 'react';
import { Mail, Printer, CheckSquare, Square, Search, RefreshCw, Package } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 } as const;

export default function GuiaCorreosPage() {
    const { tenants, getTenantName } = useTenantConfig();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [tenantFilter, setTenantFilter] = useState('');
    const [printing, setPrinting] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams({ limit: '300', lmCarrier: 'correos' });
            if (search) p.set('search', search);
            const data = await (await fetch(`/api/logistics/orders?${p}`)).json();
            const active = (data.orders || []).filter((o: any) => !['Entregado', 'Devuelto'].includes(o.lmStatus || ''));
            setOrders(active);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [search]);

    useEffect(() => { load(); }, [load]);

    const visible = tenantFilter ? orders.filter(o => o.tenantId === tenantFilter) : orders;
    const activeTenantIds = Array.from(new Set(orders.map(o => o.tenantId)));

    function toggle(id: string) { setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); }
    function selectAll() { setSelected(new Set(visible.map(o => o.id))); }
    function clearAll() { setSelected(new Set()); }

    async function printGuias() {
        if (selected.size === 0) return;
        setPrinting(true);
        for (const orderId of selected) {
            try {
                await fetch('/api/logistics/order-events', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId, eventType: 'guia_generated', payload: { carrier: 'correos' } }),
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
            <div className="no-print">
                <div style={{ marginBottom: 22 }}>
                    <h1 style={{ color: '#F2F2F2', fontSize: 22, fontWeight: 700, margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Mail size={20} style={{ color: '#60a5fa' }} /> Guías — Correos de Costa Rica
                    </h1>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>Selecciona las órdenes y genera los formularios postales</p>
                </div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                        <Search size={13} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)' }} />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, orden..."
                            style={{ width: '100%', padding: '8px 12px 8px 33px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
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
                        style={{ padding: '8px 20px', borderRadius: 9, border: '1px solid rgba(96,165,250,0.5)', background: selected.size > 0 ? 'rgba(96,165,250,0.15)' : 'transparent', color: selected.size > 0 ? '#60a5fa' : 'rgba(255,255,255,0.2)', cursor: selected.size > 0 ? 'pointer' : 'default', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7 }}>
                        {printing ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Printer size={13} />}
                        Imprimir {selected.size > 0 ? `(${selected.size})` : ''}
                    </button>
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)' }}><Package size={28} style={{ display: 'block', margin: '0 auto 10px', opacity: 0.3 }} />Cargando...</div>
                ) : (
                    <div style={{ ...glass, overflow: 'hidden' }}>
                        {visible.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.2)' }}>{tenantFilter ? 'No hay órdenes para esta cuenta' : 'No hay órdenes de Correos activas'}</div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                        {['', 'Cliente', 'Cuenta', 'Dirección', 'Provincia', 'Teléfono', 'Total', 'Estado'].map(h => (
                                            <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map((o, idx) => (
                                        <tr key={o.id} onClick={() => toggle(o.id)} style={{ borderBottom: idx < visible.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', cursor: 'pointer', background: selected.has(o.id) ? 'rgba(96,165,250,0.07)' : 'transparent', transition: 'background 0.1s' }} className="lm-table-row">
                                            <td style={{ padding: '9px 12px', width: 32 }}>
                                                {selected.has(o.id) ? <CheckSquare size={14} style={{ color: '#60a5fa' }} /> : <Square size={14} style={{ color: 'rgba(255,255,255,0.2)' }} />}
                                            </td>
                                            <td style={{ padding: '9px 12px', color: '#F2F2F2', fontWeight: 600 }}>{o.customerName}<div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>#{o.orderId}</div></td>
                                            <td style={{ padding: '9px 12px', color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>{getTenantName(o.tenantId)}</td>
                                            <td style={{ padding: '9px 12px', color: 'rgba(255,255,255,0.4)', fontSize: 11, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{[o.address, o.district, o.canton].filter(Boolean).join(', ') || '—'}</td>
                                            <td style={{ padding: '9px 12px', color: 'rgba(255,255,255,0.4)' }}>{o.province || '—'}</td>
                                            <td style={{ padding: '9px 12px', color: 'rgba(255,255,255,0.4)' }}>{o.phone || '—'}</td>
                                            <td style={{ padding: '9px 12px', color: '#34d399', fontWeight: 700 }}>{fmt(o.total)}</td>
                                            <td style={{ padding: '9px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(96,165,250,0.12)', color: '#60a5fa', fontSize: 10.5, fontWeight: 600 }}>{o.lmStatus || 'Pendiente'}</span></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

            {/* Printable Correos guías */}
            <div className="print-only" style={{ display: 'none' }}>
                {selectedOrders.map((o, idx) => (
                    <div key={o.id} style={{ width: '100%', maxWidth: 420, margin: '0 auto 32px', padding: '16px 20px', border: '2px solid #000', fontFamily: 'Arial, sans-serif', pageBreakAfter: idx < selectedOrders.length - 1 ? 'always' : 'auto' }}>
                        {/* Correos Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 10, borderBottom: '2px solid #000' }}>
                            <div>
                                <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: 0.5 }}>CORREOS DE COSTA RICA</div>
                                <div style={{ fontSize: 10, color: '#333' }}>Comprobante de Envío</div>
                            </div>
                            <div style={{ textAlign: 'right', background: '#f0f0f0', padding: '6px 10px', border: '1px solid #ccc' }}>
                                <div style={{ fontSize: 9, textTransform: 'uppercase', color: '#555' }}>N° Referencia</div>
                                <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: 1 }}>{o.orderId}</div>
                            </div>
                        </div>

                        {/* Remitente */}
                        <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: '#000', color: '#fff', padding: '2px 6px', marginBottom: 4, display: 'inline-block' }}>Remitente</div>
                            <div style={{ fontSize: 12, fontWeight: 700 }}>{getTenantName(o.tenantId)}</div>
                            <div style={{ fontSize: 10, color: '#333' }}>Costa Rica</div>
                        </div>

                        {/* Destinatario */}
                        <div style={{ background: '#f8f8f8', padding: '10px 12px', border: '1px solid #ccc', marginBottom: 10 }}>
                            <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Destinatario</div>
                            <div style={{ fontWeight: 900, fontSize: 14 }}>{o.customerName}</div>
                            {o.phone && <div style={{ fontSize: 11, marginTop: 2 }}>Tel: {o.phone}</div>}
                            {[o.address, o.district, o.canton, o.province].filter(Boolean).length > 0 && (
                                <div style={{ fontSize: 11, marginTop: 4 }}>{[o.address, o.district, o.canton, o.province].filter(Boolean).join(', ')}</div>
                            )}
                        </div>

                        {/* Contenido */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#555' }}>Contenido</div>
                                <div style={{ fontSize: 12 }}>{o.product || 'Mercancía'}{o.quantity > 1 ? ` (×${o.quantity})` : ''}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#555' }}>Valor declarado</div>
                                <div style={{ fontWeight: 700, fontSize: 13 }}>{fmt(o.total)}</div>
                            </div>
                        </div>

                        {/* CE stamp */}
                        {o.isContraEntrega && (
                            <div style={{ border: '2px solid #d97706', borderRadius: 6, padding: '6px 10px', textAlign: 'center', marginBottom: 8 }}>
                                <div style={{ fontWeight: 900, fontSize: 13, color: '#92400e' }}>CONTRA ENTREGA</div>
                                <div style={{ fontWeight: 700, fontSize: 15, color: '#92400e' }}>{fmt(o.total)}</div>
                            </div>
                        )}

                        <div style={{ textAlign: 'center', fontSize: 9, color: '#888', marginTop: 8 }}>Fecha de emisión: {new Date().toLocaleDateString('es-CR')}</div>
                    </div>
                ))}
            </div>

            <style>{`
                .lm-table-row:hover { background: rgba(255,255,255,0.03) !important; }
                @keyframes spin { to { transform: rotate(360deg); } }
                @media print {
                    .no-print { display: none !important; }
                    .print-only { display: block !important; }
                    body { background: white !important; margin: 0; }
                }
            `}</style>
        </div>
    );
}
