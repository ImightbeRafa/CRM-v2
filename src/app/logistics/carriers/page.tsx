'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Package, PackageCheck, Search, Truck, Mail, ArrowRight, RefreshCcw, ChevronDown, ChevronUp, Filter, CheckSquare, Square, Layers, Clock, PlusCircle, X, Archive, ArchiveRestore, Copy, CheckCircle2, FileText, Download } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';
import {
    costaRicaLocations,
    provinceNames,
    type ProvinceData,
    type CantonData,
} from '@/app/ventas/components/costaRicaLocations';

interface Order {
    id: string; orderId: string; tenantId: string; orderType: string; status: string; timestamp: string;
    customerName: string; phone: string | null; email: string | null; product: string | null;
    quantity: number | null; province: string | null; canton: string | null; district: string | null;
    address: string | null; total: number; comments: string | null; delivery: string | null;
    lmCarrier: string | null; lmStatus: string | null; isContraEntrega: boolean; contraEntregaCollected: boolean;
    archivedAt: string | null; correosShippingCost: number | null;
    guiaId: string | null; guiaNumber: string | null; trackingNumber: string | null;
    guiaStatus: string | null; guiaError: string | null; hasGuiaPdf: boolean;
}

interface VerifiedOrder {
    id: string;
    orderId: string;
    customerName: string;
    province: string;
    canton: string;
    district: string;
    address: string;
    deliveryType: 'Domicilio' | 'Sucursal' | 'Punto de correo';
    valid: boolean;
    originalProvince: string;
    originalCanton: string;
    originalDistrict: string;
    originalAddress: string;
}

interface ArchivedGuia {
    id: string;
    orderId: string;
    guiaNumber: string | null;
    trackingNumber?: string | null;
    status: string | null;
    orderStatus?: string | null;
    guiaStatus?: string | null;
    tenantName: string;
    customerName?: string;
    phone?: string;
    address?: string;
    province?: string;
    canton?: string;
    district?: string;
    total?: number | null;
    hasPdf: boolean;
    createdAt: string;
    updatedAt: string;
    archivedAt?: string | null;
    errorMessage?: string | null;
}

const STATUSES = ['Pendiente', 'En Proceso', 'Guía Creada', 'Impreso', 'En Tránsito', 'Entregado', 'Devuelto'];
const STATUS_CFG: Record<string, { color: string; glow: string }> = {
    'Pendiente': { color: '#94a3b8', glow: 'rgba(148,163,184,0.15)' },
    'En Proceso': { color: '#8b87ff', glow: 'rgba(139,135,255,0.15)' },
    'Guía Creada': { color: '#60a5fa', glow: 'rgba(96,165,250,0.15)' },
    'Impreso': { color: '#22d3ee', glow: 'rgba(34,211,238,0.15)' },
    'En Tránsito': { color: '#c084fc', glow: 'rgba(192,132,252,0.15)' },
    'Entregado': { color: '#34d399', glow: 'rgba(52,211,153,0.15)' },
    'Devuelto': { color: '#fbbf24', glow: 'rgba(251,191,36,0.15)' },
};
const LM_TO_CRM: Record<string, string> = {
    'Pendiente': 'Pendiente', 'En Proceso': 'En Proceso',
    'Guía Creada': 'Enviado', 'Impreso': 'Enviado', 'En Tránsito': 'Enviado', 'Entregado': 'Entregado', 'Devuelto': 'Devuelto',
};

const glass = {
    background: 'rgba(255,255,255,0.05)',
    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
    border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12,
} as const;

const compactOrderNameStyle = {
    color: '#F2F2F2',
    fontWeight: 600,
    margin: 0,
    lineHeight: 1.25,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
} as const;

const normalizeText = (value: string | undefined | null) => {
    const safeValue = (value ?? '').toString();
    return safeValue.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
};

const findProvince = (name: string): ProvinceData | undefined =>
    costaRicaLocations.find(p => normalizeText(p.nombre) === normalizeText(name));

const findCanton = (province: ProvinceData | undefined, name: string): CantonData | undefined =>
    province?.cantones.find(c => normalizeText(c.nombre) === normalizeText(name));

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
function orderMatchesColumnSearch(order: Order, query: string, getTenantName: (id: string) => string) {
    const needle = normalizeText(query);
    if (!needle) return true;
    const haystack = [
        order.customerName,
        order.orderId,
        order.phone,
        order.email,
        order.product,
        order.address,
        order.province,
        order.canton,
        order.district,
        order.comments,
        order.delivery,
        order.guiaNumber,
        order.trackingNumber,
        getTenantName(order.tenantId),
    ].map(normalizeText).join(' ');
    return haystack.includes(needle);
}

