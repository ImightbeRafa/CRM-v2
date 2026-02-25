'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, Search, Truck, Mail, ArrowRight, RefreshCcw, ChevronDown, ChevronUp, Filter, CheckSquare, Square, Layers, Clock, PlusCircle, X } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

interface Order {
    id: string; orderId: string; tenantId: string; status: string; timestamp: string;
    customerName: string; phone: string | null; email: string | null; product: string | null;
    quantity: number | null; province: string | null; canton: string | null; district: string | null;
    address: string | null; total: number; comments: string | null; delivery: string | null;
    lmCarrier: string | null; lmStatus: string | null; isContraEntrega: boolean; contraEntregaCollected: boolean;
}

const STATUSES = ['Pendiente', 'En Proceso', 'En Tránsito', 'Entregado', 'Devuelto'];
const STATUS_CFG: Record<string, { color: string; glow: string }> = {
    'Pendiente': { color: '#94a3b8', glow: 'rgba(148,163,184,0.15)' },
    'En Proceso': { color: '#8b87ff', glow: 'rgba(139,135,255,0.15)' },
    'En Tránsito': { color: '#c084fc', glow: 'rgba(192,132,252,0.15)' },
    'Entregado': { color: '#34d399', glow: 'rgba(52,211,153,0.15)' },
    'Devuelto': { color: '#fbbf24', glow: 'rgba(251,191,36,0.15)' },
};
const LM_TO_CRM: Record<string, string> = {
    'Pendiente': 'Pendiente', 'En Proceso': 'En Proceso',
    'En Tránsito': 'Enviado', 'Entregado': 'Completado', 'Devuelto': 'Devuelto',
};

const glass = {
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
} as const;

function dateKey(ts: string) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatDate(ts: string) {
    return new Date(ts).toLocaleDateString('es-CR', { weekday: 'long', day: '2-digit', month: 'long' });
}
function groupByDate(orders: Order[]) {
    const m: Record<string, Order[]> = {};
    for (const o of orders) { const k = dateKey(o.timestamp); if (!m[k]) m[k] = []; m[k].push(o); }
    return Object.entries(m).sort(([a], [b]) => b.localeCompare(a)).map(([k, v]) => ({ dateKey: k, dateLabel: formatDate(v[0].timestamp), orders: v }));
}

async function patchOrder(orderId: string, patch: object) {
    await fetch('/api/logistics/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, ...patch }) });
}
async function syncCrm(orderId: string, lmStatus: string) {
    await fetch('/api/logistics/sync-crm-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, lmStatus }) });
}
async function logEvent(orderId: string, eventType: string, payload: object = {}) {
    try {
        await fetch('/api/logistics/order-events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, eventType, payload }) });
    } catch { }
}

// ─── Historial Panel ──────────────────────────────────────────────────────────
function HistorialPanel({ orderId }: { orderId: string }) {
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetch(`/api/logistics/order-events?orderId=${orderId}`)
            .then(r => r.json())
            .then(d => { setEvents(d.events || []); setLoading(false); });
    }, [orderId]);

    async function addNote() {
        if (!note.trim()) return;
        setSaving(true);
        await logEvent(orderId, 'note', { text: note });
        const fresh = await (await fetch(`/api/logistics/order-events?orderId=${orderId}`)).json();
        setEvents(fresh.events || []);
        setNote('');
        setSaving(false);
    }

    const eventIcon: Record<string, string> = { carrier_assigned: '🚚', status_change: '🔄', ce_confirmed: '💵', guia_generated: '🖨', note: '📝', bulk_update: '⚡' };
    const timeAgo = (ts: string) => { const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000); if (s < 60) return 'hace un momento'; if (s < 3600) return `hace ${Math.floor(s / 60)}m`; if (s < 86400) return `hace ${Math.floor(s / 3600)}h`; return new Date(ts).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' }); };

    return (
        <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', marginBottom: 8 }}>
            {loading ? <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, margin: 0, textAlign: 'center' }}>...</p> : (
                events.length === 0 ? (
                    <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, margin: '0 0 8px', textAlign: 'center' }}>Sin historial aún</p>
                ) : (
                    <div style={{ maxHeight: 160, overflowY: 'auto', marginBottom: 8 }}>
                        {events.map((e) => (
                            <div key={e.id} style={{ display: 'flex', gap: 7, marginBottom: 6, alignItems: 'flex-start' }}>
                                <span style={{ fontSize: 12, flexShrink: 0 }}>{eventIcon[e.event_type] || '•'}</span>
                                <div style={{ flex: 1 }}>
                                    <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10.5 }}>
                                        {e.event_type === 'note' ? e.payload?.text
                                            : e.event_type === 'status_change' ? `${e.payload?.from} → ${e.payload?.to}`
                                                : e.event_type === 'guia_generated' ? `Guía generada (${e.payload?.carrier})`
                                                    : e.event_type === 'bulk_update' ? `Actualización masiva (${e.payload?.lmStatus || e.payload?.lmCarrier})`
                                                        : e.event_type}
                                    </span>
                                    <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 9.5, display: 'block' }}>{timeAgo(e.created_at)} · {e.actor?.split('@')[0] || 'sistema'}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )
            )}
            <div style={{ display: 'flex', gap: 5 }}>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Agregar nota..." onKeyDown={e => e.key === 'Enter' && !e.shiftKey && addNote()}
                    style={{ flex: 1, padding: '4px 9px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#F2F2F2', fontSize: 11, outline: 'none' }} />
                <button onClick={addNote} disabled={!note.trim() || saving} style={{ padding: '4px 9px', borderRadius: 6, border: '1px solid rgba(139,135,255,0.3)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><PlusCircle size={11} /></button>
            </div>
        </div>
    );
}

