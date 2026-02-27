'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Truck, Mail, Printer, CheckSquare, Square, Search, RefreshCw, Package, Zap, CheckCircle, AlertTriangle, X, Download, Clock, FileText } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';
import {
    costaRicaLocations,
    provinceNames,
    type ProvinceData,
    type CantonData,
} from '@/app/ventas/components/costaRicaLocations';

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 } as const;

const CARRIER_CFG = {
    mensajeria: { label: 'Mensajería Privada', color: '#8b87ff', Icon: Truck },
    correos: { label: 'Correos de Costa Rica', color: '#60a5fa', Icon: Mail },
} as const;

type CarrierKey = keyof typeof CARRIER_CFG;
type TabFilter = 'all' | CarrierKey;

// ─── Location helpers ─────────────────────────────────────
const normalizeText = (value: string | undefined | null) => {
    const safeValue = (value ?? '').toString();
    return safeValue.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
};
const findProvince = (name: string): ProvinceData | undefined =>
    costaRicaLocations.find(p => normalizeText(p.nombre) === normalizeText(name));
const findCanton = (province: ProvinceData | undefined, name: string): CantonData | undefined =>
    province?.cantones.find(c => normalizeText(c.nombre) === normalizeText(name));

interface VerifiedOrder {
    orderId: string; id: string; customerName: string;
    province: string; canton: string; district: string; address: string;
    deliveryType: 'Domicilio' | 'Sucursal' | 'Punto de correo'; valid: boolean;
    // Original values from DB (read-only reference)
    originalProvince: string; originalCanton: string; originalDistrict: string; originalAddress: string;
}

interface GuiaHistoryItem {
    id: string; orderId: string; guiaNumber: string; status: string;
    tenantName: string; hasPdf: boolean; createdAt: string; errorMessage?: string;
}