async function patchOrder(orderId: string, patch: object) {
    const res = await fetch('/api/logistics/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, ...patch }) });
    if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
}
async function terminateOrders(orderIds: string[], correosCosts?: Record<string, number>) {
    const body: any = { orderIds };
    if (correosCosts && Object.keys(correosCosts).length > 0) body.correosCosts = correosCosts;
    const res = await fetch('/api/logistics/orders/terminate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const details = Array.isArray(data.details) ? data.details.join('\n') : '';
        throw new Error(details || data.error || `Terminate failed: ${res.status}`);
    }
    return res.json();
}
async function restoreOrder(orderId: string) {
    const res = await fetch('/api/logistics/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId, archivedAt: null }) });
    if (!res.ok) throw new Error(`Restore failed: ${res.status}`);
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

// ─── Order age helper ────────────────────────────────────────────────────────
function orderAge(ts: string) {
    const h = Math.floor((Date.now() - new Date(ts).getTime()) / 3600000);
    if (h < 24) return null;
    const d = Math.floor(h / 24);
    return `${d}d`;
}

// ─── Order Card (kanban) ──────────────────────────────────────────────────────
function LocationRow({ order, onChange }: { order: VerifiedOrder; onChange: (updated: Partial<VerifiedOrder>) => void }) {
    const [cantonSearch, setCantonSearch] = useState(order.canton);
    const [districtSearch, setDistrictSearch] = useState(order.district);
    const [cantonOpen, setCantonOpen] = useState(false);
    const [districtOpen, setDistrictOpen] = useState(false);

    const province = useMemo(() => findProvince(order.province), [order.province]);
    const canton = useMemo(() => findCanton(province, order.canton), [province, order.canton]);

    const cantonResults = useMemo(() => {
        if (!province) return [];
        const search = normalizeText(cantonSearch);
        const list = province.cantones.map(c => ({ province: province.nombre, canton: c.nombre }));
        return (search ? list.filter(item => normalizeText(item.canton).includes(search)) : list).slice(0, 15);
    }, [cantonSearch, province]);

    const districtResults = useMemo(() => {
        if (!province || !canton) return [];
        const search = normalizeText(districtSearch);
        const list = canton.distritos.map(d => ({ province: province.nombre, canton: canton.nombre, district: d }));
        return (search ? list.filter(item => normalizeText(item.district).includes(search)) : list).slice(0, 15);
    }, [districtSearch, province, canton]);

    useEffect(() => { setCantonSearch(order.canton); }, [order.canton]);
    useEffect(() => { setDistrictSearch(order.district); }, [order.district]);

    const isValid = !!province && !!canton && canton.distritos.some(d => normalizeText(d) === normalizeText(order.district)) && !!order.address.trim();
    const hasChanges =
        order.province !== order.originalProvince ||
        order.canton !== order.originalCanton ||
        order.district !== order.originalDistrict ||
        order.address !== order.originalAddress;

    return (
        <div style={{ ...glass, padding: '14px 16px', marginBottom: 10, borderColor: isValid ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.35)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {isValid ? <CheckCircle2 size={14} style={{ color: '#34d399', flexShrink: 0 }} /> : <Clock size={14} style={{ color: '#fbbf24', flexShrink: 0 }} />}
                <span style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13 }}>{order.customerName}</span>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>#{order.orderId}</span>
                {hasChanges && <span style={{ marginLeft: 'auto', color: '#fbbf24', fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: 'rgba(251,191,36,0.12)' }}>Modificado</span>}
            </div>

            <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 10 }}>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Datos actuales</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5 }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}><strong style={{ color: 'rgba(255,255,255,0.25)' }}>Prov:</strong> {order.originalProvince || '-'}</span>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}><strong style={{ color: 'rgba(255,255,255,0.25)' }}>Canton:</strong> {order.originalCanton || '-'}</span>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}><strong style={{ color: 'rgba(255,255,255,0.25)' }}>Distrito:</strong> {order.originalDistrict || '-'}</span>
                </div>
                {order.originalAddress && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 3 }}><strong style={{ color: 'rgba(255,255,255,0.25)' }}>Dir:</strong> {order.originalAddress}</div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                    <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Provincia</label>
                    <select value={province?.nombre || order.province}
                        onChange={e => { const p = costaRicaLocations.find(pr => pr.nombre === e.target.value); onChange({ province: p?.nombre || e.target.value, canton: '', district: '' }); setCantonSearch(''); setDistrictSearch(''); }}
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: province ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(251,191,36,0.4)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12, outline: 'none' }}>
                        <option value="">Seleccione</option>
                        {provinceNames.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>

                <div style={{ position: 'relative' }}>
                    <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Canton</label>
                    <input value={cantonSearch} onChange={e => { setCantonSearch(e.target.value); setCantonOpen(true); }} onFocus={() => setCantonOpen(true)} onBlur={() => setTimeout(() => setCantonOpen(false), 150)} disabled={!province} placeholder={province ? 'Buscar canton' : 'Elige provincia'}
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: canton ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(251,191,36,0.4)', background: 'rgba(0,0,0,0.3)', color: province ? '#F2F2F2' : 'rgba(255,255,255,0.25)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                    {cantonOpen && cantonResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, maxHeight: 200, overflowY: 'auto', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#1a1a2e', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                            {cantonResults.map(r => (
                                <button key={`${r.province}-${r.canton}`} type="button" onMouseDown={e => { e.preventDefault(); onChange({ province: r.province, canton: r.canton, district: '' }); setCantonSearch(r.canton); setDistrictSearch(''); setCantonOpen(false); }}
                                    style={{ width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: 'transparent', color: '#F2F2F2', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    {r.canton}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ position: 'relative' }}>
                    <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Distrito</label>
                    <input value={districtSearch} onChange={e => { setDistrictSearch(e.target.value); setDistrictOpen(true); }} onFocus={() => setDistrictOpen(true)} onBlur={() => setTimeout(() => setDistrictOpen(false), 150)} disabled={!canton} placeholder={canton ? 'Buscar distrito' : 'Elige canton'}
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: isValid ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(251,191,36,0.4)', background: 'rgba(0,0,0,0.3)', color: canton ? '#F2F2F2' : 'rgba(255,255,255,0.25)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                    {districtOpen && districtResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, maxHeight: 200, overflowY: 'auto', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#1a1a2e', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                            {districtResults.map(r => (
                                <button key={`${r.province}-${r.canton}-${r.district}`} type="button" onMouseDown={e => { e.preventDefault(); onChange({ district: r.district }); setDistrictSearch(r.district); setDistrictOpen(false); }}
                                    style={{ width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: 'transparent', color: '#F2F2F2', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    {r.district}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Direccion exacta</label>
            <input value={order.address} onChange={e => onChange({ address: e.target.value })} placeholder="Senas exactas de direccion"
                style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: order.address.trim() ? '1px solid rgba(52,211,153,0.2)' : '1px solid rgba(251,191,36,0.3)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
        </div>
    );
}

function OrderCard({ order, onMoveStatus, onMoveCarrier, onToggleCOD, onToggleCollected, onArchive, carrier, getTenantName, getTenantColor, bulkMode, selected, onToggleSelect }: {
    order: Order; onMoveStatus: (id: string, s: string, c: string) => void; onMoveCarrier: (id: string, c: string) => void;
    onToggleCOD: (id: string, v: boolean) => void; onToggleCollected: (id: string, v: boolean) => void;
    onArchive: (id: string) => void;
    carrier: string; getTenantName: (id: string) => string; getTenantColor: (id: string) => string;
    bulkMode: boolean; selected: boolean; onToggleSelect: (id: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);
    const [syncing, setSyncing] = useState(false); const [synced, setSynced] = useState(false);
    const [copied, setCopied] = useState(false);
    const color = getTenantColor(order.tenantId);
    const idx = STATUSES.indexOf(order.lmStatus || 'Pendiente');
    const next = idx < STATUSES.length - 1 ? STATUSES[idx + 1] : null;
    const prev = idx > 0 ? STATUSES[idx - 1] : null;
    const other = carrier === 'mensajeria' ? 'correos' : 'mensajeria';
    const otherLabel = carrier === 'mensajeria' ? 'Correos' : 'Mensajería';
    const addr = [order.address, order.district, order.canton, order.province].filter(Boolean).join(', ');
    const age = orderAge(order.timestamp);
    const canArchive = order.lmStatus === 'Entregado' || order.lmStatus === 'Devuelto';
    const location = [order.province, order.canton].filter(Boolean).join(', ');
    const trackingCode = order.trackingNumber || order.guiaNumber;
    const detailRowStyle = { display: 'grid', gridTemplateColumns: '64px minmax(0, 1fr)', gap: 8, marginBottom: 5, alignItems: 'start' } as const;
    const detailLabelStyle = { color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' } as const;
    const detailValueStyle = { color: 'rgba(255,255,255,0.72)', minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.45 } as const;

    async function handleSync() { setSyncing(true); await syncCrm(order.id, order.lmStatus || 'Pendiente'); setSyncing(false); setSynced(true); setTimeout(() => setSynced(false), 2500); }
    function handleCopyPhone(e: React.MouseEvent) { e.stopPropagation(); if (order.phone) { navigator.clipboard.writeText(order.phone); setCopied(true); setTimeout(() => setCopied(false), 1500); } }

    return (
        <div
            onClick={bulkMode ? () => onToggleSelect(order.id) : undefined}
            aria-expanded={expanded}
            style={{
                background: selected ? 'rgba(139,135,255,0.1)' : (order.isContraEntrega && carrier === 'mensajeria') ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                border: selected ? '1px solid rgba(139,135,255,0.4)' : `1px solid ${(order.isContraEntrega && carrier === 'mensajeria') ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 10, marginBottom: 6, overflow: 'hidden', transition: 'border-color 0.15s', cursor: bulkMode ? 'pointer' : 'default',
            }} className="lm-order-card">
            {order.isContraEntrega && carrier === 'mensajeria' && (
                <div style={{ background: 'rgba(251,191,36,0.1)', padding: '4px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(251,191,36,0.15)' }}>
                    <span style={{ color: '#fbbf24', fontSize: 10, fontWeight: 700 }}>💵 CONTRA ENTREGA</span>
                    <button type="button" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onToggleCollected(order.id, !order.contraEntregaCollected); }}
                        style={{ padding: '2px 9px', borderRadius: 20, border: `1px solid ${order.contraEntregaCollected ? 'rgba(52,211,153,0.4)' : 'rgba(251,191,36,0.35)'}`, background: order.contraEntregaCollected ? 'rgba(52,211,153,0.12)' : 'transparent', color: order.contraEntregaCollected ? '#34d399' : '#fbbf24', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                        {order.contraEntregaCollected ? '✓ Cobrado' : '○ Pendiente cobro'}
                    </button>
                </div>
            )}
            <div style={{ padding: '10px 12px' }}>
                {/* Row 1: Name + badges */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                        {bulkMode && (
                            <div style={{ flexShrink: 0, color: selected ? '#8b87ff' : 'rgba(255,255,255,0.2)' }}>
                                {selected ? <CheckSquare size={13} /> : <Square size={13} />}
                            </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <p title={order.customerName} style={{ ...compactOrderNameStyle, fontSize: 12.5 }}>{order.customerName}</p>
                            <p style={{ color: 'rgba(255,255,255,0.3)', margin: '1px 0 0', fontSize: 10 }}>
                                #{order.orderId} · {new Date(order.timestamp).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}
                                {age && <span style={{ color: '#fbbf24', fontWeight: 600 }}> · {age}</span>}
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 5, flexShrink: 0, marginLeft: 6 }}>
                        <span style={{ padding: '1px 7px', borderRadius: 20, background: `${color}22`, color, fontSize: 9.5, fontWeight: 700 }}>{getTenantName(order.tenantId)}</span>
                        <button type="button" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setShowHistorial(!showHistorial); }} style={{ width: 24, height: 24, borderRadius: 6, background: showHistorial ? 'rgba(139,135,255,0.12)' : 'transparent', border: '1px solid transparent', color: showHistorial ? '#8b87ff' : 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Historial" aria-pressed={showHistorial}>
                            <Clock size={11} />
                        </button>
                        <button type="button" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setExpanded(prev => !prev); }} style={{ width: 26, height: 24, borderRadius: 6, border: `1px solid ${expanded ? 'rgba(139,135,255,0.35)' : 'transparent'}`, background: expanded ? 'rgba(139,135,255,0.12)' : 'rgba(255,255,255,0.04)', color: expanded ? '#8b87ff' : 'rgba(255,255,255,0.45)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={expanded ? 'Ocultar detalles' : 'Ver detalles'} aria-expanded={expanded} aria-label={expanded ? 'Ocultar detalles de la orden' : 'Ver detalles de la orden'}>
                            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                    </div>
                </div>
                {/* Row 2: Phone (always visible) + copy */}
                {order.phone && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>📞 {order.phone}</span>
                        <button type="button" onPointerDown={e => e.stopPropagation()} onClick={handleCopyPhone} style={{ background: 'none', border: 'none', color: copied ? '#34d399' : 'rgba(255,255,255,0.25)', cursor: 'pointer', padding: 1, display: 'flex', alignItems: 'center' }} title="Copiar teléfono">
                            {copied ? <CheckCircle2 size={10} /> : <Copy size={10} />}
                        </button>
                    </div>
                )}
                {/* Row 3: Location, product, total */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    {location && <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>📍 {location}</span>}
                    {order.product && <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{order.product}{order.quantity && order.quantity > 1 ? ` ×${order.quantity}` : ''}</span>}
                    {carrier === 'correos' && trackingCode && order.guiaStatus !== 'failed' && (
                        <span style={{ color: '#60a5fa', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 6, padding: '1px 6px', fontSize: 10.5, fontWeight: 700 }}>Guia {trackingCode}</span>
                    )}
                    {carrier === 'correos' && order.guiaStatus === 'failed' && (
                        <span title={order.guiaError || 'Error al generar guia'} style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '1px 6px', fontSize: 10.5, fontWeight: 700 }}>Guia fallida</span>
                    )}
                    <span style={{ color: '#34d399', fontWeight: 700, fontSize: 11, marginLeft: 'auto' }}>₡{order.total.toLocaleString('es-CR')}</span>
                </div>
                {showHistorial && <HistorialPanel orderId={order.id} />}
                {expanded && (
                    <div onClick={e => e.stopPropagation()} style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.25)', borderRadius: 8, marginBottom: 8, border: '1px solid rgba(255,255,255,0.08)', fontSize: 11, overflow: 'visible' }}>
                        {order.product && <div style={detailRowStyle}><span style={detailLabelStyle}>Producto</span><span style={detailValueStyle}>{order.product}{order.quantity ? ` × ${order.quantity}` : ''}</span></div>}
                        {addr && <div style={detailRowStyle}><span style={detailLabelStyle}>Dirección</span><span style={detailValueStyle}>{addr}</span></div>}
                        {order.delivery && <div style={detailRowStyle}><span style={detailLabelStyle}>Entrega</span><span style={detailValueStyle}>{order.delivery}</span></div>}
                        {order.comments && <div style={{ marginTop: 6, padding: '6px 9px', background: 'rgba(255,255,255,0.04)', borderRadius: 6, border: '1px solid rgba(255,255,255,0.07)' }}>
                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, margin: '0 0 2px', textTransform: 'uppercase' }}>Comentarios</p>
                            <p style={{ color: 'rgba(255,255,255,0.65)', margin: 0, fontSize: 11, lineHeight: 1.5, overflowWrap: 'anywhere' }}>{order.comments}</p>
                        </div>}
                        {carrier === 'mensajeria' && (
                            <button onClick={e => { e.stopPropagation(); onToggleCOD(order.id, !order.isContraEntrega); }} style={{ marginTop: 8, padding: '4px 10px', borderRadius: 6, border: `1px solid ${order.isContraEntrega ? 'rgba(251,191,36,0.4)' : 'rgba(255,255,255,0.12)'}`, background: order.isContraEntrega ? 'rgba(251,191,36,0.08)' : 'transparent', color: order.isContraEntrega ? '#fbbf24' : 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                                {order.isContraEntrega ? '💵 Quitar Contra Entrega' : '+ Marcar Contra Entrega'}
                            </button>
                        )}
                    </div>
                )}
                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {prev && <button onClick={e => { e.stopPropagation(); onMoveStatus(order.id, prev, carrier); }} style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 10, cursor: 'pointer' }}>← {prev.replace('En ', '')}</button>}
                    {next && <button onClick={e => { e.stopPropagation(); onMoveStatus(order.id, next, carrier); }} style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 10, cursor: 'pointer' }}>{next.replace('En ', '')} →</button>}
                    <button onClick={e => { e.stopPropagation(); onMoveCarrier(order.id, other); }} style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid rgba(139,135,255,0.3)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <ArrowRight size={9} /> {otherLabel}
                    </button>
                    <button onClick={e => { e.stopPropagation(); handleSync(); }} disabled={syncing} style={{ padding: '3px 7px', borderRadius: 5, border: `1px solid ${synced ? 'rgba(52,211,153,0.4)' : 'rgba(52,211,153,0.18)'}`, background: synced ? 'rgba(52,211,153,0.1)' : 'transparent', color: synced ? '#34d399' : 'rgba(255,255,255,0.35)', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }} title={`→ Betsy: ${LM_TO_CRM[order.lmStatus || 'Pendiente']}`}>
                        <RefreshCcw size={9} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} /> {synced ? '✓ Betsy' : '→ Betsy'}
                    </button>
                    {canArchive && (
                        <button onClick={e => { e.stopPropagation(); onArchive(order.id); }} style={{ padding: '3px 7px', borderRadius: 5, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.08)', color: '#34d399', fontSize: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Archive size={9} /> Terminar
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Kanban Board (single carrier) ───────────────────────────────────────────
function Board({ title, icon, carrier, orders, onMove, onMoveCarrier, onToggleCOD, onToggleCollected, onArchive, onArchiveStatus, accentColor, getTenantName, getTenantColor, bulkMode, selectedIds, onToggleSelect, onSetSelected, terminatingStatus }: {
    title: string; icon: React.ReactNode; carrier: string; orders: Order[]; accentColor: string;
    onMove: (id: string, s: string, c: string) => void; onMoveCarrier: (id: string, c: string) => void;
    onToggleCOD: (id: string, v: boolean) => void; onToggleCollected: (id: string, v: boolean) => void;
    onArchive: (id: string) => void;
    onArchiveStatus: (ids: string[], carrier: string, status: string) => void;
    getTenantName: (id: string) => string; getTenantColor: (id: string) => string;
    bulkMode: boolean; selectedIds: Set<string>; onToggleSelect: (id: string) => void;
    onSetSelected: (ids: string[], selected: boolean) => void;
    terminatingStatus: string | null;
}) {
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const panRef = useRef({
        active: false,
        pointerId: -1,
        startX: 0,
        scrollLeft: 0,
        moved: false,
    });
    const [isPanning, setIsPanning] = useState(false);
    const [columnSearch, setColumnSearch] = useState<Record<string, string>>({});
    const cols = STATUSES.map(s => {
        const statusOrders = orders.filter(o => (o.lmStatus || 'Pendiente') === s);
        const query = columnSearch[s] || '';
        const visibleOrders = statusOrders.filter(o => orderMatchesColumnSearch(o, query, getTenantName));
        return { status: s, orders: visibleOrders, total: statusOrders.length, query };
    });
    const isMens = carrier === 'mensajeria';
    const cod = isMens ? orders.filter(o => o.isContraEntrega).length : 0;
    const cobrado = isMens ? orders.filter(o => o.isContraEntrega && o.contraEntregaCollected).length : 0;

    const shouldIgnorePan = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return false;
        return !!target.closest('button, a, input, select, textarea, [role="button"], .lm-order-card');
    };

    const endPan = (pointerId?: number) => {
        const el = scrollRef.current;
        if (el && pointerId != null && el.hasPointerCapture(pointerId)) {
            el.releasePointerCapture(pointerId);
        }
        panRef.current.active = false;
        setIsPanning(false);
    };

    const handlePanStart = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || shouldIgnorePan(e.target)) return;
        const el = scrollRef.current;
        if (!el || el.scrollWidth <= el.clientWidth) return;
        panRef.current = {
            active: true,
            pointerId: e.pointerId,
            startX: e.clientX,
            scrollLeft: el.scrollLeft,
            moved: false,
        };
        el.setPointerCapture(e.pointerId);
        setIsPanning(true);
    };

    const handlePanMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const pan = panRef.current;
        const el = scrollRef.current;
        if (!pan.active || !el || pan.pointerId !== e.pointerId) return;
        const deltaX = e.clientX - pan.startX;
        if (Math.abs(deltaX) > 2) pan.moved = true;
        el.scrollLeft = pan.scrollLeft - deltaX;
        e.preventDefault();
    };

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
            <div
                ref={scrollRef}
                onPointerDown={handlePanStart}
                onPointerMove={handlePanMove}
                onPointerUp={e => endPan(e.pointerId)}
                onPointerCancel={e => endPan(e.pointerId)}
                className="lm-board-scroll"
                style={{
                display: 'flex', gap: 8, overflowX: 'auto', overflowY: 'hidden',
                padding: '10px', background: 'rgba(0,0,0,0.3)',
                backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                border: `1px solid ${accentColor}22`, borderRadius: '0 0 12px 12px',
                cursor: isPanning ? 'grabbing' : 'grab',
                userSelect: isPanning ? 'none' : 'auto',
                touchAction: 'pan-y',
            }}>
                {cols.map(({ status, orders: col, total, query }) => {
                    const sc = STATUS_CFG[status];
                    const isEntregado = status === 'Entregado';
                    const isTerminating = terminatingStatus === `${carrier}:${status}`;
                    const filtered = query.trim().length > 0 && col.length !== total;
                    const visibleIds = col.map(o => o.id);
                    const selectedInColumn = visibleIds.reduce((count, id) => count + (selectedIds.has(id) ? 1 : 0), 0);
                    const allVisibleSelected = visibleIds.length > 0 && selectedInColumn === visibleIds.length;
                    return (
                        <div key={status} style={{ minWidth: 270, flex: '0 0 270px', display: 'flex', flexDirection: 'column' }}>
                            {/* Column header */}
                            <div title="Arrastra para mover el tablero" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8, padding: '7px 10px', borderRadius: 7, background: sc.glow, border: `1px solid ${sc.color}45`, flexShrink: 0, cursor: isPanning ? 'grabbing' : 'grab', boxShadow: `inset 0 0 0 1px ${sc.color}10` }}>
                                <span style={{ color: sc.color, fontWeight: 600, fontSize: 11 }}>{status}</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                                    {bulkMode && (
                                        <button
                                            type="button"
                                            onClick={e => {
                                                e.stopPropagation();
                                                onSetSelected(visibleIds, !allVisibleSelected);
                                            }}
                                            disabled={visibleIds.length === 0}
                                            title={visibleIds.length === 0 ? 'No hay ordenes visibles' : allVisibleSelected ? `Quitar seleccion de ${visibleIds.length} orden(es)` : `Seleccionar ${visibleIds.length} orden(es) visibles`}
                                            aria-pressed={allVisibleSelected}
                                            style={{ height: 22, padding: '0 7px', borderRadius: 6, border: `1px solid ${selectedInColumn > 0 ? `${sc.color}75` : 'rgba(255,255,255,0.08)'}`, background: selectedInColumn > 0 ? `${sc.color}18` : 'rgba(255,255,255,0.03)', color: visibleIds.length > 0 ? sc.color : 'rgba(255,255,255,0.18)', fontSize: 9.5, fontWeight: 800, cursor: visibleIds.length > 0 ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4 }}
                                        >
                                            {allVisibleSelected ? <CheckSquare size={10} /> : <Square size={10} />}
                                            {selectedInColumn > 0 ? `${selectedInColumn}/${visibleIds.length}` : 'Todos'}
                                        </button>
                                    )}
                                    {isEntregado && (
                                        <button
                                            type="button"
                                            onClick={e => { e.stopPropagation(); onArchiveStatus(orders.filter(o => (o.lmStatus || 'Pendiente') === status).map(o => o.id), carrier, status); }}
                                            disabled={total === 0 || isTerminating}
                                            title={total === 0 ? 'No hay ordenes entregadas' : `Terminar ${total} orden(es) entregadas`}
                                            style={{ height: 22, padding: '0 7px', borderRadius: 6, border: `1px solid ${total > 0 ? 'rgba(52,211,153,0.4)' : 'rgba(255,255,255,0.08)'}`, background: total > 0 ? 'rgba(52,211,153,0.1)' : 'transparent', color: total > 0 ? '#34d399' : 'rgba(255,255,255,0.18)', fontSize: 9.5, fontWeight: 800, cursor: total > 0 && !isTerminating ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4 }}
                                        >
                                            <Archive size={10} /> {isTerminating ? '...' : 'Terminar'}
                                        </button>
                                    )}
                                    <span style={{ background: `${sc.color}30`, color: sc.color, padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>{filtered ? `${col.length}/${total}` : total}</span>
                                </div>
                            </div>
                            <div style={{ position: 'relative', marginBottom: 8, flexShrink: 0 }}>
                                <Search size={11} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: query ? sc.color : 'rgba(255,255,255,0.22)', pointerEvents: 'none' }} />
                                <input
                                    value={query}
                                    onChange={e => setColumnSearch(prev => ({ ...prev, [status]: e.target.value }))}
                                    placeholder="Buscar en columna..."
                                    aria-label={`Buscar ordenes en ${title} ${status}`}
                                    style={{ width: '100%', boxSizing: 'border-box', padding: '6px 26px 6px 27px', borderRadius: 7, border: `1px solid ${query ? `${sc.color}55` : 'rgba(255,255,255,0.08)'}`, background: query ? `${sc.color}10` : 'rgba(255,255,255,0.035)', color: '#F2F2F2', fontSize: 11, outline: 'none' }}
                                />
                                {query && (
                                    <button
                                        type="button"
                                        onClick={() => setColumnSearch(prev => ({ ...prev, [status]: '' }))}
                                        aria-label={`Limpiar busqueda de ${status}`}
                                        style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, borderRadius: 5, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    >
                                        <X size={11} />
                                    </button>
                                )}
                            </div>
                            {/* Scrollable cards */}
                            <div style={{ overflowY: 'auto', maxHeight: 520, paddingRight: 2 }}>
                                {col.map(o => (
                                    <OrderCard key={o.id} order={o} onMoveStatus={onMove} onMoveCarrier={onMoveCarrier}
                                        onToggleCOD={onToggleCOD} onToggleCollected={onToggleCollected} onArchive={onArchive} carrier={carrier}
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
    const [terminatingStatus, setTerminatingStatus] = useState<string | null>(null);
    const [showArchive, setShowArchive] = useState(false);
    const [archiveTab, setArchiveTab] = useState<'orders' | 'guias'>('orders');
    const [archivedOrders, setArchivedOrders] = useState<Order[]>([]);
    const [archivedGuias, setArchivedGuias] = useState<ArchivedGuia[]>([]);
    const [archiveLoading, setArchiveLoading] = useState(false);
    const [archiveGuiasLoading, setArchiveGuiasLoading] = useState(false);
    const [archiveSearch, setArchiveSearch] = useState('');
    const [showVerification, setShowVerification] = useState(false);
    const [verifiedOrders, setVerifiedOrders] = useState<VerifiedOrder[]>([]);
    const [deliveryType, setDeliveryType] = useState<'Domicilio' | 'Sucursal' | 'Punto de correo'>('Domicilio');
    const [generating, setGenerating] = useState(false);
    const [generationResults, setGenerationResults] = useState<any>(null);

    const load = useCallback(async () => {
        try {
            const p = new URLSearchParams({ limit: '2000' });
            if (search) p.set('search', search);
            const data = await (await fetch(`/api/logistics/orders?${p}`)).json();
            setOrders(data.orders || []);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [search]);

    useEffect(() => { load(); }, [load]);
    const buildVerifiedOrder = useCallback((order: Order): VerifiedOrder => {
        const prov = findProvince(order.province || '');
        const cant = findCanton(prov, order.canton || '');
        const dist = order.district || '';
        const addr = order.address || '';
        const valid = !!(prov && cant && cant.distritos.some(d => normalizeText(d) === normalizeText(dist)) && addr.trim());
        return {
            id: order.id,
            orderId: order.orderId,
            customerName: order.customerName || '',
            province: order.province || '',
            canton: order.canton || '',
            district: dist,
            address: addr,
            deliveryType,
            valid,
            originalProvince: order.province || '',
            originalCanton: order.canton || '',
            originalDistrict: order.district || '',
            originalAddress: addr,
        };
    }, [deliveryType]);

    const openCorreosVerification = useCallback((ids: string[]) => {
        const idSet = new Set(ids);
        const selectedOrders = orders.filter(o => idSet.has(o.id));
        if (selectedOrders.length === 0) return;
        setVerifiedOrders(selectedOrders.map(buildVerifiedOrder));
        setGenerationResults(null);
        setShowVerification(true);
    }, [orders, buildVerifiedOrder]);

    const updateVerifiedOrder = useCallback((idx: number, updates: Partial<VerifiedOrder>) => {
        setVerifiedOrders(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], ...updates };
            const prov = findProvince(next[idx].province);
            const cant = findCanton(prov, next[idx].canton);
            next[idx].valid = !!(prov && cant && cant.distritos.some(d => normalizeText(d) === normalizeText(next[idx].district)) && next[idx].address.trim());
            return next;
        });
    }, []);

    const allVerifiedValid = verifiedOrders.length > 0 && verifiedOrders.every(o => o.valid);

    const generateCorreosGuias = useCallback(async () => {
        setGenerating(true);
        setGenerationResults(null);
        try {
            const payload = {
                orders: verifiedOrders.map(o => ({
                    id: o.id,
                    orderId: o.orderId,
                    province: o.province,
                    canton: o.canton,
                    district: o.district,
                    address: o.address,
                    deliveryType: o.deliveryType,
                })),
            };
            const res = await fetch('/api/logistics/guias/generate-bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) {
                setGenerationResults({ error: data.error || 'Error generating guias' });
                return;
            }

            const results = data.data?.results || [];
            const byOrderId = new Map(results.map((r: any) => [String(r.orderId), r]));
            setOrders(prev => prev.map(order => {
                const submitted = verifiedOrders.find(o => o.id === order.id);
                if (!submitted) return order;
                const result: any = byOrderId.get(submitted.orderId);
                return {
                    ...order,
                    province: submitted.province,
                    canton: submitted.canton,
                    district: submitted.district,
                    address: submitted.address,
                    lmCarrier: 'correos',
                    lmStatus: result?.success ? 'Guía Creada' : 'Pendiente',
                    guiaNumber: result?.success ? result.guiaNumber : order.guiaNumber,
                    trackingNumber: result?.success ? result.trackingNumber || result.guiaNumber : order.trackingNumber,
                    guiaStatus: result?.success ? 'completed' : 'failed',
                    guiaError: result?.success ? null : result?.error || 'Error al generar guia',
                    hasGuiaPdf: result?.success ? true : order.hasGuiaPdf,
                };
            }));
            setGenerationResults(data.data);
            await load();
        } catch (e: any) {
            setGenerationResults({ error: e.message || 'Network error' });
        } finally {
            setGenerating(false);
        }
    }, [verifiedOrders, load]);

    const onMove = useCallback((id: string, s: string, c: string) => {
        const order = orders.find(o => o.id === id);
        if (s === 'Entregado' && order?.isContraEntrega && !order.contraEntregaCollected) {
            alert('No se puede marcar como Entregado hasta confirmar el pago contra entrega.');
            return;
        }
        setOrders(p => p.map(o => o.id === id ? { ...o, lmStatus: s, lmCarrier: c } : o));
        patchOrder(id, { lmCarrier: c, lmStatus: s }).catch((err) => {
            if (order) setOrders(p => p.map(o => o.id === id ? order : o));
            alert(err.message || 'No se pudo actualizar la orden.');
        });
        logEvent(id, 'status_change', { to: s });
    }, [orders]);
    const onMoveC = useCallback((id: string, c: string) => {
        if (c === 'correos') {
            openCorreosVerification([id]);
            return;
        }
        setOrders(p => p.map(o => o.id === id ? { ...o, lmCarrier: c, lmStatus: o.lmStatus || 'Pendiente' } : o));
        patchOrder(id, { lmCarrier: c });
        logEvent(id, 'carrier_assigned', { carrier: c });
    }, [openCorreosVerification]);
    const onAssign = useCallback((id: string, c: string) => {
        if (c === 'correos') {
            openCorreosVerification([id]);
            return;
        }
        setOrders(p => p.map(o => o.id === id ? { ...o, lmCarrier: c, lmStatus: 'Pendiente' } : o));
        patchOrder(id, { lmCarrier: c, lmStatus: 'Pendiente' });
        logEvent(id, 'carrier_assigned', { carrier: c });
    }, [openCorreosVerification]);
    const onCOD = useCallback((id: string, v: boolean) => { setOrders(p => p.map(o => o.id === id ? { ...o, isContraEntrega: v } : o)); patchOrder(id, { isContraEntrega: v }); }, []);
    const onColl = useCallback((id: string, v: boolean) => { setOrders(p => p.map(o => o.id === id ? { ...o, contraEntregaCollected: v } : o)); patchOrder(id, { contraEntregaCollected: v }); if (v) logEvent(id, 'ce_confirmed', {}); }, []);
    const onToggleSelect = useCallback((id: string) => { setSelectedIds(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; }); }, []);
    const onSetSelected = useCallback((ids: string[], selected: boolean) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => {
                if (selected) next.add(id);
                else next.delete(id);
            });
            return next;
        });
    }, []);
    const onArchiveOrder = useCallback(async (id: string) => {
        const order = orders.find(o => o.id === id);
        setOrders(p => p.filter(o => o.id !== id));
        try {
            await terminateOrders([id]);
        } catch (err: any) {
            if (order) setOrders(p => [...p, order]);
            alert(err.message || 'Error al terminar la orden. Por favor intente de nuevo.');
        }
    }, [orders]);
    const onArchiveStatus = useCallback(async (ids: string[], carrier: string, status: string) => {
        if (status !== 'Entregado' || ids.length === 0) return;
        const key = `${carrier}:${status}`;
        setTerminatingStatus(key);
        const idSet = new Set(ids);
        const removedOrders = orders.filter(o => idSet.has(o.id));
        setOrders(p => p.filter(o => !idSet.has(o.id)));
        try {
            await terminateOrders(ids);
            setSelectedIds(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });
        } catch (err: any) {
            setOrders(p => {
                const currentIds = new Set(p.map(o => o.id));
                return [...p, ...removedOrders.filter(o => !currentIds.has(o.id))];
            });
            alert(err.message || 'Error al terminar las ordenes entregadas. Por favor intente de nuevo.');
        } finally {
            setTerminatingStatus(null);
        }
    }, [orders]);
    const onRestoreOrder = useCallback(async (id: string) => {
        const restored = archivedOrders.find(o => o.id === id);
        if (restored) {
            setArchivedOrders(p => p.filter(o => o.id !== id));
            setOrders(p => [...p, { ...restored, archivedAt: null }]);
        }
        try {
            await restoreOrder(id);
            logEvent(id, 'restored', {});
        } catch {
            if (restored) {
                setOrders(p => p.filter(o => o.id !== id));
                setArchivedOrders(p => [...p, restored]);
            }
            alert('Error al restaurar la orden. Por favor intente de nuevo.');
        }
    }, [archivedOrders]);
    const loadArchived = useCallback(async () => {
        setArchiveLoading(true);
        try {
            const p = new URLSearchParams({ limit: '200', archived: 'true' });
            if (archiveSearch) p.set('search', archiveSearch);
            const data = await (await fetch(`/api/logistics/orders?${p}`)).json();
            setArchivedOrders(data.orders || []);
        } catch (e) { console.error(e); } finally { setArchiveLoading(false); }
    }, [archiveSearch]);
    const loadArchivedGuias = useCallback(async () => {
        setArchiveGuiasLoading(true);
        try {
            const p = new URLSearchParams({ carrier: 'correos_cr', archived: 'true', limit: '200' });
            if (archiveSearch) p.set('search', archiveSearch);
            const data = await (await fetch(`/api/logistics/guias/history?${p}`)).json();
            setArchivedGuias(data.guias || []);
        } catch (e) { console.error(e); } finally { setArchiveGuiasLoading(false); }
    }, [archiveSearch]);
    const loadArchiveContent = useCallback(() => {
        if (archiveTab === 'guias') loadArchivedGuias();
        else loadArchived();
    }, [archiveTab, loadArchived, loadArchivedGuias]);
    const bulkArchive = useCallback(async () => {
        const ids = [...selectedIds];
        if (!ids.length) return;
        setApplying(true);
        try {
            await terminateOrders(ids);
            const terminatedSet = new Set(ids);
            setOrders(p => p.filter(o => !terminatedSet.has(o.id)));
            setSelectedIds(new Set());
        } catch (err: any) {
            alert(err.message || 'Error al terminar las órdenes. Por favor intente de nuevo.');
        } finally { setApplying(false); }
    }, [selectedIds]);

    const applyBulk = useCallback(async () => {
        const ids = [...selectedIds];
        if (!ids.length || (!bulkStatus && !bulkCarrier)) return;
        if (bulkCarrier === 'correos') {
            openCorreosVerification(ids);
            setBulkStatus('');
            setBulkCarrier('');
            return;
        }
        setApplying(true);
        const patch: any = {};
        if (bulkStatus) patch.lmStatus = bulkStatus;
        if (bulkCarrier) patch.lmCarrier = bulkCarrier;
        if (bulkStatus === 'Entregado') {
            const blocked = orders.filter(o => selectedIds.has(o.id) && o.isContraEntrega && !o.contraEntregaCollected);
            if (blocked.length > 0) {
                alert(`${blocked.length} orden(es) contra entrega requieren pago confirmado antes de marcar Entregado.`);
                setApplying(false);
                return;
            }
        }
        const res = await fetch('/api/logistics/bulk-patch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: ids, patch }) });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'No se pudo aplicar la actualizacion masiva.');
            setApplying(false);
            return;
        }
        setOrders(p => p.map(o => selectedIds.has(o.id) ? { ...o, ...{ lmStatus: bulkStatus || o.lmStatus, lmCarrier: bulkCarrier || o.lmCarrier } } : o));
        setSelectedIds(new Set());
        setBulkStatus('');
        setBulkCarrier('');
        setApplying(false);
    }, [selectedIds, bulkStatus, bulkCarrier, openCorreosVerification, orders]);

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
    const selectedUnassigned = unassigned.filter(o => selectedIds.has(o.id));
    const selectedUnassignedCount = selectedUnassigned.length;
    const selectedUnassignedRetiros = selectedUnassigned.filter(o => o.orderType === 'RA');
    const selectedUnassignedRetirosCount = selectedUnassignedRetiros.length;
    const allVisibleUnassignedSelected = unassigned.length > 0 && selectedUnassignedCount === unassigned.length;
    const archiveBusy = archiveTab === 'guias' ? archiveGuiasLoading : archiveLoading;

    function toggleAllVisibleUnassigned() {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (allVisibleUnassignedSelected) {
                unassigned.forEach(o => next.delete(o.id));
            } else {
                unassigned.forEach(o => next.add(o.id));
            }
            return next;
        });
    }

    function assignSelectedUnassignedToCorreos() {
        const ids = selectedUnassigned.map(o => o.id);
        if (ids.length === 0) return;
        openCorreosVerification(ids);
    }

    async function assignSelectedUnassignedToRetiros() {
        const ids = selectedUnassignedRetiros.map(o => o.id);
        if (ids.length === 0) return;
        const previous = orders;
        setOrders(p => p.map(o => ids.includes(o.id) ? { ...o, lmCarrier: 'retiro', lmStatus: 'Pendiente' } : o));
        try {
            await Promise.all(ids.map(id => patchOrder(id, { lmCarrier: 'retiro', lmStatus: 'Pendiente' })));
            ids.forEach(id => logEvent(id, 'carrier_assigned', { carrier: 'retiro' }));
            setSelectedIds(prev => {
                const next = new Set(prev);
                ids.forEach(id => next.delete(id));
                return next;
            });
        } catch (err: any) {
            setOrders(previous);
            alert(err.message || 'No se pudieron asignar los retiros.');
        }
    }

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
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => { const opening = !showArchive; setShowArchive(opening); if (opening) loadArchiveContent(); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', borderRadius: 9, border: `1px solid ${showArchive ? 'rgba(52,211,153,0.5)' : 'rgba(255,255,255,0.1)'}`, background: showArchive ? 'rgba(52,211,153,0.12)' : 'transparent', color: showArchive ? '#34d399' : 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, transition: 'all 0.15s' }}>
                            <Archive size={13} /> Archivo {(archivedOrders.length > 0 || archivedGuias.length > 0) && <span style={{ background: 'rgba(52,211,153,0.2)', color: '#34d399', padding: '0 6px', borderRadius: 10, fontSize: 10 }}>{archiveTab === 'guias' ? archivedGuias.length : archivedOrders.length}</span>}
                        </button>
                        <button onClick={() => { setBulkMode(b => !b); setSelectedIds(new Set()); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', borderRadius: 9, border: `1px solid ${bulkMode ? 'rgba(139,135,255,0.5)' : 'rgba(255,255,255,0.1)'}`, background: bulkMode ? 'rgba(139,135,255,0.12)' : 'transparent', color: bulkMode ? '#8b87ff' : 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, transition: 'all 0.15s' }}>
                            <Layers size={13} /> {bulkMode ? 'Salir Selección' : 'Selección Múltiple'}
                        </button>
                    </div>
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
                        <button onClick={bulkArchive} disabled={applying}
                            style={{ padding: '5px 16px', borderRadius: 7, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.08)', color: '#34d399', cursor: 'pointer', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Archive size={11} /> Terminar
                        </button>
                        <button onClick={() => setSelectedIds(new Set())} style={{ marginLeft: 'auto', padding: '5px 10px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                            <X size={11} /> Limpiar
                        </button>
                    </div>
                )}
            </div>

            {/* ── Archive panel (collapsible) ────────────────────────────── */}
            {showArchive && (
                <div style={{ flexShrink: 0, marginBottom: 14, ...glass, padding: '14px 16px', maxHeight: 320, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {archiveTab === 'guias' ? <FileText size={14} style={{ color: '#60a5fa' }} /> : <Archive size={14} style={{ color: '#34d399' }} />}
                            <span style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13 }}>{archiveTab === 'guias' ? 'Guias Archivadas de Correos' : 'Ordenes Archivadas'}</span>
                            <span style={{ background: archiveTab === 'guias' ? 'rgba(96,165,250,0.15)' : 'rgba(52,211,153,0.15)', color: archiveTab === 'guias' ? '#60a5fa' : '#34d399', padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700 }}>{archiveTab === 'guias' ? archivedGuias.length : archivedOrders.length}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <div style={{ display: 'flex', gap: 4, padding: 2, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                <button onClick={() => { setArchiveTab('orders'); if (showArchive) loadArchived(); }}
                                    style={{ padding: '4px 9px', borderRadius: 6, border: 'none', background: archiveTab === 'orders' ? 'rgba(52,211,153,0.14)' : 'transparent', color: archiveTab === 'orders' ? '#34d399' : 'rgba(255,255,255,0.35)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>
                                    Ordenes
                                </button>
                                <button onClick={() => { setArchiveTab('guias'); loadArchivedGuias(); }}
                                    style={{ padding: '4px 9px', borderRadius: 6, border: 'none', background: archiveTab === 'guias' ? 'rgba(96,165,250,0.14)' : 'transparent', color: archiveTab === 'guias' ? '#60a5fa' : 'rgba(255,255,255,0.35)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}>
                                    Guias Correos
                                </button>
                            </div>
                            <div style={{ position: 'relative' }}>
                                <Search size={11} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.25)', pointerEvents: 'none' }} />
                                <input value={archiveSearch} onChange={e => setArchiveSearch(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && loadArchiveContent()}
                                    placeholder="Buscar en archivo..."
                                    style={{ padding: '5px 10px 5px 26px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 7, color: '#F2F2F2', fontSize: 11, outline: 'none', width: 180 }} />
                            </div>
                            <button onClick={loadArchiveContent} disabled={archiveBusy}
                                style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.08)', color: '#34d399', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                                {archiveBusy ? '...' : 'Buscar'}
                            </button>
                            <button onClick={() => setShowArchive(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}>
                                <X size={14} />
                            </button>
                        </div>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                        {archiveTab === 'guias' ? (
                            archiveGuiasLoading ? (
                                <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', margin: '20px 0' }}>Cargando guias archivadas...</p>
                            ) : archivedGuias.length === 0 ? (
                                <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, textAlign: 'center', margin: '20px 0' }}>No hay guias archivadas de Correos</p>
                            ) : (
                                <div style={{ display: 'grid', gap: 6 }}>
                                    {archivedGuias.map(g => {
                                        const address = [g.address, g.district, g.canton, g.province].filter(Boolean).join(', ');
                                        return (
                                            <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'rgba(96,165,250,0.04)', border: '1px solid rgba(96,165,250,0.12)', borderRadius: 8 }}>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                                                        <span style={{ color: '#60a5fa', fontWeight: 800, fontSize: 12 }}>{g.guiaNumber || g.trackingNumber || 'Sin numero'}</span>
                                                        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>Orden #{g.orderId}</span>
                                                        <span style={{ padding: '1px 6px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.45)', fontSize: 9, fontWeight: 700 }}>{g.tenantName}</span>
                                                        {g.archivedAt && <span style={{ color: 'rgba(255,255,255,0.24)', fontSize: 10 }}>Archivado {new Date(g.archivedAt).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}</span>}
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, minWidth: 0, flexWrap: 'wrap' }}>
                                                        <span style={{ color: '#F2F2F2', fontWeight: 600 }}>{g.customerName || 'Cliente sin nombre'}</span>
                                                        {g.phone && <span style={{ color: 'rgba(255,255,255,0.35)' }}>{g.phone}</span>}
                                                        <span style={{ color: 'rgba(255,255,255,0.35)' }}>{g.orderStatus || g.status || 'Sin estado'}</span>
                                                        {g.total != null && <span style={{ color: '#34d399', fontWeight: 700 }}>CRC {g.total.toLocaleString('es-CR')}</span>}
                                                    </div>
                                                    {address && <div style={{ color: 'rgba(255,255,255,0.28)', fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{address}</div>}
                                                    {g.errorMessage && <div style={{ color: 'rgba(239,68,68,0.75)', fontSize: 10.5, marginTop: 2 }}>{g.errorMessage}</div>}
                                                </div>
                                                {g.hasPdf ? (
                                                    <a href={`/api/logistics/guias/download/${g.id}`} target="_blank" rel="noopener noreferrer"
                                                        style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, textDecoration: 'none' }}>
                                                        <Download size={11} /> PDF
                                                    </a>
                                                ) : (
                                                    <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 11, flexShrink: 0 }}>Sin PDF</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )
                        ) : (
                            archiveLoading ? (
                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', margin: '20px 0' }}>Cargando archivo...</p>
                        ) : archivedOrders.length === 0 ? (
                            <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, textAlign: 'center', margin: '20px 0' }}>No hay órdenes archivadas</p>
                        ) : (
                            <div style={{ display: 'grid', gap: 6 }}>
                                {archivedOrders.map(o => {
                                    const tc = getTenantColor(o.tenantId);
                                    return (
                                        <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                                                    <span style={{ color: '#F2F2F2', fontWeight: 600, fontSize: 12 }}>{o.customerName}</span>
                                                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>#{o.orderId}</span>
                                                    <span style={{ padding: '1px 6px', borderRadius: 20, background: `${tc}20`, color: tc, fontSize: 9, fontWeight: 700 }}>{getTenantName(o.tenantId)}</span>
                                                    {o.lmCarrier === 'correos' && (o.guiaNumber || o.trackingNumber) && (
                                                        <span style={{ padding: '1px 6px', borderRadius: 20, background: 'rgba(96,165,250,0.12)', color: '#60a5fa', fontSize: 9, fontWeight: 800 }}>Guia {o.guiaNumber || o.trackingNumber}</span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                                                    <span style={{ color: 'rgba(255,255,255,0.35)' }}>{o.lmCarrier === 'mensajeria' ? '🚚 Mensajería' : o.lmCarrier === 'correos' ? '📮 Correos' : '—'}</span>
                                                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>{o.lmStatus}</span>
                                                    <span style={{ color: '#34d399', fontWeight: 700 }}>₡{o.total.toLocaleString('es-CR')}</span>
                                                    {o.archivedAt && <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>Archivado {new Date(o.archivedAt).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}</span>}
                                                </div>
                                            </div>
                                            {o.lmCarrier === 'correos' && o.guiaId && o.hasGuiaPdf && (
                                                <a href={`/api/logistics/guias/download/${o.guiaId}`} target="_blank" rel="noopener noreferrer"
                                                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, textDecoration: 'none' }}>
                                                    <Download size={11} /> PDF
                                                </a>
                                            )}
                                            <button onClick={() => onRestoreOrder(o.id)}
                                                style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(139,135,255,0.35)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                                <ArchiveRestore size={11} /> Restaurar
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                        )}
                    </div>
                </div>
            )}

            {/* ── Body: 2-column split ──────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 14, flex: 1, overflow: 'hidden', minHeight: 0 }}>

                {/* LEFT: Kanban boards (Mensajería + Correos stacked) */}
                <div style={{ flex: 1, overflowY: 'auto', minWidth: 0, paddingRight: 4 }}>
                    <Board title="Mensajería Privada" icon={<Truck size={17} />} carrier="mensajeria" orders={mensajeria}
                        onMove={onMove} onMoveCarrier={onMoveC} onToggleCOD={onCOD} onToggleCollected={onColl}
                        onArchive={onArchiveOrder} onArchiveStatus={onArchiveStatus}
                        accentColor="#8b87ff" getTenantName={getTenantName} getTenantColor={getTenantColor}
                        bulkMode={bulkMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} onSetSelected={onSetSelected} terminatingStatus={terminatingStatus} />
                    <Board title="Correos de Costa Rica" icon={<Mail size={17} />} carrier="correos" orders={correos}
                        onMove={onMove} onMoveCarrier={onMoveC} onToggleCOD={onCOD} onToggleCollected={onColl}
                        onArchive={onArchiveOrder} onArchiveStatus={onArchiveStatus}
                        accentColor="#60a5fa" getTenantName={getTenantName} getTenantColor={getTenantColor}
                        bulkMode={bulkMode} selectedIds={selectedIds} onToggleSelect={onToggleSelect} onSetSelected={onSetSelected} terminatingStatus={terminatingStatus} />
                </div>

                {/* RIGHT: Sin Asignar inbox */}
                <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
                        {unassigned.length > 0 && (
                            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                                <button onClick={toggleAllVisibleUnassigned}
                                    style={{ flex: 1, minWidth: 110, padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(251,191,36,0.28)', background: allVisibleUnassignedSelected ? 'rgba(251,191,36,0.14)' : 'rgba(255,255,255,0.04)', color: allVisibleUnassignedSelected ? '#fbbf24' : 'rgba(255,255,255,0.5)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                    {allVisibleUnassignedSelected ? <CheckSquare size={11} /> : <Square size={11} />}
                                    {allVisibleUnassignedSelected ? 'Deseleccionar' : 'Seleccionar todo'}
                                </button>
                                <button onClick={assignSelectedUnassignedToCorreos} disabled={selectedUnassignedCount === 0}
                                    style={{ flex: 1, minWidth: 110, padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.35)', background: selectedUnassignedCount > 0 ? 'rgba(96,165,250,0.12)' : 'transparent', color: selectedUnassignedCount > 0 ? '#60a5fa' : 'rgba(255,255,255,0.2)', fontSize: 10.5, fontWeight: 700, cursor: selectedUnassignedCount > 0 ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                    <Mail size={11} /> Correos {selectedUnassignedCount > 0 ? `(${selectedUnassignedCount})` : ''}
                                </button>
                                <button onClick={assignSelectedUnassignedToRetiros} disabled={selectedUnassignedRetirosCount === 0}
                                    style={{ flex: 1, minWidth: 110, padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.35)', background: selectedUnassignedRetirosCount > 0 ? 'rgba(34,197,94,0.12)' : 'transparent', color: selectedUnassignedRetirosCount > 0 ? '#22c55e' : 'rgba(255,255,255,0.2)', fontSize: 10.5, fontWeight: 700, cursor: selectedUnassignedRetirosCount > 0 ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                    <PackageCheck size={11} /> Retiros {selectedUnassignedRetirosCount > 0 ? `(${selectedUnassignedRetirosCount})` : ''}
                                </button>
                            </div>
                        )}
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
                                    const selected = selectedIds.has(o.id);
                                    return (
                                        <div key={o.id} style={{ background: selected ? 'rgba(96,165,250,0.1)' : 'rgba(255,255,255,0.04)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', border: selected ? '1px solid rgba(96,165,250,0.45)' : '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '10px 12px', marginBottom: 6, fontSize: 12 }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
                                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0, flex: 1 }}>
                                                    <button type="button" onClick={() => onToggleSelect(o.id)}
                                                        style={{ marginTop: 1, background: 'none', border: 'none', padding: 0, color: selected ? '#60a5fa' : 'rgba(255,255,255,0.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                                                        aria-label={selected ? 'Deseleccionar orden' : 'Seleccionar orden'}>
                                                        {selected ? <CheckSquare size={14} /> : <Square size={14} />}
                                                    </button>
                                                    <div style={{ minWidth: 0, flex: 1 }}>
                                                        <p title={o.customerName} style={{ ...compactOrderNameStyle, fontSize: 12 }}>{o.customerName}</p>
                                                        <p style={{ color: 'rgba(255,255,255,0.3)', margin: '1px 0 0', fontSize: 9.5 }}>#{o.orderId}</p>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                                                    <span style={{ padding: '1px 7px', borderRadius: 20, background: `${tc}20`, color: tc, fontSize: 9.5, fontWeight: 700 }}>{getTenantName(o.tenantId)}</span>
                                                </div>
                                            </div>
                                            {o.phone && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: '0 0 2px' }}>📞 {o.phone}</p>}
                                            {o.product && <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.product}{o.quantity && o.quantity > 1 ? ` ×${o.quantity}` : ''}</p>}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: o.comments ? 4 : 8 }}>
                                                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>📍 {o.canton || o.province || '—'}</span>
                                                <span style={{ color: '#34d399', fontWeight: 700, fontSize: 11 }}>₡{o.total.toLocaleString('es-CR')}</span>
                                            </div>
                                            {o.comments && <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, margin: '0 0 8px', fontStyle: 'italic' }}>&quot;{o.comments.slice(0, 55)}{o.comments.length > 55 ? '…' : ''}&quot;</p>}
                                            <div style={{ display: 'flex', gap: 5 }}>
                                                <button onClick={() => onAssign(o.id, 'mensajeria')} style={{ flex: 1, padding: '5px 6px', borderRadius: 6, border: '1px solid rgba(139,135,255,0.35)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                                                    <Truck size={9} /> Mensajería
                                                </button>
                                                <button onClick={() => onAssign(o.id, 'correos')} style={{ flex: 1, padding: '5px 6px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                                                    <Mail size={9} /> Correos
                                                </button>
                                                {o.orderType === 'RA' && (
                                                    <button onClick={() => onAssign(o.id, 'retiro')} style={{ flex: 1, padding: '5px 6px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.08)', color: '#22c55e', fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                                                        <PackageCheck size={9} /> Retiro
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>

            </div>{/* end body split */}

            {showVerification && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
                    onClick={e => { if (e.target === e.currentTarget && !generating) setShowVerification(false); }}>
                    <div style={{ width: '90%', maxWidth: 900, maxHeight: '90vh', overflowY: 'auto', background: '#12121a', borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', padding: '24px 28px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                            <div>
                                <h2 style={{ color: '#F2F2F2', fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Mail size={18} style={{ color: '#60a5fa' }} /> Verificar ubicacion para Correos
                                </h2>
                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '4px 0 0' }}>
                                    La guia se genera al confirmar. Si la orden ya tenia guia, esta nueva reemplaza la guia actual en el tablero e historial. {verifiedOrders.filter(o => o.valid).length}/{verifiedOrders.length} verificadas.
                                </p>
                            </div>
                            {!generating && (
                                <button onClick={() => setShowVerification(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4 }}>
                                    <X size={20} />
                                </button>
                            )}
                        </div>

                        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600 }}>Tipo de envio:</label>
                            <select value={deliveryType}
                                onChange={e => {
                                    const val = e.target.value as typeof deliveryType;
                                    setDeliveryType(val);
                                    setVerifiedOrders(prev => prev.map(o => ({ ...o, deliveryType: val })));
                                }}
                                style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12, outline: 'none' }}>
                                <option value="Domicilio">Domicilio</option>
                                <option value="Sucursal">Sucursal</option>
                                <option value="Punto de correo">Punto de correo</option>
                            </select>
                        </div>

                        <div style={{ maxHeight: 450, overflowY: 'auto', marginBottom: 16 }}>
                            {verifiedOrders.map((o, idx) => (
                                <LocationRow key={o.id} order={o} onChange={updates => updateVerifiedOrder(idx, updates)} />
                            ))}
                        </div>

                        {generationResults && (
                            <div style={{ marginBottom: 16, ...glass, padding: '14px 18px', borderColor: generationResults.error ? 'rgba(239,68,68,0.3)' : 'rgba(52,211,153,0.3)' }}>
                                {generationResults.error ? (
                                    <p style={{ color: '#ef4444', margin: 0, fontSize: 13 }}>{generationResults.error}</p>
                                ) : (
                                    <div>
                                        <p style={{ color: '#34d399', fontWeight: 700, fontSize: 14, margin: '0 0 8px' }}>
                                            {generationResults.successful} exitosa{generationResults.successful !== 1 ? 's' : ''}, {generationResults.failed} fallida{generationResults.failed !== 1 ? 's' : ''}
                                        </p>
                                        {generationResults.results?.map((r: any, i: number) => (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 12 }}>
                                                {r.success ? <CheckCircle2 size={12} style={{ color: '#34d399' }} /> : <Clock size={12} style={{ color: '#ef4444' }} />}
                                                <span style={{ color: '#F2F2F2' }}>{r.orderId}</span>
                                                {r.guiaNumber && <span style={{ color: '#60a5fa', fontWeight: 700 }}>#{r.guiaNumber}</span>}
                                                {r.error && <span style={{ color: 'rgba(239,68,68,0.7)' }}>- {r.error}</span>}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            {!generating && !generationResults && (
                                <button onClick={() => setShowVerification(false)}
                                    style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}>
                                    Cancelar
                                </button>
                            )}
                            {generationResults ? (
                                <button onClick={() => { setShowVerification(false); setSelectedIds(new Set()); }}
                                    style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.4)', background: 'rgba(96,165,250,0.12)', color: '#60a5fa', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                                    Listo
                                </button>
                            ) : (
                                <button onClick={generateCorreosGuias} disabled={!allVerifiedValid || generating}
                                    style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.5)', background: allVerifiedValid ? 'rgba(52,211,153,0.15)' : 'transparent', color: allVerifiedValid ? '#34d399' : 'rgba(255,255,255,0.2)', fontWeight: 700, fontSize: 13, cursor: allVerifiedValid ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 7, opacity: allVerifiedValid ? 1 : 0.5 }}>
                                    {generating ? <><RefreshCcw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Generando...</> : <><Mail size={13} /> Confirmar y generar ({verifiedOrders.length})</>}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <style>{`.lm-order-card:hover{border-color:rgba(255,255,255,0.18)!important}.lm-board-scroll{scrollbar-width:thin;scrollbar-color:rgba(139,135,255,0.55) rgba(255,255,255,0.08)}.lm-board-scroll::-webkit-scrollbar{height:10px}.lm-board-scroll::-webkit-scrollbar-track{background:rgba(255,255,255,0.08);border-radius:999px}.lm-board-scroll::-webkit-scrollbar-thumb{background:linear-gradient(90deg,rgba(139,135,255,0.7),rgba(96,165,250,0.7));border-radius:999px;border:2px solid rgba(0,0,0,0.3)}.lm-board-scroll::-webkit-scrollbar-thumb:hover{background:linear-gradient(90deg,rgba(139,135,255,0.95),rgba(96,165,250,0.95))}@keyframes spin{to{transform:rotate(360deg)}} ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}`}</style>
        </div>
    );
}