// ─── Order Card (kanban) ──────────────────────────────────────────────────────
function OrderCard({ order, onMoveStatus, onMoveCarrier, onToggleCOD, onToggleCollected, carrier, getTenantName, getTenantColor, bulkMode, selected, onToggleSelect }: {
    order: Order; onMoveStatus: (id: string, s: string, c: string) => void; onMoveCarrier: (id: string, c: string) => void;
    onToggleCOD: (id: string, v: boolean) => void; onToggleCollected: (id: string, v: boolean) => void;
    carrier: string; getTenantName: (id: string) => string; getTenantColor: (id: string) => string;
    bulkMode: boolean; selected: boolean; onToggleSelect: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);
    const [syncing, setSyncing] = useState(false); const [synced, setSynced] = useState(false);
    const color = getTenantColor(order.tenantId);
    const idx = STATUSES.indexOf(order.lmStatus || 'Pendiente');
    const next = idx < STATUSES.length - 1 ? STATUSES[idx + 1] : null;
    const prev = idx > 0 ? STATUSES[idx - 1] : null;
    const other = carrier === 'mensajeria' ? 'correos' : 'mensajeria';
    const otherLabel = carrier === 'mensajeria' ? 'Correos' : 'Mensajería';
    const addr = [order.address, order.district, order.canton, order.province].filter(Boolean).join(', ');

    async function handleSync() { setSyncing(true); await syncCrm(order.id, order.lmStatus || 'Pendiente'); setSyncing(false); setSynced(true); setTimeout(() => setSynced(false), 2500); }

    return (
        <div
            onClick={bulkMode ? () => onToggleSelect(order.id) : undefined}
            style={{
                background: selected ? 'rgba(139,135,255,0.1)' : order.isContraEntrega ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                border: selected ? '1px solid rgba(139,135,255,0.4)' : `1px solid ${order.isContraEntrega ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 10, marginBottom: 6, overflow: 'hidden', transition: 'border-color 0.15s', cursor: bulkMode ? 'pointer' : 'default',
            }} className="lm-order-card">
            {order.isContraEntrega && (
                <div style={{ background: 'rgba(251,191,36,0.1)', padding: '4px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(251,191,36,0.15)' }}>
                    <span style={{ color: '#fbbf24', fontSize: 10, fontWeight: 700 }}>💵 CONTRA ENTREGA</span>
                    <button onClick={() => onToggleCollected(order.id, !order.contraEntregaCollected)}
                        style={{ padding: '2px 9px', borderRadius: 20, border: `1px solid ${order.contraEntregaCollected ? 'rgba(52,211,153,0.4)' : 'rgba(251,191,36,0.35)'}`, background: order.contraEntregaCollected ? 'rgba(52,211,153,0.12)' : 'transparent', color: order.contraEntregaCollected ? '#34d399' : '#fbbf24', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                        {order.contraEntregaCollected ? '✓ Cobrado' : '○ Pendiente cobro'}
                    </button>
                </div>
            )}
            <div style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                        {bulkMode && (
                            <div style={{ flexShrink: 0, color: selected ? '#8b87ff' : 'rgba(255,255,255,0.2)' }}>
                                {selected ? <CheckSquare size={13} /> : <Square size={13} />}
                            </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ color: '#F2F2F2', fontWeight: 600, margin: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.customerName}</p>
                            <p style={{ color: 'rgba(255,255,255,0.3)', margin: '1px 0 0', fontSize: 10 }}>#{order.orderId} · {new Date(order.timestamp).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}</p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexShrink: 0, marginLeft: 6 }}>
                        <span style={{ padding: '1px 7px', borderRadius: 20, background: `${color}22`, color, fontSize: 9.5, fontWeight: 700 }}>{getTenantName(order.tenantId)}</span>
                        <button onClick={e => { e.stopPropagation(); setShowHistorial(!showHistorial); }} style={{ background: 'none', border: 'none', color: showHistorial ? '#8b87ff' : 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }} title="Historial">
                            <Clock size={11} />
                        </button>
                        <button onClick={e => { e.stopPropagation(); setExpanded(!expanded); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}>
                            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {order.province && <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>📍 {order.province}</span>}
                    {order.product && <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>{order.product}{order.quantity && order.quantity > 1 ? ` ×${order.quantity}` : ''}</span>}
                    <span style={{ color: '#34d399', fontWeight: 700, fontSize: 11, marginLeft: 'auto' }}>₡{order.total.toLocaleString('es-CR')}</span>
                </div>
                {showHistorial && <HistorialPanel orderId={order.id} />}
                {expanded && (
                    <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 8, marginBottom: 8, border: '1px solid rgba(255,255,255,0.06)', fontSize: 11 }}>
                        {order.phone && <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}><span style={{ color: 'rgba(255,255,255,0.3)', minWidth: 56 }}>Teléfono</span><span style={{ color: 'rgba(255,255,255,0.7)' }}>{order.phone}</span></div>}
                        {order.product && <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}><span style={{ color: 'rgba(255,255,255,0.3)', minWidth: 56 }}>Producto</span><span style={{ color: 'rgba(255,255,255,0.7)' }}>{order.product}{order.quantity ? ` × ${order.quantity}` : ''}</span></div>}
                        {addr && <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}><span style={{ color: 'rgba(255,255,255,0.3)', minWidth: 56 }}>Dirección</span><span style={{ color: 'rgba(255,255,255,0.7)' }}>{addr}</span></div>}
                        {order.delivery && <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}><span style={{ color: 'rgba(255,255,255,0.3)', minWidth: 56 }}>Entrega</span><span style={{ color: 'rgba(255,255,255,0.7)' }}>{order.delivery}</span></div>}
                        {order.comments && <div style={{ marginTop: 6, padding: '6px 9px', background: 'rgba(255,255,255,0.04)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.07)' }}>
                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, margin: '0 0 2px', textTransform: 'uppercase' }}>Comentarios</p>
                            <p style={{ color: 'rgba(255,255,255,0.6)', margin: 0, fontSize: 11, lineHeight: 1.5 }}>{order.comments}</p>
                        </div>}
                        <button onClick={e => { e.stopPropagation(); onToggleCOD(order.id, !order.isContraEntrega); }} style={{ marginTop: 8, padding: '4px 10px', borderRadius: 6, border: `1px solid ${order.isContraEntrega ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)'}`, background: order.isContraEntrega ? 'rgba(251,191,36,0.08)' : 'transparent', color: order.isContraEntrega ? '#fbbf24' : 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                            {order.isContraEntrega ? '💵 Quitar Contra Entrega' : '+ Marcar Contra Entrega'}
                        </button>
                    </div>
                )}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {prev && <button onClick={() => onMoveStatus(order.id, prev, carrier)} style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 10, cursor: 'pointer' }}>← {prev.replace('En ', '')}</button>}
                    {next && <button onClick={() => onMoveStatus(order.id, next, carrier)} style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 10, cursor: 'pointer' }}>{next.replace('En ', '')} →</button>}
                    <button onClick={() => onMoveCarrier(order.id, other)} style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid rgba(139,135,255,0.3)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <ArrowRight size={9} /> {otherLabel}
                    </button>
                    <button onClick={handleSync} disabled={syncing} style={{ padding: '3px 7px', borderRadius: 5, border: `1px solid ${synced ? 'rgba(52,211,153,0.4)' : 'rgba(52,211,153,0.18)'}`, background: synced ? 'rgba(52,211,153,0.1)' : 'transparent', color: synced ? '#34d399' : 'rgba(255,255,255,0.35)', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }} title={`→ Betsy: ${LM_TO_CRM[order.lmStatus || 'Pendiente']}`}>
                        <RefreshCcw size={9} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {synced ? '✓ Betsy' : '→ Betsy'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Kanban Board (single carrier) ───────────────────────────────────────────
function Board({ title, icon, carrier, orders, onMove, onMoveCarrier, onToggleCOD, onToggleCollected, accentColor, getTenantName, getTenantColor, bulkMode, selectedIds, onToggleSelect }: {
    title: string; icon: React.ReactNode; carrier: string; orders: Order[]; accentColor: string;
    onMove: (id: string, s: string, c: string) => void; onMoveCarrier: (id: string, c: string) => void;
    onToggleCOD: (id: string, v: boolean) => void; onToggleCollected: (id: string, v: boolean) => void;
    getTenantName: (id: string) => string; getTenantColor: (id: string) => string;
    bulkMode: boolean; selectedIds: Set<string>; onToggleSelect: (id: string) => void;
}) {
    const cols = STATUSES.map(s => ({ status: s, orders: orders.filter(o => (o.lmStatus || 'Pendiente') === s) }));
    const cod = orders.filter(o => o.isContraEntrega).length;
    const cobrado = orders.filter(o => o.isContraEntrega && o.contraEntregaCollected).length;

    return (
        <div style={{ marginBottom: 14 }}>
            {/* Board header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: '12px 12px 0 0', border: `1px solid ${accentColor}35`, borderBottom: 'none' }}>
                <div style={{ color: accentColor, filter: `drop-shadow(0 0 6px ${accentColor})` }}>{icon}</div>
                <div style={{ flex: 1 }}>
                    <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 14, margin: 0 }}>{title}</p>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: 0 }}>{orders.length} órdenes{cod > 0 ? ` · 💵 ${cobrado}/${cod} cobrado` : ''}</p>
                </div>
            </div>
            {/* Columns — horizontally scrollable, vertically capped */}
            <div style={{
                display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden',
                padding: '10px', background: 'rgba(0,0,0,0.3)',
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                border: `1px solid ${accentColor}22`, borderRadius: '0 0 12px 12px',
            }}>
                {cols.map(({ status, orders: col }) => {
                    const sc = STATUS_CFG[status];
                    return (
                        <div key={status} style={{ minWidth: 190, flex: '0 0 190px', display: 'flex', flexDirection: 'column' }}>
                            {/* Column header */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, padding: '5px 10px', borderRadius: 7, background: sc.glow, border: `1px solid ${sc.color}35`, flexShrink: 0 }}>
                                <span style={{ color: sc.color, fontWeight: 600, fontSize: 11 }}>{status}</span>
                                <span style={{ background: `${sc.color}30`, color: sc.color, padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>{col.length}</span>
                            </div>
                            {/* Scrollable cards */}
                            <div style={{ overflowY: 'auto', maxHeight: 420, paddingRight: 2 }}>
                                {col.map(o => (
                                    <OrderCard key={o.id} order={o} onMoveStatus={onMove} onMoveCarrier={onMoveCarrier}
                                        onToggleCOD={onToggleCOD} onToggleCollected={onToggleCollected} carrier={carrier}
                                        getTenantName={getTenantName} getTenantColor={getTenantColor}
                                        bulkMode={bulkMode} selected={selectedIds.has(o.id)} onToggleSelect={onToggleSelect} />
                                ))}
                                {col.length === 0 && (
                                    <div style={{ textAlign: 'center', padding: '20px 8px', color: 'rgba(255,255,255,0.15)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 8, fontSize: 11 }}>
                                        Sin órdenes
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CarriersPage() {
    const { getTenantName, getTenantColor } = useTenantConfig();
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [provinceFilter, setProvinceFilter] = useState('');
    const [dateFilter, setDateFilter] = useState('');
    const [bulkMode, setBulkMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [bulkStatus, setBulkStatus] = useState('');
    const [bulkCarrier, setBulkCarrier] = useState('');
    const [applying, setApplying] = useState(false);

    const load = useCallback(async () => {
        try {
            const p = new URLSearchParams({ limit: '500' });
            if (search) p.set('search', search);
            const data = await (await fetch(`/api/logistics/orders?${p}`)).json();
            setOrders(data.orders || []);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [search]);

    useEffect(() => { load(); }, [load]);

    const onMove = useCallback((id: string, s: string, c: string) => { setOrders(p => p.map(o => o.id === id ? { ...o, lmStatus: s, lmCarrier: c } : o)); patchOrder(id, { lmCarrier: c, lmStatus: s }); logEvent(id, 'status_change', { to: s }); }, []);
    const onMoveC = useCallback((id: string, c: string) => { setOrders(p => p.map(o => o.id === id ? { ...o, lmCarrier: c, lmStatus: o.lmStatus || 'Pendiente' } : o)); patchOrder(id, { lmCarrier: c }); logEvent(id, 'carrier_assigned', { carrier: c }); }, []);
    const onAssign = useCallback((id: string, c: string) => { setOrders(p => p.map(o => o.id === id ? { ...o, lmCarrier: c, lmStatus: 'Pendiente' } : o)); patchOrder(id, { lmCarrier: c, lmStatus: 'Pendiente' }); logEvent(id, 'carrier_assigned', { carrier: c }); }, []);
    const onCOD = useCallback((id: string, v: boolean) => { setOrders(p => p.map(o => o.id === id ? { ...o, isContraEntrega: v } : o)); patchOrder(id, { isContraEntrega: v }); }, []);
    const onColl = useCallback((id: string, v: boolean) => { setOrders(p => p.map(o => o.id === id ? { ...o, contraEntregaCollected: v } : o)); patchOrder(id, { contraEntregaCollected: v }); if (v) logEvent(id, 'ce_confirmed', {}); }, []);
    const onToggleSelect = useCallback((id: string) => { setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); }, []);

    const applyBulk = useCallback(async () => {
        const ids = [...selectedIds];
        if (!ids.length || (!bulkStatus && !bulkCarrier)) return;
        setApplying(true);
        const patch: any = {};
        if (bulkStatus) patch.lmStatus = bulkStatus;
        if (bulkCarrier) patch.lmCarrier = bulkCarrier;
        await fetch('/api/logistics/bulk-patch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: ids, patch }) });
        setOrders(p => p.map(o => selectedIds.has(o.id) ? { ...o, ...{ lmStatus: bulkStatus || o.lmStatus, lmCarrier: bulkCarrier || o.lmCarrier } } : o));
        setSelectedIds(new Set());
        setBulkStatus('');
        setBulkCarrier('');
        setApplying(false);
    }, [selectedIds, bulkStatus, bulkCarrier]);

    const applyFilters = (list: Order[]) => {
        if (provinceFilter) list = list.filter(o => o.province?.toLowerCase().includes(provinceFilter.toLowerCase()));
        if (dateFilter) list = list.filter(o => dateKey(o.timestamp) === dateFilter);
        return list;
    };

    const unassigned = applyFilters(orders.filter(o => !o.lmCarrier));
    const mensajeria = applyFilters(orders.filter(o => o.lmCarrier === 'mensajeria'));
    const correos = applyFilters(orders.filter(o => o.lmCarrier === 'correos'));
    const byDate = groupByDate(unassigned);
    const provinces = Array.from(new Set(orders.map(o => o.province).filter(Boolean))) as string[];
    const dates = Array.from(new Set(orders.map(o => dateKey(o.timestamp)))).sort((a, b) => b.localeCompare(a));

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>
                <Package size={36} style={{ display: 'block', margin: '0 auto 12px' }} />
                <p style={{ margin: 0, fontSize: 14 }}>Cargando tablero...</p>
            </div>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>

            {/* ── Top bar: title + filters ──────────────────────────────── */}
            <div style={{ flexShrink: 0, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
                    <div>
                        <h1 style={{ color: '#F2F2F2', fontSize: 22, fontWeight: 700, margin: '0 0 2px' }}>Tablero de Envíos</h1>
                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: 0 }}>
                            {mensajeria.length} Mensajería · {correos.length} Correos · <span style={{ color: unassigned.length > 0 ? '#fbbf24' : 'rgba(255,255,255,0.35)' }}>{unassigned.length} por asignar</span>
                        </p>
                    </div>
                    <button onClick={() => { setBulkMode(b => !b); setSelectedIds(new Set()); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', borderRadius: 9, border: `1px solid ${bulkMode ? 'rgba(139,135,255,0.5)' : 'rgba(255,255,255,0.1)'}`, background: bulkMode ? 'rgba(139,135,255,0.12)' : 'transparent', color: bulkMode ? '#8b87ff' : 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, transition: 'all 0.15s' }}>
                        <Layers size={13} /> {bulkMode ? 'Salir Selección' : 'Selección Múltiple'}
                    </button>
                </div>

                {/* Filters row */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
                        <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, orden..."
                            style={{ width: '100%', padding: '7px 12px 7px 30px', ...glass, color: '#F2F2F2', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                    {[
                        { value: provinceFilter, set: setProvinceFilter, label: 'Todas las provincias', opts: provinces.map(p => ({ v: p, l: p })) },
                        { value: dateFilter, set: setDateFilter, label: 'Todas las fechas', opts: dates.map(d => ({ v: d, l: new Date(d + 'T12:00:00').toLocaleDateString('es-CR', { weekday: 'short', day: '2-digit', month: 'short' }) })) },
                    ].map((f, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                            <Filter size={11} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />
                            <select value={f.value} onChange={e => f.set(e.target.value)} style={{ padding: '7px 14px 7px 28px', ...glass, color: f.value ? '#F2F2F2' : 'rgba(255,255,255,0.3)', fontSize: 12.5, outline: 'none', cursor: 'pointer' }}>
                                <option value="">{f.label}</option>
                                {f.opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                        </div>
                    ))}
                </div>

                {/* Bulk action bar */}
                {bulkMode && selectedIds.size > 0 && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px', background: 'rgba(139,135,255,0.1)', border: '1px solid rgba(139,135,255,0.3)', borderRadius: 10, marginTop: 10, flexWrap: 'wrap' }}>
                        <span style={{ color: '#8b87ff', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>{selectedIds.size} seleccionados</span>
                        <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#F2F2F2', fontSize: 12, outline: 'none', cursor: 'pointer' }}>
                            <option value=''>— Estado —</option>
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <select value={bulkCarrier} onChange={e => setBulkCarrier(e.target.value)} style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#F2F2F2', fontSize: 12, outline: 'none', cursor: 'pointer' }}>
                            <option value=''>— Carrier —</option>
                            <option value='mensajeria'>Mensajería</option>
                            <option value='correos'>Correos</option>
                        </select>
                        <button onClick={applyBulk} disabled={applying || (!bulkStatus && !bulkCarrier)}
                            style={{ padding: '5px 16px', borderRadius: 7, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.1)', color: '#34d399', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>
                            {applying ? 'Aplicando...' : '✓ Aplicar'}
                        </button>
                        <button onClick={() => setSelectedIds(new Set())} style={{ marginLeft: 'auto', padding: '5px 10px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                            <X size={11} /> Limpiar
                        </button>
                    </div>
                )}
            </div>

            {/* ── Body: 2-column split ──────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 14, flex: 1, overflow: 'hidden', minHeight: 0 }}>

                {/* LEFT: Kanban boards (Mensajería + Correos stacked) */}
                <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, paddingRight: 4 }}>
                    <Board title="Mensajería Privada" icon={<Truck size={17} />} carrier="mensajeria" orders={mensajeria}
                        onMove={onMove} onMoveCarrier={onMoveC} onToggleCOD={onCOD} onToggleCollected={onColl}
                        accentColor="#8b87ff" getTenantName={getTenantName} getTenantColor={getTenantColor}
                        bulkMode={bulkMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
                    <Board title="Correos de Costa Rica" icon={<Mail size={17} />} carrier="correos" orders={correos}
                        onMove={onMove} onMoveCarrier={onMoveC} onToggleCOD={onCOD} onToggleCollected={onColl}
                        accentColor="#60a5fa" getTenantName={getTenantName} getTenantColor={getTenantColor}
                        bulkMode={bulkMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} />
                </div>

                {/* RIGHT: Sin Asignar inbox */}
                <div style={{ width: 310, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {/* Panel header */}
                    <div style={{
                        padding: '10px 14px', background: 'rgba(251,191,36,0.06)',
                        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
                        border: '1px solid rgba(251,191,36,0.22)', borderRadius: '12px 12px 0 0', borderBottom: 'none',
                        flexShrink: 0,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Package size={16} style={{ color: '#fbbf24', filter: 'drop-shadow(0 0 6px #fbbf24)' }} />
                            <div>
                                <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13.5, margin: 0 }}>Sin Asignar</p>
                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: 0 }}>
                                    {unassigned.length} órdenes · asignar a carrier
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable cards */}
                    <div style={{
                        flex: 1, overflowY: 'auto', padding: '10px',
                        background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                        border: '1px solid rgba(251,191,36,0.15)', borderRadius: '0 0 12px 12px',
                    }}>
                        {byDate.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px 16px', color: 'rgba(255,255,255,0.2)' }}>
                                <Package size={24} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.3 }} />
                                <p style={{ margin: 0, fontSize: 12 }}>Todo asignado ✓</p>
                            </div>
                        ) : byDate.map(g => (
                            <div key={g.dateKey} style={{ marginBottom: 14 }}>
                                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 20, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', display: 'inline-block', marginBottom: 7, textTransform: 'capitalize' }}>
                                    {g.dateLabel} — {g.orders.length}
                                </span>
                                {g.orders.map(o => {
                                    const tc = getTenantColor(o.tenantId);
                                    return (
                                        <div key={o.id} style={{ background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: `1px solid ${o.isContraEntrega ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, padding: '10px 12px', marginBottom: 6, fontSize: 12 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                                                <div>
                                                    <p style={{ color: '#F2F2F2', fontWeight: 600, margin: 0, fontSize: 12 }}>{o.customerName}</p>
                                                    <p style={{ color: 'rgba(255,255,255,0.3)', margin: '1px 0 0', fontSize: 9.5 }}>#{o.orderId}</p>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                                                    <span style={{ padding: '1px 7px', borderRadius: 20, background: `${tc}20`, color: tc, fontSize: 9.5, fontWeight: 700 }}>{getTenantName(o.tenantId)}</span>
                                                    {o.isContraEntrega && <span style={{ padding: '1px 6px', borderRadius: 20, background: 'rgba(251,191,36,0.12)', color: '#fbbf24', fontSize: 9, fontWeight: 700 }}>💵 CE</span>}
                                                </div>
                                            </div>
                                            {o.phone && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: '0 0 2px' }}>📞 {o.phone}</p>}
                                            {o.product && <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.product}{o.quantity && o.quantity > 1 ? ` ×${o.quantity}` : ''}</p>}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: o.comments ? 4 : 8 }}>
                                                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>📍 {o.canton || o.province || '—'}</span>
                                                <span style={{ color: '#34d399', fontWeight: 700, fontSize: 11 }}>₡{o.total.toLocaleString('es-CR')}</span>
                                            </div>
                                            {o.comments && <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, margin: '0 0 8px', fontStyle: 'italic' }}>"{o.comments.slice(0, 55)}{o.comments.length > 55 ? '…' : ''}"</p>}
                                            <div style={{ display: 'flex', gap: 5 }}>
                                                <button onClick={() => onAssign(o.id, 'mensajeria')} style={{ flex: 1, padding: '5px 6px', borderRadius: 6, border: '1px solid rgba(139,135,255,0.35)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                                                    <Truck size={9} /> Mensajería
                                                </button>
                                                <button onClick={() => onAssign(o.id, 'correos')} style={{ flex: 1, padding: '5px 6px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                                                    <Mail size={9} /> Correos
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>

            </div>{/* end body split */}

            <style>{`.lm-order-card:hover{border-color:rgba(255,255,255,0.18)!important} @keyframes spin{to{transform:rotate(360deg)}} ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}`}</style>
        </div>
    );
}