// ─── Location Row Component ───────────────────────────────
function LocationRow({ order, onChange }: { order: VerifiedOrder; onChange: (updated: Partial<VerifiedOrder>) => void }) {
    const [cantonSearch, setCantonSearch] = useState(order.canton);
    const [districtSearch, setDistrictSearch] = useState(order.district);
    const [cantonOpen, setCantonOpen] = useState(false);
    const [districtOpen, setDistrictOpen] = useState(false);

    const province = useMemo(() => findProvince(order.province), [order.province]);
    const canton = useMemo(() => findCanton(province, order.canton), [province, order.canton]);

    // Canton results: ALWAYS scoped to selected province
    const cantonResults = useMemo(() => {
        if (!province) return [];
        const s = normalizeText(cantonSearch);
        const list = province.cantones.map(c => ({ province: province.nombre, canton: c.nombre }));
        if (!s) return list.slice(0, 20);
        return list.filter(item => normalizeText(item.canton).includes(s)).slice(0, 15);
    }, [cantonSearch, province]);

    // District results: ALWAYS scoped to selected canton
    const districtResults = useMemo(() => {
        if (!canton || !province) return [];
        const s = normalizeText(districtSearch);
        const list = canton.distritos.map(d => ({ province: province.nombre, canton: canton.nombre, district: d }));
        if (!s) return list.slice(0, 20);
        return list.filter(item => normalizeText(item.district).includes(s)).slice(0, 15);
    }, [districtSearch, canton, province]);

    useEffect(() => { setCantonSearch(order.canton); }, [order.canton]);
    useEffect(() => { setDistrictSearch(order.district); }, [order.district]);

    const isValid = !!province && !!canton && canton.distritos.some(d => normalizeText(d) === normalizeText(order.district));
    const hasChanges = order.province !== order.originalProvince || order.canton !== order.originalCanton || order.district !== order.originalDistrict || order.address !== order.originalAddress;

    return (
        <div style={{ ...glass, padding: '14px 16px', marginBottom: 10, borderColor: isValid ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.35)' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                {isValid ? <CheckCircle size={14} style={{ color: '#34d399', flexShrink: 0 }} /> : <AlertTriangle size={14} style={{ color: '#fbbf24', flexShrink: 0 }} />}
                <span style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13 }}>{order.customerName}</span>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>#{order.orderId}</span>
                {hasChanges && <span style={{ marginLeft: 'auto', color: '#fbbf24', fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: 'rgba(251,191,36,0.12)' }}>Modificado</span>}
            </div>

            {/* Original values reference (read-only) */}
            <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 10 }}>
                <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4, letterSpacing: 0.5 }}>Datos guardados en sistema</div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5 }}>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}><strong style={{ color: 'rgba(255,255,255,0.25)' }}>Prov:</strong> {order.originalProvince || '—'}</span>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}><strong style={{ color: 'rgba(255,255,255,0.25)' }}>Cantón:</strong> {order.originalCanton || '—'}</span>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}><strong style={{ color: 'rgba(255,255,255,0.25)' }}>Distrito:</strong> {order.originalDistrict || '—'}</span>
                </div>
                {order.originalAddress && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 3 }}><strong style={{ color: 'rgba(255,255,255,0.25)' }}>Dir:</strong> {order.originalAddress}</div>}
            </div>

            {/* Editable fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                {/* Provincia */}
                <div>
                    <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Provincia</label>
                    <select value={province?.nombre || order.province}
                        onChange={e => { const p = costaRicaLocations.find(pr => pr.nombre === e.target.value); onChange({ province: p?.nombre || e.target.value, canton: '', district: '' }); setCantonSearch(''); setDistrictSearch(''); }}
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: province ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(251,191,36,0.4)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12, outline: 'none' }}>
                        <option value="">Seleccione</option>
                        {provinceNames.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>
                {/* Cantón — scoped to province */}
                <div style={{ position: 'relative' }}>
                    <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Cantón {!province && <span style={{ color: 'rgba(255,255,255,0.2)', fontWeight: 400, textTransform: 'none' }}>(elige provincia)</span>}</label>
                    <input value={cantonSearch} onChange={e => { setCantonSearch(e.target.value); setCantonOpen(true); }} onFocus={() => setCantonOpen(true)} onBlur={() => setTimeout(() => setCantonOpen(false), 150)} placeholder={province ? 'Buscar cantón' : 'Elige provincia primero'} disabled={!province}
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: canton ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(251,191,36,0.4)', background: 'rgba(0,0,0,0.3)', color: province ? '#F2F2F2' : 'rgba(255,255,255,0.2)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                    {cantonOpen && cantonResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, maxHeight: 200, overflowY: 'auto', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#1a1a2e', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                            {cantonResults.map(r => (
                                <button key={`${r.province}-${r.canton}`} type="button"
                                    onMouseDown={e => { e.preventDefault(); onChange({ province: r.province, canton: r.canton, district: '' }); setCantonSearch(r.canton); setDistrictSearch(''); setCantonOpen(false); }}
                                    style={{ width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: 'transparent', color: '#F2F2F2', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }} className="lm-table-row">
                                    <div style={{ fontWeight: 600 }}>{r.canton}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {/* Distrito — scoped to canton */}
                <div style={{ position: 'relative' }}>
                    <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Distrito {!canton && <span style={{ color: 'rgba(255,255,255,0.2)', fontWeight: 400, textTransform: 'none' }}>(elige cantón)</span>}</label>
                    <input value={districtSearch} onChange={e => { setDistrictSearch(e.target.value); setDistrictOpen(true); }} onFocus={() => setDistrictOpen(true)} onBlur={() => setTimeout(() => setDistrictOpen(false), 150)} placeholder={canton ? 'Buscar distrito' : 'Elige cantón primero'} disabled={!canton}
                        style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: (canton && canton.distritos.some(d => normalizeText(d) === normalizeText(order.district))) ? '1px solid rgba(52,211,153,0.3)' : '1px solid rgba(251,191,36,0.4)', background: 'rgba(0,0,0,0.3)', color: canton ? '#F2F2F2' : 'rgba(255,255,255,0.2)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                    {districtOpen && districtResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, maxHeight: 200, overflowY: 'auto', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: '#1a1a2e', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
                            {districtResults.map(r => (
                                <button key={`${r.province}-${r.canton}-${r.district}`} type="button"
                                    onMouseDown={e => { e.preventDefault(); onChange({ district: r.district }); setDistrictSearch(r.district); setDistrictOpen(false); }}
                                    style={{ width: '100%', textAlign: 'left', padding: '7px 10px', border: 'none', background: 'transparent', color: '#F2F2F2', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }} className="lm-table-row">
                                    <div style={{ fontWeight: 600 }}>{r.district}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
            {/* Dirección */}
            <div>
                <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Dirección exacta</label>
                <input value={order.address} onChange={e => onChange({ address: e.target.value })} placeholder="Señas exactas de dirección"
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: order.address.trim() ? '1px solid rgba(52,211,153,0.2)' : '1px solid rgba(251,191,36,0.3)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
            </div>
        </div>
    );
}

export default function GuiasPage() {
    const { tenants, getTenantName } = useTenantConfig();
    const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<TabFilter>('all');
    const [ceFilter, setCeFilter] = useState(false);
    const [tenantFilter, setTenantFilter] = useState('');
    const [printing, setPrinting] = useState(false);

    // Correos automation state
    const [showVerification, setShowVerification] = useState(false);
    const [verifiedOrders, setVerifiedOrders] = useState<VerifiedOrder[]>([]);
    const [deliveryType, setDeliveryType] = useState<'Domicilio' | 'Sucursal' | 'Punto de correo'>('Domicilio');
    const [generating, setGenerating] = useState(false);
    const [generationResults, setGenerationResults] = useState<any>(null);

    // History state
    const [showHistory, setShowHistory] = useState(false);
    const [history, setHistory] = useState<GuiaHistoryItem[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);

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

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const data = await (await fetch('/api/logistics/guias/history?carrier=correos_cr&limit=50')).json();
            setHistory(data.guias || []);
        } catch (e) { console.error(e); } finally { setHistoryLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const afterTab = tab === 'all' ? orders : orders.filter(o => o.lmCarrier === tab);
    const afterTenant = tenantFilter ? afterTab.filter(o => o.tenantId === tenantFilter) : afterTab;
    const visible = ceFilter ? afterTenant.filter(o => o.isContraEntrega) : afterTenant;
    const activeTenantIds = Array.from(new Set(orders.map(o => o.tenantId)));

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

    // ─── Correos automation functions ─────────────────────
    const selectedCorreosCount = orders.filter(o => selected.has(o.id) && o.lmCarrier === 'correos').length;

    function openVerification() {
        const correosSelected = orders.filter(o => selected.has(o.id) && o.lmCarrier === 'correos');
        if (correosSelected.length === 0) return;
        setVerifiedOrders(correosSelected.map(o => ({
            id: o.id, orderId: o.orderId, customerName: o.customerName || '',
            province: o.province || '', canton: o.canton || '', district: o.district || '',
            address: o.address || '', deliveryType, valid: false,
            originalProvince: o.province || '', originalCanton: o.canton || '',
            originalDistrict: o.district || '', originalAddress: o.address || '',
        })));
        setGenerationResults(null);
        setShowVerification(true);
    }

    function updateVerifiedOrder(idx: number, updates: Partial<VerifiedOrder>) {
        setVerifiedOrders(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], ...updates };
            const prov = findProvince(next[idx].province);
            const cant = findCanton(prov, next[idx].canton);
            next[idx].valid = !!(prov && cant && cant.distritos.some(d => normalizeText(d) === normalizeText(next[idx].district)) && next[idx].address.trim());
            return next;
        });
    }

    const allValid = verifiedOrders.length > 0 && verifiedOrders.every(o => o.valid);

    async function generateGuias() {
        setGenerating(true);
        setGenerationResults(null);
        try {
            const payload = {
                orders: verifiedOrders.map(o => ({
                    orderId: o.orderId, province: o.province, canton: o.canton,
                    district: o.district, address: o.address, deliveryType: o.deliveryType,
                })),
            };
            const res = await fetch('/api/logistics/guias/generate-bulk', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok) {
                setGenerationResults({ error: data.error || 'Error generating guías' });
            } else {
                setGenerationResults(data.data);
                load();
            }
        } catch (e: any) {
            setGenerationResults({ error: e.message || 'Network error' });
        } finally { setGenerating(false); }
    }

    const selectedOrders = orders.filter(o => selected.has(o.id));
    const fmt = (n: number) => `₡${(n || 0).toLocaleString('es-CR')}`;
    const mensajeriaCount = orders.filter(o => o.lmCarrier === 'mensajeria').length;
    const correosCount = orders.filter(o => o.lmCarrier === 'correos').length;
    const ceCount = orders.filter(o => o.isContraEntrega && o.lmCarrier === 'mensajeria').length;

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
                        <button onClick={() => setCeFilter(f => !f)}
                            style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${ceFilter ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.08)'}`, background: ceFilter ? 'rgba(251,191,36,0.14)' : 'transparent', color: ceFilter ? '#fbbf24' : 'rgba(255,255,255,0.35)', fontSize: 12.5, fontWeight: ceFilter ? 700 : 400, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                            💵 Contra Entrega
                            <span style={{ padding: '1px 6px', borderRadius: 20, background: ceFilter ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.06)', fontSize: 10.5 }}>{ceCount}</span>
                        </button>
                    </div>

                    {/* Tenant filter */}
                    <select value={tenantFilter} onChange={e => setTenantFilter(e.target.value)}
                        style={{ padding: '7px 12px', ...glass, color: tenantFilter ? '#F2F2F2' : 'rgba(255,255,255,0.35)', fontSize: 12, outline: 'none', cursor: 'pointer', minWidth: 130 }}>
                        <option value="">Todas las cuentas</option>
                        {activeTenantIds.map(id => (
                            <option key={id} value={id}>{getTenantName(id)}</option>
                        ))}
                    </select>

                    <button onClick={selectVisible} style={{ padding: '7px 12px', ...glass, color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 11.5, whiteSpace: 'nowrap' }}>Sel. vista</button>
                    <button onClick={clearVisible} style={{ padding: '7px 12px', ...glass, color: 'rgba(255,255,255,0.45)', cursor: 'pointer', fontSize: 11.5 }}>Limpiar</button>
                    <button onClick={load} style={{ padding: '7px 10px', ...glass, color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><RefreshCw size={13} /></button>

                    {/* Generar Correos — only when Correos orders are selected */}
                    {selectedCorreosCount > 0 && (
                        <button onClick={openVerification}
                            style={{ padding: '7px 20px', borderRadius: 9, border: '1px solid rgba(52,211,153,0.5)', background: 'rgba(52,211,153,0.12)', color: '#34d399', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.15s', whiteSpace: 'nowrap' }}>
                            <Zap size={13} />
                            Generar Correos ({selectedCorreosCount})
                        </button>
                    )}

                    {/* History */}
                    <button onClick={() => { setShowHistory(true); loadHistory(); }}
                        style={{ padding: '7px 12px', ...glass, color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                        <Clock size={12} /> Historial
                    </button>

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
                {/* ─── VERIFICATION MODAL ──────────────────── */}
                {showVerification && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
                        onClick={e => { if (e.target === e.currentTarget && !generating) setShowVerification(false); }}>
                        <div style={{ width: '90%', maxWidth: 900, maxHeight: '90vh', overflowY: 'auto', background: '#12121a', borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', padding: '24px 28px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <div>
                                    <h2 style={{ color: '#F2F2F2', fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Zap size={18} style={{ color: '#34d399' }} /> Verificar Ubicaciones — Correos CR
                                    </h2>
                                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '4px 0 0' }}>
                                        Verifica provincia, cantón y distrito antes de generar. {verifiedOrders.filter(o => o.valid).length}/{verifiedOrders.length} verificadas.
                                    </p>
                                </div>
                                {!generating && (
                                    <button onClick={() => setShowVerification(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4 }}>
                                        <X size={20} />
                                    </button>
                                )}
                            </div>

                            {/* Delivery type selector */}
                            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600 }}>Tipo de envío:</label>
                                <select value={deliveryType}
                                    onChange={e => { const val = e.target.value as typeof deliveryType; setDeliveryType(val); setVerifiedOrders(prev => prev.map(o => ({ ...o, deliveryType: val }))); }}
                                    style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12, outline: 'none' }}>
                                    <option value="Domicilio">Domicilio</option>
                                    <option value="Sucursal">Sucursal</option>
                                    <option value="Punto de correo">Punto de correo</option>
                                </select>
                            </div>

                            {/* Order verification rows */}
                            <div style={{ maxHeight: 450, overflowY: 'auto', marginBottom: 16 }}>
                                {verifiedOrders.map((o, idx) => (
                                    <LocationRow key={o.id} order={o} onChange={updates => updateVerifiedOrder(idx, updates)} />
                                ))}
                            </div>

                            {/* Generation results */}
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
                                                    {r.success ? <CheckCircle size={12} style={{ color: '#34d399' }} /> : <AlertTriangle size={12} style={{ color: '#ef4444' }} />}
                                                    <span style={{ color: '#F2F2F2' }}>{r.orderId}</span>
                                                    {r.guiaNumber && <span style={{ color: '#60a5fa', fontWeight: 700 }}>#{r.guiaNumber}</span>}
                                                    {r.error && <span style={{ color: 'rgba(239,68,68,0.7)' }}>— {r.error}</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Action buttons */}
                            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                                {!generating && !generationResults && (
                                    <button onClick={() => setShowVerification(false)}
                                        style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}>
                                        Cancelar
                                    </button>
                                )}
                                {generationResults ? (
                                    <button onClick={() => { setShowVerification(false); setSelected(new Set()); setShowHistory(true); loadHistory(); }}
                                        style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.4)', background: 'rgba(96,165,250,0.12)', color: '#60a5fa', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                                        Ver Historial
                                    </button>
                                ) : (
                                    <button onClick={generateGuias} disabled={!allValid || generating}
                                        style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.5)', background: allValid ? 'rgba(52,211,153,0.15)' : 'transparent', color: allValid ? '#34d399' : 'rgba(255,255,255,0.2)', fontWeight: 700, fontSize: 13, cursor: allValid ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 7, opacity: allValid ? 1 : 0.5 }}>
                                        {generating ? <><RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Generando...</> : <><Zap size={13} /> Confirmar y Generar ({verifiedOrders.length})</>}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* ─── HISTORY MODAL ──────────────────────────── */}
                {showHistory && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
                        onClick={e => { if (e.target === e.currentTarget) setShowHistory(false); }}>
                        <div style={{ width: '90%', maxWidth: 900, maxHeight: '90vh', overflowY: 'auto', background: '#12121a', borderRadius: 16, border: '1px solid rgba(255,255,255,0.1)', padding: '24px 28px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                <h2 style={{ color: '#F2F2F2', fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <FileText size={18} style={{ color: '#60a5fa' }} /> Historial de Guías — Correos CR
                                </h2>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <button onClick={loadHistory} style={{ padding: '6px 10px', ...glass, color: 'rgba(255,255,255,0.4)', cursor: 'pointer' }}><RefreshCw size={12} /></button>
                                    <button onClick={() => setShowHistory(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
                                </div>
                            </div>
                            {historyLoading ? (
                                <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.2)' }}><Clock size={20} style={{ display: 'block', margin: '0 auto 8px', opacity: 0.3 }} />Cargando...</div>
                            ) : history.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.2)' }}>No hay guías generadas aún</div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                            {['Orden', 'Cuenta', '# Guía', 'Estado', 'Fecha', 'PDF'].map(h => (
                                                <th key={h} style={{ padding: '9px 11px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map((g, idx) => (
                                            <tr key={g.id} style={{ borderBottom: idx < history.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
                                                <td style={{ padding: '9px 11px', color: '#F2F2F2', fontWeight: 600 }}>{g.orderId}</td>
                                                <td style={{ padding: '9px 11px', color: 'rgba(255,255,255,0.45)', fontSize: 11 }}>{g.tenantName}</td>
                                                <td style={{ padding: '9px 11px', color: '#60a5fa', fontWeight: 700, fontSize: 13 }}>{g.guiaNumber || '—'}</td>
                                                <td style={{ padding: '9px 11px' }}>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 600,
                                                        background: g.status === 'completed' ? 'rgba(52,211,153,0.12)' : g.status === 'failed' ? 'rgba(239,68,68,0.12)' : 'rgba(251,191,36,0.12)',
                                                        color: g.status === 'completed' ? '#34d399' : g.status === 'failed' ? '#ef4444' : '#fbbf24',
                                                    }}>
                                                        {g.status === 'completed' ? 'Completada' : g.status === 'failed' ? 'Fallida' : g.status}
                                                    </span>
                                                    {g.errorMessage && <div style={{ color: 'rgba(239,68,68,0.7)', fontSize: 10, marginTop: 2 }}>{g.errorMessage}</div>}
                                                </td>
                                                <td style={{ padding: '9px 11px', color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{new Date(g.createdAt).toLocaleString('es-CR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                                                <td style={{ padding: '9px 11px' }}>
                                                    {g.hasPdf ? (
                                                        <a href={`/api/logistics/guias/download/${g.id}`} target="_blank" rel="noopener noreferrer"
                                                            style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', fontSize: 11, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                            <Download size={11} /> PDF
                                                        </a>
                                                    ) : (
                                                        <span style={{ color: 'rgba(255,255,255,0.15)', fontSize: 11 }}>—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── PRINTABLE GUÍAS (2-up compact) ────────────────────────── */}
            <div className="print-only" style={{ display: 'none' }}>
                <div className="guia-grid">
                    {selectedOrders.map(o => {
                        const isMens = o.lmCarrier === 'mensajeria';
                        const addr = [o.address, o.district, o.canton, o.province].filter(Boolean).join(', ');
                        return (
                            <div key={o.id} className="guia-ticket">
                                <div style={{ background: isMens ? '#3730a3' : '#1e40af', color: '#fff', padding: '5px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontWeight: 900, fontSize: 10, letterSpacing: 0.3 }}>
                                        {isMens ? '🚚 MENSAJERÍA' : '📮 CORREOS CR'}
                                    </span>
                                    <span style={{ fontSize: 9, opacity: 0.85 }}>{getTenantName(o.tenantId)}</span>
                                </div>
                                <div style={{ padding: '8px 10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, paddingBottom: 5, borderBottom: '1px solid #ddd' }}>
                                        <div>
                                            <div style={{ fontSize: 7, color: '#888', textTransform: 'uppercase', fontWeight: 700 }}>Ref</div>
                                            <div style={{ fontWeight: 900, fontSize: 13, letterSpacing: 0.5 }}>{o.orderId}</div>
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
                                        <div style={{ fontSize: 10 }}>{o.product || 'Paquete'}</div>
                                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 1 }}>
                                            {o.quantity > 1 && <span style={{ fontSize: 9, color: '#444' }}>Cant: {o.quantity}</span>}
                                            {o.color && <span style={{ fontSize: 9, color: '#444' }}>Color: {o.color}</span>}
                                            {o.size && <span style={{ fontSize: 9, color: '#444' }}>Talla: {o.size}</span>}
                                        </div>
                                        {o.comments && <div style={{ fontSize: 8, color: '#666', fontStyle: 'italic', marginTop: 1 }}>Nota: {o.comments}</div>}
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
                                            <div style={{ fontSize: 7, color: '#888' }}>Valor declarado</div>
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
                    .no-print  { display: none !important; }
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
