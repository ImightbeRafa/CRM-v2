'use client';

import { useState, useEffect, useCallback } from 'react';
import { Truck, Mail, Printer, CheckSquare, Square, Search, RefreshCw, Package } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 } as const;

const CARRIER_CFG = {
    mensajeria: { label: 'Mensajería Privada', color: '#8b87ff', Icon: Truck },
    correos: { label: 'Correos de Costa Rica', color: '#60a5fa', Icon: Mail },
} as const;

type CarrierKey = keyof typeof CARRIER_CFG;
type TabFilter = 'all' | CarrierKey;

export default function GuiasPage() {
    const { getTenantName } = useTenantConfig();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<TabFilter>('all');
    const [printing, setPrinting] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams({ limit: '500' });
            if (search) p.set('search', search);
            const data = await (await fetch(`/api/logistics/orders?${p}`)).json();
            // Only show orders that have been assigned to a carrier
            const assigned = (data.orders || []).filter(
                (o: any) => (o.lmCarrier === 'mensajeria' || o.lmCarrier === 'correos') &&
                    !['Entregado', 'Devuelto'].includes(o.lmStatus || '')
            );
            setOrders(assigned);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    }, [search]);

    useEffect(() => { load(); }, [load]);

    const visible = tab === 'all' ? orders : orders.filter(o => o.lmCarrier === tab);

    function toggle(id: string) {
        setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
    }
    function selectVisible() { setSelected(prev => { const s = new Set(prev); visible.forEach(o => s.add(o.id)); return s; }); }
    function clearVisible() { setSelected(prev => { const s = new Set(prev); visible.forEach(o => s.delete(o.id)); return s; }); }

    async function printGuias() {
        if (selected.size === 0) return;
        setPrinting(true);
        const selectedCarriers = orders.filter(o => selected.has(o.id)).reduce<Record<string, string>>((acc, o) => { acc[o.id] = o.lmCarrier; return acc; }, {});
        await Promise.allSettled(
            [...selected].map(orderId =>
                fetch('/api/logistics/order-events', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId, eventType: 'guia_generated', payload: { carrier: selectedCarriers[orderId] } }),
                })
            )
        );
        setPrinting(false);
        window.print();
    }

    const selectedOrders = orders.filter(o => selected.has(o.id));
    const fmt = (n: number) => `₡${(n || 0).toLocaleString('es-CR')}`;
    const mensajeriaCount = orders.filter(o => o.lmCarrier === 'mensajeria').length;
    const correosCount = orders.filter(o => o.lmCarrier === 'correos').length;

    return (
        <div>
            {/* ── Screen UI ─────────────────────────────────────────────── */}
            <div className="no-print">
                {/* Header */}
                <div style={{ marginBottom: 20 }}>
                    <h1 style={{ color: '#F2F2F2', fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Generador de Guías</h1>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>
                        Selecciona cualquier combinación de órdenes · cada ticket indica el carrier
                    </p>
                </div>

                {/* Toolbar */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Search */}
                    <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                        <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.3)', pointerEvents: 'none' }} />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, orden..."
                            style={{ width: '100%', padding: '8px 12px 8px 32px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                    </div>

                    {/* Filter tabs */}
                    <div style={{ display: 'flex', gap: 4 }}>
                        {([['all', 'Todos', `${orders.length}`, 'rgba(255,255,255,0.4)'],
                        ['mensajeria', 'Mensajería', `${mensajeriaCount}`, '#8b87ff'],
                        ['correos', 'Correos', `${correosCount}`, '#60a5fa'],
                        ] as [TabFilter, string, string, string][]).map(([id, label, count, color]) => (
                            <button key={id} onClick={() => setTab(id)}
                                style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${tab === id ? color + '60' : 'rgba(255,255,255,0.08)'}`, background: tab === id ? color + '14' : 'transparent', color: tab === id ? color : 'rgba(255,255,255,0.35)', fontSize: 12.5, fontWeight: tab === id ? 700 : 400, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                                {label}
                                <span style={{ padding: '1px 6px', borderRadius: 20, background: tab === id ? color + '25' : 'rgba(255,255,255,0.06)', fontSize: 10.5 }}>{count}</span>
                            </button>
                        ))}
                    </div>

                    <button onClick={selectVisible} style={{ padding: '7px 12px', ...glass, color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 11.5, whiteSpace: 'nowrap' }}>Sel. vista</button>
                    <button onClick={clearVisible} style={{ padding: '7px 12px', ...glass, color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 11.5 }}>Limpiar</button>
                    <button onClick={load} style={{ padding: '7px 10px', ...glass, color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><RefreshCw size={13} /></button>

                    {/* Print */}
                    <button onClick={printGuias} disabled={selected.size === 0 || printing}
                        style={{ padding: '7px 20px', borderRadius: 9, border: `1px solid ${selected.size > 0 ? 'rgba(139,135,255,0.5)' : 'rgba(255,255,255,0.07)'}`, background: selected.size > 0 ? 'rgba(139,135,255,0.14)' : 'transparent', color: selected.size > 0 ? '#8b87ff' : 'rgba(255,255,255,0.18)', cursor: selected.size > 0 ? 'pointer' : 'default', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                        {printing ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Printer size={13} />}
                        Imprimir {selected.size > 0 ? `(${selected.size})` : ''}
                    </button>
                </div>

                {/* Table */}
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)' }}><Package size={28} style={{ display: 'block', margin: '0 auto 10px', opacity: 0.3 }} />Cargando...</div>
                ) : (
                    <div style={{ ...glass, overflow: 'hidden' }}>
                        {visible.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.2)' }}>No hay órdenes asignadas</div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                        {['', 'Carrier', 'Cliente', 'Cuenta', 'Producto', 'Provincia', 'Teléfono', 'Total', 'Estado'].map(h => (
                                            <th key={h} style={{ padding: '9px 11px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {visible.map((o, idx) => {
                                        const cfg = CARRIER_CFG[o.lmCarrier as CarrierKey];
                                        const isSel = selected.has(o.id);
                                        return (
                                            <tr key={o.id} onClick={() => toggle(o.id)}
                                                style={{ borderBottom: idx < visible.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', cursor: 'pointer', background: isSel ? `${cfg.color}10` : 'transparent', transition: 'background 0.1s' }}
                                                className="lm-table-row">
                                                <td style={{ padding: '8px 11px', width: 30 }}>
                                                    {isSel ? <CheckSquare size={13} style={{ color: cfg.color }} /> : <Square size={13} style={{ color: 'rgba(255,255,255,0.18)' }} />}
                                                </td>
                                                <td style={{ padding: '8px 11px' }}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 20, background: `${cfg.color}15`, color: cfg.color, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                        {o.lmCarrier === 'mensajeria' ? <Truck size={9} /> : <Mail size={9} />}
                                                        {o.lmCarrier === 'mensajeria' ? 'Mensajería' : 'Correos'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '8px 11px', color: '#F2F2F2', fontWeight: 600 }}>{o.customerName}<div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 9.5 }}>#{o.orderId}</div></td>
                                                <td style={{ padding: '8px 11px', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{getTenantName(o.tenantId)}</td>
                                                <td style={{ padding: '8px 11px', color: 'rgba(255,255,255,0.45)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.product || '—'}{o.quantity > 1 ? ` ×${o.quantity}` : ''}</td>
                                                <td style={{ padding: '8px 11px', color: 'rgba(255,255,255,0.38)' }}>{o.province || '—'}</td>
                                                <td style={{ padding: '8px 11px', color: 'rgba(255,255,255,0.38)' }}>{o.phone || '—'}</td>
                                                <td style={{ padding: '8px 11px', color: '#34d399', fontWeight: 700 }}>{fmt(o.total)}</td>
                                                <td style={{ padding: '8px 11px' }}><span style={{ padding: '2px 8px', borderRadius: 20, background: `${cfg.color}12`, color: cfg.color, fontSize: 10.5, fontWeight: 600 }}>{o.lmStatus || 'Pendiente'}</span></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}
            </div>

            {/* ── PRINTABLE GUÍAS ─────────────────────────────────────────── */}
            <div className="print-only" style={{ display: 'none' }}>
                {selectedOrders.map((o, idx) => {
                    const isMens = o.lmCarrier === 'mensajeria';
                    const addr = [o.address, o.district, o.canton, o.province].filter(Boolean).join(', ');
                    const isLast = idx === selectedOrders.length - 1;

                    return (
                        <div key={o.id} style={{ width: '100%', maxWidth: 420, margin: '0 auto 32px', fontFamily: 'Arial, sans-serif', pageBreakAfter: isLast ? 'auto' : 'always' }}>
                            {/* Carrier banner */}
                            <div style={{ background: isMens ? '#3730a3' : '#1e40af', color: '#fff', padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '8px 8px 0 0' }}>
                                <span style={{ fontWeight: 900, fontSize: 13, letterSpacing: 0.5 }}>
                                    {isMens ? '🚚  MENSAJERÍA PRIVADA' : '📮  CORREOS DE COSTA RICA'}
                                </span>
                                <span style={{ fontSize: 11, opacity: 0.8 }}>{getTenantName(o.tenantId)}</span>
                            </div>

                            <div style={{ border: '2px solid #333', borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '14px 18px' }}>
                                {/* Reference + Date */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #ddd' }}>
                                    <div>
                                        <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', fontWeight: 700 }}>N° Referencia</div>
                                        <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: 1 }}>{o.orderId}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', fontWeight: 700 }}>Fecha</div>
                                        <div style={{ fontSize: 11 }}>{new Date(o.timestamp).toLocaleDateString('es-CR')}</div>
                                    </div>
                                </div>

                                {/* Destinatario */}
                                <div style={{ background: '#f5f5f5', padding: '10px 12px', borderRadius: 6, marginBottom: 10 }}>
                                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#555', marginBottom: 4 }}>Destinatario</div>
                                    <div style={{ fontWeight: 900, fontSize: 15 }}>{o.customerName}</div>
                                    {o.phone && <div style={{ fontSize: 11, marginTop: 3 }}>📞 {o.phone}</div>}
                                    {addr && <div style={{ fontSize: 11, marginTop: 3, color: '#333' }}>📍 {addr}</div>}
                                </div>

                                {/* Contenido */}
                                <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#555', marginBottom: 3 }}>Contenido</div>
                                    <div style={{ fontSize: 12 }}>{o.product || 'Paquete'}{o.quantity > 1 ? ` × ${o.quantity}` : ''}</div>
                                    {o.comments && <div style={{ fontSize: 10, color: '#666', marginTop: 3, fontStyle: 'italic' }}>Nota: {o.comments}</div>}
                                </div>

                                {/* Footer */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 10, borderTop: '1px solid #ddd' }}>
                                    <div>
                                        {o.isContraEntrega && (
                                            <div style={{ border: '2px solid #d97706', borderRadius: 5, padding: '5px 10px', textAlign: 'center' }}>
                                                <div style={{ fontWeight: 900, fontSize: 11, color: '#92400e' }}>CONTRA ENTREGA</div>
                                                <div style={{ fontWeight: 900, fontSize: 15, color: '#92400e' }}>{fmt(o.total)}</div>
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 9, color: '#666' }}>Valor declarado</div>
                                        <div style={{ fontWeight: 900, fontSize: 17 }}>{fmt(o.total)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <style>{`
                .lm-table-row:hover { background: rgba(255,255,255,0.03) !important; }
                @keyframes spin { to { transform: rotate(360deg); } }
                @media print {
                    .no-print  { display: none !important; }
                    .print-only { display: block !important; }
                    body { background: white !important; margin: 0; }
                }
            `}</style>
        </div>
    );
}
