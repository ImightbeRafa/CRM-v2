'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Package, TrendingUp, Truck, Mail, FileDown, CheckCircle, Calendar, DollarSign, PlusCircle, Trash2, AlertCircle, Wallet, Save, RefreshCw } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

interface Rates { mensajeria_rate: number; correos_rate: number; handling_rate: number; salary_daily_rate: number; }

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;
const glassHi = { background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14 } as const;
const fmt = (n: number) => `₡${n.toLocaleString('es-CR')}`;

type Tab = 'resumen' | 'correos-cr' | 'contra-entregas' | 'dias-trabajados' | 'gd-balance';
type StaffName = 'Ma' | 'Lau';
type WorkDayType = 'off' | 'full' | 'short' | 'custom';

const STAFF_OPTIONS: StaffName[] = ['Ma', 'Lau'];
const CR_TZ = 'America/Costa_Rica';
const HOURLY_RATE = 1250;
const HOURS_PER_FULL_DAY = 8;
const toDateKeyCR = (date = new Date()) => date.toLocaleDateString('en-CA', { timeZone: CR_TZ });
const startOfMonthKey = (key: string) => `${key.slice(0, 7)}-01`;
const WORK_DAY_OPTIONS: Record<WorkDayType, { label: string; hours: number; units: number; amount: number; color: string }> = {
    off: { label: 'Libre', hours: 0, units: 0, amount: 0, color: 'rgba(255,255,255,0.35)' },
    full: { label: 'FULL', hours: 8, units: 1, amount: 10000, color: '#34d399' },
    short: { label: '2 horas', hours: 2, units: 0.25, amount: 2500, color: '#60a5fa' },
    custom: { label: 'Horas', hours: 0, units: 0, amount: 0, color: '#fbbf24' },
};
const START_TIME_OPTIONS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '12:00', '13:00', '17:00', '17:30', '18:00'];
const WEEK_DAYS = [
    { key: 0, label: 'Lunes', short: 'Lun' },
    { key: 1, label: 'Martes', short: 'Mar' },
    { key: 2, label: 'Miercoles', short: 'Mie' },
    { key: 3, label: 'Jueves', short: 'Jue' },
    { key: 4, label: 'Viernes', short: 'Vie' },
    { key: 5, label: 'Sabado', short: 'Sab' },
];
const BASE_SCHEDULE: Record<StaffName, Record<number, { dayType: WorkDayType; hours: number; startTime: string; notes?: string }>> = {
    Ma: {
        1: { dayType: 'full', hours: 8, startTime: '09:00' },
        2: { dayType: 'full', hours: 8, startTime: '09:00' },
        4: { dayType: 'full', hours: 8, startTime: '09:00' },
    },
    Lau: {
        0: { dayType: 'full', hours: 8, startTime: '10:00' },
        1: { dayType: 'short', hours: 2, startTime: '18:00' },
        2: { dayType: 'short', hours: 2, startTime: '18:00' },
        3: { dayType: 'full', hours: 8, startTime: '10:00' },
        4: { dayType: 'short', hours: 2, startTime: '18:00' },
        5: { dayType: 'full', hours: 8, startTime: '10:00' },
    },
};

// ─── Resumen Tab ──────────────────────────────────────────────────────────────
function ResumenTab({ rates }: { rates: Rates }) {
    const { tenants, getTenantName, getTenantColor } = useTenantConfig();
    const [loading, setLoading] = useState(true);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    interface Row { tenantId: string; tenantName: string; total: number; mensajeria: number; correos: number; unassigned: number; mensajeriaCost: number; correosCost: number; handling: number; contraEntrega: number; }
    const [rows, setRows] = useState<Row[]>([]);
    const [totals, setTotals] = useState({ orders: 0, mensajeria: 0, correos: 0, unassigned: 0, mensajeriaCost: 0, correosCost: 0, handling: 0, pendingCorreosCost: 0 });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams({ limit: '1000' });
            if (dateFrom) p.set('dateFrom', new Date(dateFrom).toISOString());
            if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59); p.set('dateTo', d.toISOString()); }
            const orders = ((await (await fetch(`/api/logistics/orders?${p}`)).json()).orders) || [];
            // Only count orders that have reached Entregado status
            const entregados = orders.filter((o: any) => o.lmStatus === 'Entregado');
            const byTenant: Record<string, Row> = {};
            for (const o of entregados) {
                if (!byTenant[o.tenantId]) byTenant[o.tenantId] = { tenantId: o.tenantId, tenantName: getTenantName(o.tenantId), total: 0, mensajeria: 0, correos: 0, unassigned: 0, mensajeriaCost: 0, correosCost: 0, handling: 0, contraEntrega: 0 };
                const row = byTenant[o.tenantId];
                row.total++;
                if (o.lmCarrier === 'mensajeria') { row.mensajeria++; row.mensajeriaCost += rates.mensajeria_rate; row.handling += rates.handling_rate; }
                else if (o.lmCarrier === 'correos') { row.correos++; row.correosCost += (o.correosShippingCost != null ? Number(o.correosShippingCost) : 0); row.handling += rates.handling_rate; }
                else { row.unassigned++; }
                if (o.isContraEntrega) row.contraEntrega++;
            }
            const rowList = Object.values(byTenant).sort((a, b) => b.total - a.total);
            setRows(rowList);
            const pendingCorreosCost = entregados.filter((o: any) => o.lmCarrier === 'correos' && o.correosShippingCost == null).length;
            setTotals({ orders: entregados.length, mensajeria: rowList.reduce((s, r) => s + r.mensajeria, 0), correos: rowList.reduce((s, r) => s + r.correos, 0), unassigned: rowList.reduce((s, r) => s + r.unassigned, 0), mensajeriaCost: rowList.reduce((s, r) => s + r.mensajeriaCost, 0), correosCost: rowList.reduce((s, r) => s + r.correosCost, 0), handling: rowList.reduce((s, r) => s + r.handling, 0), pendingCorreosCost });
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [dateFrom, dateTo, rates, tenants]);

    useEffect(() => { load(); }, [load]);

    function exportCSV() {
        const h = ['Cuenta', 'Total', 'Mensajería', 'Correos', 'Sin Asignar', 'CE', 'Costo Envío', 'Manejo', 'Total'];
        const data = rows.map(r => [r.tenantName, r.total, r.mensajeria, r.correos, r.unassigned, r.contraEntrega, r.mensajeriaCost + r.correosCost, r.handling, r.mensajeriaCost + r.correosCost + r.handling]);
        const csv = [h, ...data].map(r => r.join(',')).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `contabilidad_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    }

    const totalShipping = totals.mensajeriaCost + totals.correosCost;
    const grand = totalShipping + totals.handling;
    const pct = totals.mensajeria + totals.correos > 0 ? Math.round(totals.mensajeria / (totals.mensajeria + totals.correos) * 100) : 50;

    return (
        <div>
            {/* Date Range Filter */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
                <Calendar size={14} style={{ color: 'rgba(255,255,255,0.3)' }} />
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    style={{ padding: '7px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>→</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    style={{ padding: '7px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                <button onClick={load} style={{ padding: '7px 16px', ...glass, color: '#8b87ff', cursor: 'pointer', fontSize: 13, borderColor: 'rgba(139,135,255,0.2)' }}>
                    Aplicar
                </button>
                {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} style={{ padding: '7px 12px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12 }}>✕ Limpiar</button>}
                <button onClick={exportCSV} style={{ marginLeft: 'auto', ...glass, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 16px', color: '#8b87ff', cursor: 'pointer', fontSize: 13 }}>
                    <FileDown size={13} /> Exportar CSV
                </button>
            </div>

            {loading ? <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)' }}>Cargando...</div> : (
                <>
                    {/* Entregado-only notice */}
                    <div style={{ ...glass, padding: '10px 18px', marginBottom: 12, borderColor: 'rgba(96,165,250,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Mail size={13} style={{ color: '#60a5fa', flexShrink: 0 }} />
                        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>Solo se reflejan órdenes con estado <strong style={{ color: '#34d399' }}>Entregado</strong>. Los costos se contabilizan únicamente al completar la entrega.</p>
                    </div>

                    {/* Warning: Correos orders missing shipping cost */}
                    {totals.pendingCorreosCost > 0 && (
                        <div style={{ padding: '12px 18px', marginBottom: 14, borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.35)', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <AlertCircle size={16} style={{ color: '#fbbf24', flexShrink: 0 }} />
                            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>
                                <strong style={{ color: '#fbbf24' }}>{totals.pendingCorreosCost}</strong> {totals.pendingCorreosCost === 1 ? 'orden de Correos CR sin' : 'órdenes de Correos CR sin'} costo de envío asignado. Ingrese los montos en la pestaña <strong style={{ color: '#60a5fa' }}>Correos de Costa Rica</strong> para que los totales sean correctos.
                            </p>
                        </div>
                    )}

                    {/* KPI Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
                        {[{ label: 'Total Paquetes', value: totals.orders, color: '#8b87ff', icon: <Package size={17} /> },
                        { label: 'Mensajería', value: `${totals.mensajeria} paq`, color: '#8b87ff', icon: <Truck size={17} /> },
                        { label: 'Correos CR', value: `${totals.correos} paq`, color: '#60a5fa', icon: <Mail size={17} /> },
                        { label: 'Gran Total Costos', value: fmt(grand), color: '#34d399', icon: <TrendingUp size={17} /> },
                        ].map(({ label, value, color, icon }) => (
                            <div key={label} style={{ ...glassHi, padding: '18px 20px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10.5, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                                    <div style={{ color, opacity: 0.7 }}>{icon}</div>
                                </div>
                                <p style={{ color, fontSize: 22, fontWeight: 700, margin: 0 }}>{value}</p>
                            </div>
                        ))}
                    </div>

                    {/* Cost breakdown */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 22 }}>
                        {[{ label: 'Costo Mensajería', value: totals.mensajeriaCost, color: '#8b87ff', note: `${totals.mensajeria} × ${fmt(rates.mensajeria_rate)}` },
                        { label: 'Costo Correos', value: totals.correosCost, color: '#60a5fa', note: `${totals.correos} paq (costo individual)` },
                        { label: 'Total Manejo', value: totals.handling, color: '#34d399', note: `${totals.mensajeria + totals.correos} × ${fmt(rates.handling_rate)}` },
                        ].map(({ label, value, color, note }) => (
                            <div key={label} style={{ ...glass, padding: '14px 18px', borderColor: `${color}20` }}>
                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10.5, margin: '0 0 8px', textTransform: 'uppercase' }}>{label}</p>
                                <p style={{ color, fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>{fmt(value)}</p>
                                <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: 0 }}>{note}</p>
                            </div>
                        ))}
                    </div>

                    {/* Carrier bar */}
                    <div style={{ ...glass, padding: '18px 20px', marginBottom: 22 }}>
                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>Distribución por Carrier</p>
                        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 24, marginBottom: 8 }}>
                            <div style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#6c3fff,#8b87ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white', transition: 'width 0.6s' }}>
                                {totals.mensajeria > 0 && `Mensajería ${pct}%`}
                            </div>
                            <div style={{ flex: 1, background: 'linear-gradient(90deg,#3b82f6,#60a5fa)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'white' }}>
                                {totals.correos > 0 && `Correos ${100 - pct}%`}
                            </div>
                        </div>
                        {totals.unassigned > 0 && <p style={{ color: '#fbbf24', fontSize: 12, margin: 0 }}>⚠ {totals.unassigned} sin carrier</p>}
                    </div>

                    {/* Per-tenant table */}
                    <div style={{ ...glass, overflow: 'hidden' }}>
                        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between' }}>
                            <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 14, margin: 0 }}>Desglose por Cuenta</p>
                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, margin: 0 }}>Gran Total: <strong style={{ color: '#34d399' }}>{fmt(grand)}</strong></p>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    {['Cuenta', 'Total', 'Mensajería', 'Correos', 'Sin Asig.', 'C.E.', 'Costo Envío', 'Manejo', 'Total Costo'].map((h, i) => (
                                        <th key={i} style={{ padding: '10px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row, idx) => {
                                    const tc = getTenantColor(row.tenantId);
                                    const rowTotal = row.mensajeriaCost + row.correosCost + row.handling;
                                    return (
                                        <tr key={row.tenantId} style={{ borderBottom: idx < rows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }} className="lm-table-row">
                                            <td style={{ padding: '11px 14px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: tc }} /><span style={{ color: '#F2F2F2', fontWeight: 600 }}>{getTenantName(row.tenantId)}</span></div></td>
                                            <td style={{ padding: '11px 14px', color: '#F2F2F2', fontWeight: 700 }}>{row.total}</td>
                                            <td style={{ padding: '11px 14px' }}><span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(139,135,255,0.15)', color: '#8b87ff', fontWeight: 600, fontSize: 11 }}>{row.mensajeria}</span></td>
                                            <td style={{ padding: '11px 14px' }}><span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontWeight: 600, fontSize: 11 }}>{row.correos}</span></td>
                                            <td style={{ padding: '11px 14px', color: row.unassigned > 0 ? '#fbbf24' : 'rgba(255,255,255,0.25)' }}>{row.unassigned || '—'}</td>
                                            <td style={{ padding: '11px 14px', color: row.contraEntrega > 0 ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}>{row.contraEntrega || '—'}</td>
                                            <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.5)' }}>{fmt(row.mensajeriaCost + row.correosCost)}</td>
                                            <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.4)' }}>{fmt(row.handling)}</td>
                                            <td style={{ padding: '11px 14px', color: '#34d399', fontWeight: 700 }}>{fmt(rowTotal)}</td>
                                        </tr>
                                    );
                                })}
                                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                                    <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.45)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>TOTAL</td>
                                    <td style={{ padding: '11px 14px', color: '#8b87ff', fontWeight: 700 }}>{totals.orders}</td>
                                    <td style={{ padding: '11px 14px', color: '#8b87ff', fontWeight: 700 }}>{totals.mensajeria}</td>
                                    <td style={{ padding: '11px 14px', color: '#60a5fa', fontWeight: 700 }}>{totals.correos}</td>
                                    <td style={{ padding: '11px 14px', color: totals.unassigned > 0 ? '#fbbf24' : 'rgba(255,255,255,0.25)', fontWeight: 700 }}>{totals.unassigned || '—'}</td>
                                    <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.35)' }}>—</td>
                                    <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>{fmt(totalShipping)}</td>
                                    <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>{fmt(totals.handling)}</td>
                                    <td style={{ padding: '11px 14px', color: '#34d399', fontWeight: 700 }}>{fmt(grand)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}

// ─── Correos de Costa Rica Tab ────────────────────────────────────────────────
function CorreosCRTab() {
    const { tenants, getTenantName, getTenantColor } = useTenantConfig();
    const [orders, setOrders] = useState<any[]>([]);
    const [summary, setSummary] = useState({ totalOrders: 0, withCostCount: 0, pendingCostCount: 0, totalCost: 0 });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [costInputs, setCostInputs] = useState<Record<string, string>>({});
    const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
    const [filterTenant, setFilterTenant] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams();
            if (filterTenant) p.set('tenantId', filterTenant);
            if (dateFrom) p.set('dateFrom', new Date(dateFrom).toISOString());
            if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59); p.set('dateTo', d.toISOString()); }
            const d = await (await fetch(`/api/logistics/correos-costs?${p}`)).json();
            setOrders(d.orders || []);
            setSummary(d.summary || { totalOrders: 0, withCostCount: 0, pendingCostCount: 0, totalCost: 0 });
            // Initialize cost inputs with existing values
            const inputs: Record<string, string> = {};
            for (const o of (d.orders || [])) {
                inputs[o.id] = o.correos_shipping_cost != null ? String(Number(o.correos_shipping_cost)) : '';
            }
            setCostInputs(inputs);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [filterTenant, dateFrom, dateTo]);

    useEffect(() => { load(); }, [load]);

    async function saveCost(orderId: string) {
        const val = costInputs[orderId];
        if (val === '' || isNaN(Number(val)) || Number(val) < 0) return;
        setSaving(orderId);
        try {
            const res = await fetch('/api/logistics/correos-costs', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId, cost: Number(val) }),
            });
            if (res.ok) {
                setSavedIds(prev => new Set(prev).add(orderId));
                setTimeout(() => setSavedIds(prev => { const n = new Set(prev); n.delete(orderId); return n; }), 2000);
                // Update local summary
                const order = orders.find(o => o.id === orderId);
                if (order && order.correos_shipping_cost == null) {
                    setSummary(prev => ({
                        ...prev,
                        withCostCount: prev.withCostCount + 1,
                        pendingCostCount: prev.pendingCostCount - 1,
                        totalCost: prev.totalCost + Number(val),
                    }));
                } else if (order) {
                    setSummary(prev => ({
                        ...prev,
                        totalCost: prev.totalCost - Number(order.correos_shipping_cost) + Number(val),
                    }));
                }
                // Update order locally
                setOrders(prev => prev.map(o => o.id === orderId ? { ...o, correos_shipping_cost: Number(val) } : o));
            }
        } finally { setSaving(null); }
    }

    // Group by tenant
    const byTenant: Record<string, any[]> = {};
    for (const o of orders) {
        if (!byTenant[o.tenantId]) byTenant[o.tenantId] = [];
        byTenant[o.tenantId].push(o);
    }
    const tenantGroups = Object.entries(byTenant).sort((a, b) => b[1].length - a[1].length);

    return (
        <div>
            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                {[{ label: 'Total Entregados', value: summary.totalOrders, color: '#60a5fa' },
                { label: 'Con Costo', value: summary.withCostCount, color: '#34d399' },
                { label: 'Sin Costo', value: summary.pendingCostCount, color: '#fbbf24' },
                { label: 'Costo Total', value: fmt(summary.totalCost), color: '#8b87ff' },
                ].map(({ label, value, color }) => (
                    <div key={label} style={{ ...glassHi, padding: '16px 18px' }}>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                        <p style={{ color, fontSize: 24, fontWeight: 700, margin: 0 }}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center', flexWrap: 'wrap' }}>
                <Mail size={14} style={{ color: 'rgba(255,255,255,0.3)' }} />
                <select value={filterTenant} onChange={e => setFilterTenant(e.target.value)}
                    style={{ padding: '7px 14px', ...glass, color: filterTenant ? '#F2F2F2' : 'rgba(255,255,255,0.3)', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                    <option value="">Todas las cuentas</option>
                    {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    style={{ padding: '7px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>→</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    style={{ padding: '7px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                <button onClick={load} style={{ padding: '7px 16px', ...glass, color: '#60a5fa', cursor: 'pointer', fontSize: 13, borderColor: 'rgba(96,165,250,0.2)' }}>
                    Aplicar
                </button>
                {(filterTenant || dateFrom || dateTo) && <button onClick={() => { setFilterTenant(''); setDateFrom(''); setDateTo(''); }} style={{ padding: '7px 12px', background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 12 }}>✕ Limpiar</button>}
            </div>

            {summary.pendingCostCount > 0 && (
                <div style={{ ...glass, padding: '12px 18px', marginBottom: 18, borderColor: 'rgba(251,191,36,0.3)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <AlertCircle size={16} style={{ color: '#fbbf24', flexShrink: 0 }} />
                    <p style={{ color: '#fbbf24', fontSize: 12.5, margin: 0 }}>
                        <strong>{summary.pendingCostCount}</strong> {summary.pendingCostCount === 1 ? 'orden necesita' : 'órdenes necesitan'} que se ingrese el costo de envío de Correos CR para reflejarse correctamente en los reportes.
                    </p>
                </div>
            )}

            {loading ? <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)' }}>Cargando...</div> : (
                orders.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)' }}>
                        <Mail size={32} style={{ display: 'block', margin: '0 auto 12px', opacity: 0.3 }} />
                        <p style={{ margin: 0, fontSize: 13 }}>No hay órdenes de Correos CR con estado Entregado</p>
                    </div>
                ) : tenantGroups.map(([tid, tOrders]) => {
                    const tc = getTenantColor(tid);
                    const tPending = tOrders.filter(o => o.correos_shipping_cost == null).length;
                    const tTotal = tOrders.reduce((s, o) => s + (o.correos_shipping_cost != null ? Number(o.correos_shipping_cost) : 0), 0);
                    return (
                        <div key={tid} style={{ ...glass, overflow: 'hidden', marginBottom: 16 }}>
                            <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: tc, boxShadow: `0 0 6px ${tc}` }} />
                                    <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 14, margin: 0 }}>{getTenantName(tid)}</p>
                                    <span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontSize: 11, fontWeight: 600 }}>{tOrders.length} paq</span>
                                    {tPending > 0 && <span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(251,191,36,0.12)', color: '#fbbf24', fontSize: 11, fontWeight: 600 }}>{tPending} sin costo</span>}
                                </div>
                                <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 14 }}>{fmt(tTotal)}</span>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                        {['Cliente', 'Ref', 'Fecha', 'Provincia', 'Monto Orden', 'Costo Envío', ''].map(h => (
                                            <th key={h} style={{ padding: '9px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {tOrders.map((o, idx) => (
                                        <tr key={o.id} style={{ borderBottom: idx < tOrders.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: o.correos_shipping_cost == null ? 'rgba(251,191,36,0.02)' : 'transparent' }} className="lm-table-row">
                                            <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 500 }}>{o.customerName}</td>
                                            <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>#{o.orderId}</td>
                                            <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{new Date(o.timestamp).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}</td>
                                            <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>{o.province || '—'}</td>
                                            <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.5)' }}>{fmt(Number(o.total))}</td>
                                            <td style={{ padding: '10px 14px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>₡</span>
                                                    <input
                                                        type="number"
                                                        value={costInputs[o.id] ?? ''}
                                                        onChange={e => setCostInputs(prev => ({ ...prev, [o.id]: e.target.value }))}
                                                        placeholder="0"
                                                        style={{ width: 90, padding: '5px 8px', borderRadius: 6, border: `1px solid ${o.correos_shipping_cost != null ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.4)'}`, background: 'rgba(0,0,0,0.25)', color: o.correos_shipping_cost != null ? '#34d399' : '#fbbf24', fontSize: 13, fontWeight: 700, outline: 'none' }}
                                                    />
                                                </div>
                                            </td>
                                            <td style={{ padding: '10px 14px' }}>
                                                <button
                                                    onClick={() => saveCost(o.id)}
                                                    disabled={saving === o.id || !costInputs[o.id] || isNaN(Number(costInputs[o.id]))}
                                                    style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.08)', color: savedIds.has(o.id) ? '#34d399' : '#60a5fa', fontSize: 11, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                                                    {saving === o.id ? <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> : savedIds.has(o.id) ? <CheckCircle size={10} /> : <Save size={10} />}
                                                    {savedIds.has(o.id) ? 'Guardado' : 'Guardar'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                })
            )}
        </div>
    );
}

// ─── Contra Entregas Tab ───────────────────────────────────────────────────────
function ContraEntregasTab() {
    const { getTenantName, getTenantColor } = useTenantConfig();
    const [orders, setOrders] = useState<any[]>([]);
    const [summary, setSummary] = useState({ total: 0, totalAmount: 0, pending: 0, collected: 0 });
    const [loading, setLoading] = useState(true);
    const [confirming, setConfirming] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'pending' | 'collected'>('all');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams();
            if (filter === 'pending') p.set('collected', 'false');
            if (filter === 'collected') p.set('collected', 'true');
            const d = await (await fetch(`/api/logistics/contra-entrega?${p}`)).json();
            setOrders(d.orders || []);
            setSummary(d.summary || { total: 0, totalAmount: 0, pending: 0, collected: 0 });
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [filter]);

    useEffect(() => { load(); }, [load]);

    async function confirmPayment(order: any) {
        setConfirming(order.orderId);
        try {
            await fetch('/api/logistics/contra-entrega', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderId: order.orderId, tenantId: order.tenantId, amount: order.total }),
            });
            await load();
        } finally { setConfirming(null); }
    }

    return (
        <div>
            {/* Summary KPIs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                {[{ label: 'Total CE', value: summary.total, color: '#fbbf24' },
                { label: 'Monto Total', value: fmt(summary.totalAmount), color: '#8b87ff' },
                { label: 'Pendientes', value: summary.pending, color: '#f87171' },
                { label: 'Cobrados', value: summary.collected, color: '#34d399' },
                ].map(({ label, value, color }) => (
                    <div key={label} style={{ ...glassHi, padding: '16px 18px' }}>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                        <p style={{ color, fontSize: 24, fontWeight: 700, margin: 0 }}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Filter pills */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
                {(['all', 'pending', 'collected'] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)} style={{ padding: '6px 16px', borderRadius: 20, border: `1px solid ${filter === f ? 'rgba(251,191,36,0.5)' : 'rgba(255,255,255,0.1)'}`, background: filter === f ? 'rgba(251,191,36,0.1)' : 'transparent', color: filter === f ? '#fbbf24' : 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        {f === 'all' ? 'Todos' : f === 'pending' ? '○ Pendientes' : '✓ Cobrados'}
                    </button>
                ))}
            </div>

            {loading ? <div style={{ textAlign: 'center', padding: 60, color: 'rgba(255,255,255,0.2)' }}>Cargando...</div> : (
                <div style={{ ...glass, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                {['Cuenta', 'Cliente', 'Carrier', 'Monto', 'Fecha', 'Estado', 'Acción'].map(h => (
                                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {orders.length === 0 ? (
                                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.2)' }}>No hay contra entregas</td></tr>
                            ) : orders.map((o, idx) => {
                                const tc = getTenantColor(o.tenantId);
                                return (
                                    <tr key={o.orderId} style={{ borderBottom: idx < orders.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: o.collected ? 'transparent' : 'rgba(251,191,36,0.03)' }} className="lm-table-row">
                                        <td style={{ padding: '10px 14px' }}><span style={{ padding: '2px 8px', borderRadius: 20, background: `${tc}20`, color: tc, fontSize: 10.5, fontWeight: 700 }}>{getTenantName(o.tenantId)}</span></td>
                                        <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 500 }}>{o.customerName}<div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>#{o.orderRef}</div></td>
                                        <td style={{ padding: '10px 14px' }}>
                                            {o.lmCarrier ? <span style={{ padding: '2px 8px', borderRadius: 20, background: o.lmCarrier === 'mensajeria' ? 'rgba(139,135,255,0.15)' : 'rgba(96,165,250,0.15)', color: o.lmCarrier === 'mensajeria' ? '#8b87ff' : '#60a5fa', fontSize: 11 }}>{o.lmCarrier === 'mensajeria' ? 'Mensajería' : 'Correos'}</span> : <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '10px 14px', color: '#fbbf24', fontWeight: 700 }}>{fmt(o.total)}</td>
                                        <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>{new Date(o.timestamp).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}</td>
                                        <td style={{ padding: '10px 14px' }}>
                                            {o.collected
                                                ? <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#34d399', fontSize: 11, fontWeight: 700 }}><CheckCircle size={12} /> Cobrado</span>
                                                : <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#fbbf24', fontSize: 11 }}><AlertCircle size={12} /> Pendiente</span>}
                                        </td>
                                        <td style={{ padding: '10px 14px' }}>
                                            {!o.collected && (
                                                <button onClick={() => confirmPayment(o)} disabled={confirming === o.orderId}
                                                    style={{ padding: '5px 13px', borderRadius: 7, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.08)', color: '#34d399', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                    {confirming === o.orderId ? '...' : '✓ Confirmar Pago'}
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── Días Trabajados Tab ───────────────────────────────────────────────────────
function DiasTrabajadosTab({ dailyRate }: { dailyRate: number }) {
    const [workDays, setWorkDays] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [staffName, setStaffName] = useState<string>(STAFF_OPTIONS[0]);
    const [dateFrom, setDateFrom] = useState(() => startOfMonthKey(toDateKeyCR()));
    const [dateTo, setDateTo] = useState(() => toDateKeyCR());
    const [newDate, setNewDate] = useState(() => toDateKeyCR());
    const [dayType, setDayType] = useState<WorkDayType>('full');
    const [adding, setAdding] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const effectiveDailyRate = dailyRate || 10000;
    const getUnits = (day: any) => Number(day.work_units ?? (day.day_type === 'half' ? 0.5 : 1));
    const getDayAmount = (day: any) => getUnits(day) * effectiveDailyRate;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams({ staffName });
            if (dateFrom) p.set('dateFrom', dateFrom);
            if (dateTo) p.set('dateTo', dateTo);
            const d = await (await fetch(`/api/logistics/work-days?${p}`)).json();
            setWorkDays(d.workDays || []);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, [staffName, dateFrom, dateTo]);

    useEffect(() => { load(); }, [load]);

    async function addDay() {
        if (!newDate) return;
        setAdding(true);
        try {
            await fetch('/api/logistics/work-days', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffName, workDate: newDate, dayType }) });
            await load();
        } finally { setAdding(false); }
    }

    async function removeDay(id: string) {
        setDeleting(id);
        try {
            await fetch('/api/logistics/work-days', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
            await load();
        } finally { setDeleting(null); }
    }

    const workUnits = workDays.reduce((sum, day) => sum + getUnits(day), 0);
    const daysCount = workUnits;
    const salaryTotal = workDays.reduce((sum, day) => sum + getDayAmount(day), 0);
    const selectedDateEntry = workDays.find(d => String(d.work_date).slice(0, 10) === newDate);

    return (
        <div>
            {/* Salary Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 22 }}>
                {[{ label: 'Días Trabajados', value: daysCount, color: '#8b87ff' },
                { label: 'Tarifa Diaria', value: fmt(dailyRate), color: '#60a5fa' },
                { label: 'Total Salario', value: fmt(salaryTotal), color: '#34d399' },
                ].map(({ label, value, color }) => (
                    <div key={label} style={{ ...glassHi, padding: '20px 22px' }}>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                        <p style={{ color, fontSize: 26, fontWeight: 700, margin: 0 }}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Filters + Add */}
            <div style={{ ...glass, padding: '18px 20px', marginBottom: 18 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
                    <select value={staffName} onChange={e => setStaffName(e.target.value)}
                        style={{ padding: '7px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                        {STAFF_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '7px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>→</span>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '7px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                    <button onClick={load} style={{ padding: '7px 16px', ...glass, color: '#8b87ff', cursor: 'pointer', fontSize: 13, borderColor: 'rgba(139,135,255,0.2)' }}>Filtrar</button>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <DollarSign size={14} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                    <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={{ flex: 1, padding: '8px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                    {(Object.keys(WORK_DAY_OPTIONS) as WorkDayType[]).map(type => {
                        const option = WORK_DAY_OPTIONS[type];
                        const selected = dayType === type;
                        return (
                            <button key={type} onClick={() => setDayType(type)}
                                style={{ padding: '8px 14px', borderRadius: 8, border: selected ? '1px solid rgba(52,211,153,0.45)' : '1px solid rgba(255,255,255,0.1)', background: selected ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)', color: selected ? '#34d399' : 'rgba(255,255,255,0.55)', cursor: 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {option.label} - {fmt(option.units * effectiveDailyRate)}
                            </button>
                        );
                    })}
                    <button onClick={addDay} disabled={!newDate || adding}
                        style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.08)', color: '#34d399', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        <PlusCircle size={13} /> {adding ? 'Agregando...' : 'Agregar Día'}
                    </button>
                </div>
                {selectedDateEntry && (
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '12px 0 0' }}>
                        Ya existe un registro para esta fecha. Guardar reemplaza la jornada actual.
                    </p>
                )}
            </div>

            {/* Work days list */}
            {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.2)' }}>Cargando...</div> : (
                workDays.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.2)' }}>
                        <Calendar size={28} style={{ display: 'block', margin: '0 auto 10px', opacity: 0.3 }} />
                        <p style={{ margin: 0, fontSize: 13 }}>No hay días registrados</p>
                    </div>
                ) : (
                    <div style={{ ...glass, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                    {['#', 'Fecha', 'Colaborador', 'Salario', ''].map(h => (
                                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {workDays.map((d, idx) => (
                                    <tr key={d.id} style={{ borderBottom: idx < workDays.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }} className="lm-table-row">
                                        <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>{idx + 1}</td>
                                        <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 600 }}>{new Date(d.work_date + 'T12:00:00').toLocaleDateString('es-CR', { weekday: 'long', day: '2-digit', month: 'long' })}</td>
                                        <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.6)' }}>
                                            {d.staff_name}
                                            <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 20, background: getUnits(d) === 0.5 ? 'rgba(96,165,250,0.14)' : 'rgba(52,211,153,0.12)', color: getUnits(d) === 0.5 ? '#60a5fa' : '#34d399', fontSize: 11, fontWeight: 700 }}>
                                                {getUnits(d) === 0.5 ? 'Medio dia' : 'Dia completo'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 14px', color: '#34d399', fontWeight: 700 }}>{fmt(getDayAmount(d))}</td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <button onClick={() => removeDay(d.id)} disabled={deleting === d.id}
                                                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.25)', background: 'rgba(248,113,113,0.06)', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                                <Trash2 size={11} /> {deleting === d.id ? '...' : 'Quitar'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                                    <td colSpan={3} style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.45)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>TOTAL — {daysCount} días</td>
                                    <td style={{ padding: '11px 14px', color: '#34d399', fontWeight: 700, fontSize: 15 }}>{fmt(salaryTotal)}</td>
                                    <td />
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )
            )}
        </div>
    );
}

// ─── GD Balance Tab ───────────────────────────────────────────────────────────
type ShiftDraft = {
    id?: string;
    staffName: StaffName;
    workDate: string;
    dayType: WorkDayType;
    hours: string;
    startTime: string;
    lunchMinutes: number;
    timeLabel: string;
    notes: string;
    persisted: boolean;
};

type WeeklyPayrollReport = {
    weekStart: string;
    weekEnd: string;
    savedCells: number;
    hours: number;
    total: number;
    employees: {
        staffName: StaffName;
        hours: number;
        total: number;
        shifts: ShiftDraft[];
    }[];
};

function toDateKeyLocal(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function addDaysKey(key: string, days: number) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return toDateKeyLocal(dt);
}

function getWeekStartKey(key: string) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const day = dt.getDay();
    dt.setDate(dt.getDate() + (day === 0 ? -6 : 1 - day));
    return toDateKeyLocal(dt);
}

function draftKey(staffName: StaffName, workDate: string) {
    return `${staffName}:${workDate}`;
}

function defaultShift(staffName: StaffName, workDate: string, dayIndex: number): ShiftDraft {
    const base = BASE_SCHEDULE[staffName][dayIndex];
    if (!base) return { staffName, workDate, dayType: 'off', hours: '0', startTime: '09:00', lunchMinutes: 0, timeLabel: '', notes: '', persisted: false };
    return { staffName, workDate, dayType: base.dayType, hours: String(base.hours), startTime: base.startTime, lunchMinutes: base.hours >= 8 ? 60 : 0, timeLabel: '', notes: base.notes || '', persisted: false };
}

function normalizeShiftType(value: unknown, hours: number): WorkDayType {
    if (value === 'off' || value === 'full' || value === 'short' || value === 'custom') return value;
    if (hours === 8) return 'full';
    if (hours === 2) return 'short';
    return hours > 0 ? 'custom' : 'off';
}

function minutesFromTime(time: string) {
    const [hour, minute] = time.split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 9 * 60;
    return hour * 60 + minute;
}

function timeFromMinutes(totalMinutes: number) {
    const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
    const hour = Math.floor(normalized / 60);
    const minute = normalized % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatTimeLabel(time: string) {
    const [hourRaw, minuteRaw] = time.split(':').map(Number);
    const hour = Number.isFinite(hourRaw) ? hourRaw : 9;
    const minute = Number.isFinite(minuteRaw) ? minuteRaw : 0;
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function parseStartTime(value: unknown, fallback = '09:00') {
    if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) return value;
    if (typeof value !== 'string') return fallback;
    const match = value.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) return fallback;
    let hour = Number(match[1]);
    const minute = Number(match[2] || '0');
    const suffix = match[3]?.toUpperCase();
    if (suffix === 'PM' && hour < 12) hour += 12;
    if (suffix === 'AM' && hour === 12) hour = 0;
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function buildTimeLabel(startTime: string, paidHours: number, lunchMinutes: number) {
    if (paidHours <= 0) return 'Libre';
    const start = minutesFromTime(startTime);
    const end = timeFromMinutes(start + paidHours * 60 + lunchMinutes);
    return `${formatTimeLabel(startTime)} - ${formatTimeLabel(end)}`;
}

function parseWorkDayRow(row: any, fallbackStaffName?: StaffName): ShiftDraft {
    const staffName = (STAFF_OPTIONS.includes(row.staff_name) ? row.staff_name : fallbackStaffName || STAFF_OPTIONS[0]) as StaffName;
    const workDate = String(row.work_date || row.work_date_key || '').slice(0, 10);
    const rowHours = Number(row.hours ?? (Number(row.work_units ?? 1) * HOURS_PER_FULL_DAY));
    const safeHours = Number.isFinite(rowHours) ? Math.max(0, Math.min(HOURS_PER_FULL_DAY, rowHours)) : HOURS_PER_FULL_DAY;

    return {
        id: row.id,
        staffName,
        workDate,
        dayType: normalizeShiftType(row.day_type, safeHours),
        hours: String(safeHours),
        startTime: parseStartTime(row.start_time || row.time_label, staffName === 'Lau' ? '10:00' : '09:00'),
        lunchMinutes: Number.isFinite(Number(row.lunch_minutes)) ? Number(row.lunch_minutes) : (safeHours >= 8 ? 60 : 0),
        timeLabel: row.time_label || '',
        notes: row.notes || '',
        persisted: true,
    };
}

function DiasTrabajadosScheduleTab({ dailyRate }: { dailyRate: number }) {
    const [workDays, setWorkDays] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [weekStart, setWeekStart] = useState(() => getWeekStartKey(toDateKeyCR()));
    const [draft, setDraft] = useState<Record<string, ShiftDraft>>({});
    const [savingWeek, setSavingWeek] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [reportRows, setReportRows] = useState<any[]>([]);
    const [loadingReports, setLoadingReports] = useState(false);

    const effectiveDailyRate = dailyRate || 10000;
    const hourlyRate = Math.round(effectiveDailyRate / HOURS_PER_FULL_DAY) || HOURLY_RATE;
    const weekDates = useMemo(() => WEEK_DAYS.map(day => addDaysKey(weekStart, day.key)), [weekStart]);
    const weekEnd = weekDates[weekDates.length - 1];
    const todayKey = toDateKeyCR();
    const currentWeekStart = getWeekStartKey(todayKey);
    const nextWeekStart = addDaysKey(currentWeekStart, 7);
    const reportStart = addDaysKey(currentWeekStart, -11 * 7);

    const getShiftHours = (shift: ShiftDraft) => {
        const hours = Number(shift.hours);
        return Number.isFinite(hours) ? Math.max(0, Math.min(HOURS_PER_FULL_DAY, hours)) : 0;
    };
    const getShiftAmount = (shift: ShiftDraft) => getShiftHours(shift) * hourlyRate;
    const getRowDateKey = (row: any) => String(row.work_date || row.work_date_key || '').slice(0, 10);

    const buildDraftFromRows = useCallback((rows: any[]) => {
        const nextDraft: Record<string, ShiftDraft> = {};

        for (const staffName of STAFF_OPTIONS) {
            weekDates.forEach((date, dayIndex) => {
                const row = rows.find((entry: any) => entry.staff_name === staffName && getRowDateKey(entry) === date);
                if (!row) {
                    nextDraft[draftKey(staffName, date)] = defaultShift(staffName, date, dayIndex);
                    return;
                }
                nextDraft[draftKey(staffName, date)] = parseWorkDayRow(row, staffName);
            });
        }

        return nextDraft;
    }, [weekDates]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams({ dateFrom: weekStart, dateTo: weekEnd });
            const response = await fetch(`/api/logistics/work-days?${p}`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.error || `HTTP ${response.status}`);
            }
            const d = await response.json();
            const rows = (d.workDays || []).filter((day: any) => STAFF_OPTIONS.includes(day.staff_name));

            setWorkDays(rows);
            setDraft(buildDraftFromRows(rows));
        } catch (e) {
            console.error(e);
            setSaveStatus({ type: 'error', message: `No se pudo cargar el horario: ${e instanceof Error ? e.message : 'error desconocido'}` });
        } finally { setLoading(false); }
    }, [weekStart, weekEnd, buildDraftFromRows]);

    useEffect(() => { load(); }, [load]);

    const loadReports = useCallback(async () => {
        setLoadingReports(true);
        try {
            const p = new URLSearchParams({ dateFrom: reportStart, dateTo: weekEnd });
            const response = await fetch(`/api/logistics/work-days?${p}`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => null);
                throw new Error(errorData?.error || `HTTP ${response.status}`);
            }
            const d = await response.json();
            setReportRows((d.workDays || []).filter((day: any) => STAFF_OPTIONS.includes(day.staff_name)));
        } catch (error) {
            console.error('[schedule reports]', error);
            setSaveStatus({ type: 'error', message: `No se pudieron cargar reportes: ${error instanceof Error ? error.message : 'error desconocido'}` });
        } finally {
            setLoadingReports(false);
        }
    }, [reportStart, weekEnd]);

    useEffect(() => { loadReports(); }, [loadReports]);

    function updateShift(staffName: StaffName, workDate: string, patch: Partial<ShiftDraft>) {
        setDraft(prev => {
            const current = prev[draftKey(staffName, workDate)];
            if (!current) return prev;
            const next = { ...current, ...patch, persisted: false };
            if (patch.dayType) {
                const option = WORK_DAY_OPTIONS[patch.dayType];
                next.hours = patch.dayType === 'custom' ? (Number(current.hours) > 0 ? current.hours : '8') : String(option.hours);
                next.lunchMinutes = Number(next.hours) >= 8 ? 60 : 0;
                if (patch.dayType === 'off') next.startTime = current.startTime || '09:00';
                if (patch.dayType === 'short' && current.dayType === 'off') next.startTime = '18:00';
            }
            return { ...prev, [draftKey(staffName, workDate)]: next };
        });
    }

    function loadBaseSchedule() {
        const nextDraft: Record<string, ShiftDraft> = {};
        for (const staffName of STAFF_OPTIONS) {
            weekDates.forEach((date, dayIndex) => {
                const existing = draft[draftKey(staffName, date)];
                nextDraft[draftKey(staffName, date)] = { ...defaultShift(staffName, date, dayIndex), id: existing?.id, persisted: existing?.persisted || false };
            });
        }
        setDraft(nextDraft);
        setSaveStatus({ type: 'success', message: 'Horario base cargado. Revisa y guarda la semana para aplicarlo.' });
    }

    async function workDayRequest(input: RequestInfo | URL, init?: RequestInit) {
        const response = await fetch(input, init);
        if (response.ok) return response;

        let detail = '';
        try {
            const data = await response.json();
            detail = data?.error || data?.message || '';
        } catch {
            detail = await response.text().catch(() => '');
        }
        throw new Error(detail ? `${response.status} ${detail}` : `HTTP ${response.status}`);
    }

    async function workDayJson(input: RequestInfo | URL, init?: RequestInit) {
        const response = await workDayRequest(input, init);
        return response.json();
    }

    function buildSaveEntries(targetStart = weekStart) {
        return Object.values(draft).map(shift => {
            const dayIndex = weekDates.indexOf(shift.workDate);
            const workDate = dayIndex >= 0 ? addDaysKey(targetStart, dayIndex) : shift.workDate;
            const hours = getShiftHours(shift);
            return {
                staffName: shift.staffName,
                workDate,
                dayType: shift.dayType,
                hours,
                startTime: shift.startTime,
                lunchMinutes: shift.lunchMinutes,
                timeLabel: buildTimeLabel(shift.startTime, hours, shift.lunchMinutes),
                label: WORK_DAY_OPTIONS[shift.dayType]?.label || 'Horas',
                notes: shift.notes,
            };
        });
    }

    async function copyToNextWeek() {
        const targetStart = addDaysKey(weekStart, 7);
        const targetEnd = addDaysKey(targetStart, WEEK_DAYS.length - 1);
        setSavingWeek(true);
        setSaveStatus(null);
        try {
            await workDayJson('/api/logistics/work-days', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dateFrom: targetStart,
                    dateTo: targetEnd,
                    staffNames: STAFF_OPTIONS,
                    entries: buildSaveEntries(targetStart),
                }),
            });
            setWeekStart(targetStart);
            setSaveStatus({ type: 'success', message: 'La proxima semana fue creada. Puedes revisarla y hacer cambios encima.' });
        } catch (error) {
            console.error('[schedule copy]', error);
            setSaveStatus({ type: 'error', message: `No se pudo copiar la semana: ${error instanceof Error ? error.message : 'error desconocido'}` });
        } finally { setSavingWeek(false); }
    }

    async function saveWeek() {
        setSavingWeek(true);
        setSaveStatus(null);
        try {
            const data = await workDayJson('/api/logistics/work-days', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dateFrom: weekStart,
                    dateTo: weekEnd,
                    staffNames: STAFF_OPTIONS,
                    entries: buildSaveEntries(),
                }),
            });
            const rows = (data.workDays || []).filter((day: any) => STAFF_OPTIONS.includes(day.staff_name));
            setWorkDays(rows);
            setDraft(buildDraftFromRows(rows));
            setReportRows(prev => {
                const outsideWeek = prev.filter((row: any) => {
                    const key = getRowDateKey(row);
                    return key < weekStart || key > weekEnd || !STAFF_OPTIONS.includes(row.staff_name);
                });
                return [...outsideWeek, ...rows];
            });
            setSaveStatus({ type: 'success', message: `Semana guardada correctamente (${data.saved ?? rows.length} turnos).` });
        } catch (error) {
            console.error('[schedule save]', error);
            setSaveStatus({ type: 'error', message: `No se pudo guardar: ${error instanceof Error ? error.message : 'error desconocido'}` });
        } finally { setSavingWeek(false); }
    }

    async function removeDay(id: string) {
        setDeleting(id);
        setSaveStatus(null);
        try {
            await workDayRequest('/api/logistics/work-days', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
            await load();
            setSaveStatus({ type: 'success', message: 'Turno eliminado.' });
        } catch (error) {
            console.error('[schedule delete]', error);
            setSaveStatus({ type: 'error', message: `No se pudo eliminar: ${error instanceof Error ? error.message : 'error desconocido'}` });
        } finally { setDeleting(null); }
    }

    const paidShifts = Object.values(draft).filter(shift => getShiftHours(shift) > 0);
    const totalHours = paidShifts.reduce((sum, shift) => sum + getShiftHours(shift), 0);
    const salaryTotal = paidShifts.reduce((sum, shift) => sum + getShiftAmount(shift), 0);
    const accruedTotal = paidShifts.filter(shift => shift.workDate <= todayKey).reduce((sum, shift) => sum + getShiftAmount(shift), 0);
    const remainingTotal = Math.max(0, salaryTotal - accruedTotal);
    const hasUnsavedPlan = Object.values(draft).some(shift => !shift.persisted);
    const employeeTotals = STAFF_OPTIONS.map(staffName => {
        const employeeShifts = paidShifts.filter(shift => shift.staffName === staffName);
        const total = employeeShifts.reduce((sum, shift) => sum + getShiftAmount(shift), 0);
        const accrued = employeeShifts.filter(shift => shift.workDate <= todayKey).reduce((sum, shift) => sum + getShiftAmount(shift), 0);
        return {
            staffName,
            hours: employeeShifts.reduce((sum, shift) => sum + getShiftHours(shift), 0),
            total,
            accrued,
            pending: Math.max(0, total - accrued),
        };
    });
    const weeklyReports = useMemo<WeeklyPayrollReport[]>(() => {
        const rowsByWeek = new Map<string, any[]>();
        for (const row of reportRows) {
            const dateKey = getRowDateKey(row);
            if (!dateKey) continue;
            const rowWeekStart = getWeekStartKey(dateKey);
            if (rowWeekStart > currentWeekStart) continue;
            const existing = rowsByWeek.get(rowWeekStart) || [];
            existing.push(row);
            rowsByWeek.set(rowWeekStart, existing);
        }

        return Array.from(rowsByWeek.entries())
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([rowWeekStart, rows]) => {
                const rowWeekEnd = addDaysKey(rowWeekStart, WEEK_DAYS.length - 1);
                const shifts = rows
                    .map((row: any) => parseWorkDayRow(row))
                    .filter((shift: ShiftDraft) => STAFF_OPTIONS.includes(shift.staffName));
                const employees = STAFF_OPTIONS.map(staffName => {
                    const employeeShifts = WEEK_DAYS.map(day => {
                        const date = addDaysKey(rowWeekStart, day.key);
                        return shifts.find(shift => shift.staffName === staffName && shift.workDate === date)
                            || { staffName, workDate: date, dayType: 'off' as WorkDayType, hours: '0', startTime: '09:00', lunchMinutes: 0, timeLabel: '', notes: '', persisted: false };
                    });
                    const hours = employeeShifts.reduce((sum, shift) => sum + getShiftHours(shift), 0);
                    return {
                        staffName,
                        hours,
                        total: hours * hourlyRate,
                        shifts: employeeShifts,
                    };
                });
                return {
                    weekStart: rowWeekStart,
                    weekEnd: rowWeekEnd,
                    savedCells: rows.length,
                    hours: employees.reduce((sum, employee) => sum + employee.hours, 0),
                    total: employees.reduce((sum, employee) => sum + employee.total, 0),
                    employees,
                };
            });
    }, [reportRows, currentWeekStart, hourlyRate]);

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
                {[{ label: 'Total semana', value: fmt(salaryTotal), color: '#34d399' },
                { label: 'Acumulado hoy', value: fmt(accruedTotal), color: '#60a5fa' },
                { label: 'Pendiente sabado', value: fmt(remainingTotal), color: '#fbbf24' },
                { label: 'Horas plan', value: `${totalHours}h`, color: '#8b87ff' },
                ].map(({ label, value, color }) => (
                    <div key={label} style={{ ...glassHi, padding: '18px 20px' }}>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                        <p style={{ color, fontSize: 24, fontWeight: 800, margin: 0 }}>{value}</p>
                    </div>
                ))}
            </div>

            <div style={{ ...glass, padding: '18px 20px', marginBottom: 18 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {[{ label: 'Semana actual', value: currentWeekStart }, { label: 'Proxima semana', value: nextWeekStart }].map(item => {
                            const selected = weekStart === item.value;
                            return (
                                <button key={item.value} onClick={() => setWeekStart(item.value)}
                                    style={{ padding: '9px 14px', borderRadius: 8, border: selected ? '1px solid rgba(139,135,255,0.5)' : '1px solid rgba(255,255,255,0.1)', background: selected ? 'rgba(139,135,255,0.12)' : 'rgba(255,255,255,0.035)', color: selected ? '#F2F2F2' : 'rgba(255,255,255,0.55)', cursor: 'pointer', fontSize: 12, fontWeight: 800 }}>
                                    {item.label}
                                </button>
                            );
                        })}
                        <input type="date" value={weekStart} onChange={e => setWeekStart(getWeekStartKey(e.target.value))} style={{ padding: '8px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>Lun {new Date(weekStart + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })} - Sab {new Date(weekEnd + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <button onClick={copyToNextWeek} disabled={savingWeek || loading}
                            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.28)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24', cursor: 'pointer', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <PlusCircle size={12} /> Copiar a proxima
                        </button>
                        <button onClick={loadBaseSchedule} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.25)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', cursor: 'pointer', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <RefreshCw size={12} /> Horario base
                        </button>
                        <button onClick={saveWeek} disabled={savingWeek || loading}
                            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.08)', color: '#34d399', cursor: 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Save size={13} /> {savingWeek ? 'Guardando...' : 'Guardar semana'}
                        </button>
                    </div>
                </div>
                <p style={{ color: hasUnsavedPlan ? '#fbbf24' : 'rgba(255,255,255,0.35)', fontSize: 12, margin: 0 }}>
                    Selecciona solo la hora de entrada. FULL calcula 9 horas en sitio: 8 pagadas + 1 de comida. Los turnos cortos no agregan comida.
                </p>
                {saveStatus && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, border: `1px solid ${saveStatus.type === 'error' ? 'rgba(248,113,113,0.35)' : 'rgba(52,211,153,0.25)'}`, background: saveStatus.type === 'error' ? 'rgba(248,113,113,0.08)' : 'rgba(52,211,153,0.08)', color: saveStatus.type === 'error' ? '#f87171' : '#34d399', fontSize: 12, fontWeight: 700 }}>
                        {saveStatus.message}
                    </div>
                )}
            </div>

            {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.2)' }}>Cargando...</div> : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
                        {employeeTotals.map(employee => (
                            <div key={employee.staffName} style={{ ...glassHi, padding: '18px 20px', borderColor: employee.staffName === 'Ma' ? 'rgba(139,135,255,0.22)' : 'rgba(96,165,250,0.22)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, marginBottom: 14 }}>
                                    <div>
                                        <p style={{ color: '#F2F2F2', fontSize: 18, fontWeight: 800, margin: '0 0 4px' }}>{employee.staffName}</p>
                                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: 0 }}>{employee.hours} horas planificadas</p>
                                    </div>
                                    <p style={{ color: '#34d399', fontSize: 22, fontWeight: 800, margin: 0 }}>{fmt(employee.total)}</p>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    <div style={{ padding: 10, borderRadius: 8, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.14)' }}>
                                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, margin: '0 0 5px', textTransform: 'uppercase' }}>Acumulado</p>
                                        <p style={{ color: '#60a5fa', fontWeight: 800, margin: 0 }}>{fmt(employee.accrued)}</p>
                                    </div>
                                    <div style={{ padding: 10, borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.14)' }}>
                                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, margin: '0 0 5px', textTransform: 'uppercase' }}>Pendiente</p>
                                        <p style={{ color: '#fbbf24', fontWeight: 800, margin: 0 }}>{fmt(employee.pending)}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(310px,1fr))', gap: 14 }}>
                        {weekDates.map((date, dayIndex) => (
                            <div key={date} style={{ ...glass, padding: 16, borderColor: date === todayKey ? 'rgba(96,165,250,0.35)' : 'rgba(255,255,255,0.1)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
                                    <div>
                                        <p style={{ color: '#F2F2F2', fontWeight: 800, fontSize: 16, margin: '0 0 3px' }}>{WEEK_DAYS[dayIndex].label}</p>
                                        <p style={{ color: date === todayKey ? '#60a5fa' : 'rgba(255,255,255,0.35)', fontSize: 12, margin: 0 }}>{new Date(date + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}</p>
                                    </div>
                                    {date === todayKey && <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Hoy</span>}
                                </div>

                                <div style={{ display: 'grid', gap: 10 }}>
                                    {STAFF_OPTIONS.map(staffName => {
                                        const shift = draft[draftKey(staffName, date)];
                                        if (!shift) return null;
                                        const hours = getShiftHours(shift);
                                        const amount = getShiftAmount(shift);
                                        const option = WORK_DAY_OPTIONS[shift.dayType];
                                        const lunchMinutes = hours >= 8 ? shift.lunchMinutes : 0;
                                        const scheduleLabel = buildTimeLabel(shift.startTime, hours, lunchMinutes);
                                        return (
                                            <div key={staffName} style={{ padding: 12, borderRadius: 8, background: hours > 0 ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.025)', border: `1px solid ${hours > 0 ? 'rgba(52,211,153,0.16)' : 'rgba(255,255,255,0.07)'}` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <span style={{ width: 28, height: 28, borderRadius: 8, background: staffName === 'Ma' ? 'rgba(139,135,255,0.16)' : 'rgba(96,165,250,0.16)', color: staffName === 'Ma' ? '#8b87ff' : '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 12 }}>{staffName.slice(0, 2)}</span>
                                                        <div>
                                                            <p style={{ color: '#F2F2F2', fontWeight: 800, fontSize: 13, margin: 0 }}>{staffName}</p>
                                                            <p style={{ color: hours > 0 ? option.color : 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: 800, margin: 0 }}>{WORK_DAY_OPTIONS[shift.dayType].label}</p>
                                                        </div>
                                                    </div>
                                                    {hours > 0 ? (
                                                        <button onClick={() => updateShift(staffName, date, { dayType: 'off' })}
                                                            title="Marcar libre"
                                                            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.05)', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                            <Trash2 size={12} />
                                                        </button>
                                                    ) : null}
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                                                    <label style={{ display: 'grid', gap: 5 }}>
                                                        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Tipo</span>
                                                        <select value={shift.dayType} onChange={e => updateShift(staffName, date, { dayType: e.target.value as WorkDayType })}
                                                            style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${hours > 0 ? 'rgba(52,211,153,0.24)' : 'rgba(255,255,255,0.1)'}`, background: 'rgba(11,15,25,0.72)', color: option.color, fontSize: 12, fontWeight: 800, outline: 'none', cursor: 'pointer' }}>
                                                            {(Object.keys(WORK_DAY_OPTIONS) as WorkDayType[]).map(type => <option key={type} value={type}>{WORK_DAY_OPTIONS[type].label}</option>)}
                                                        </select>
                                                    </label>
                                                    <label style={{ display: 'grid', gap: 5 }}>
                                                        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Entrada</span>
                                                        <select value={shift.startTime} disabled={hours <= 0} onChange={e => updateShift(staffName, date, { startTime: e.target.value })}
                                                            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: hours > 0 ? 'rgba(11,15,25,0.72)' : 'rgba(255,255,255,0.025)', color: hours > 0 ? '#F2F2F2' : 'rgba(255,255,255,0.25)', fontSize: 12, fontWeight: 700, outline: 'none', cursor: hours > 0 ? 'pointer' : 'default' }}>
                                                            {START_TIME_OPTIONS.map(time => <option key={time} value={time}>{formatTimeLabel(time)}</option>)}
                                                        </select>
                                                    </label>
                                                </div>

                                                {shift.dayType === 'custom' && (
                                                    <label style={{ display: 'grid', gap: 5, marginBottom: 10 }}>
                                                        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}>Horas pagadas</span>
                                                        <select value={shift.hours} onChange={e => updateShift(staffName, date, { hours: e.target.value, lunchMinutes: Number(e.target.value) >= 8 ? 60 : 0 })}
                                                            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.25)', background: 'rgba(11,15,25,0.72)', color: '#fbbf24', fontSize: 12, fontWeight: 800, outline: 'none', cursor: 'pointer' }}>
                                                            {['1', '2', '3', '4', '5', '6', '7', '8'].map(h => <option key={h} value={h}>{h} horas</option>)}
                                                        </select>
                                                    </label>
                                                )}

                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center', padding: '10px 11px', borderRadius: 8, background: hours > 0 ? 'rgba(52,211,153,0.07)' : 'rgba(255,255,255,0.025)', border: `1px solid ${hours > 0 ? 'rgba(52,211,153,0.14)' : 'rgba(255,255,255,0.06)'}`, marginBottom: 10 }}>
                                                    <div>
                                                        <p style={{ color: hours > 0 ? '#F2F2F2' : 'rgba(255,255,255,0.35)', fontWeight: 800, fontSize: 13, margin: '0 0 2px' }}>{scheduleLabel}</p>
                                                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: 0 }}>{hours > 0 ? `${hours}h pagadas${lunchMinutes ? ' + 1h comida' : ''}` : 'Sin turno'}</p>
                                                    </div>
                                                    <p style={{ color: hours > 0 ? '#34d399' : 'rgba(255,255,255,0.25)', fontWeight: 900, fontSize: 13, margin: 0 }}>{fmt(amount)}</p>
                                                </div>

                                                <input type="text" value={shift.notes} onChange={e => updateShift(staffName, date, { notes: e.target.value })} placeholder="Nota de cambio"
                                                    style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)', color: 'rgba(255,255,255,0.68)', fontSize: 12, outline: 'none' }} />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div style={{ marginTop: 24 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, marginBottom: 14 }}>
                            <div>
                                <p style={{ color: '#F2F2F2', fontSize: 18, fontWeight: 900, margin: '0 0 4px' }}>Reportes semanales guardados</p>
                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: 0 }}>
                                    Historial de semanas guardadas con horas, detalle diario y pago por colaborador.
                                </p>
                            </div>
                            <button onClick={loadReports} disabled={loadingReports}
                                style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.25)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', cursor: loadingReports ? 'default' : 'pointer', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <RefreshCw size={12} /> {loadingReports ? 'Cargando...' : 'Actualizar reportes'}
                            </button>
                        </div>

                        {loadingReports ? (
                            <div style={{ ...glass, padding: 26, textAlign: 'center', color: 'rgba(255,255,255,0.32)', fontSize: 13 }}>Cargando reportes...</div>
                        ) : weeklyReports.length === 0 ? (
                            <div style={{ ...glass, padding: 26, textAlign: 'center', color: 'rgba(255,255,255,0.32)', fontSize: 13 }}>
                                Todavia no hay semanas guardadas para reportar. Guarda la semana actual para crear el primer reporte.
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: 14 }}>
                                {weeklyReports.map(report => (
                                    <div key={report.weekStart} style={{ ...glassHi, padding: 18 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
                                            <div>
                                                <p style={{ color: '#F2F2F2', fontSize: 16, fontWeight: 900, margin: '0 0 4px' }}>
                                                    Semana {new Date(report.weekStart + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })} - {new Date(report.weekEnd + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}
                                                </p>
                                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: 0 }}>
                                                    {report.savedCells}/12 registros guardados · {report.hours} horas totales
                                                </p>
                                            </div>
                                            <div style={{ textAlign: 'right' }}>
                                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10, margin: '0 0 5px', textTransform: 'uppercase', fontWeight: 800 }}>Total a pagar</p>
                                                <p style={{ color: '#34d399', fontSize: 22, fontWeight: 900, margin: 0 }}>{fmt(report.total)}</p>
                                            </div>
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}>
                                            {report.employees.map(employee => (
                                                <div key={`${report.weekStart}-${employee.staffName}`} style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                                                        <div>
                                                            <p style={{ color: '#F2F2F2', fontSize: 15, fontWeight: 900, margin: 0 }}>{employee.staffName}</p>
                                                            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: '3px 0 0' }}>{employee.hours} horas · {fmt(hourlyRate)}/h</p>
                                                        </div>
                                                        <p style={{ color: '#34d399', fontSize: 18, fontWeight: 900, margin: 0 }}>{fmt(employee.total)}</p>
                                                    </div>

                                                    <div style={{ display: 'grid', gap: 7 }}>
                                                        {employee.shifts.map(shift => {
                                                            const hours = getShiftHours(shift);
                                                            const lunchMinutes = hours >= 8 ? shift.lunchMinutes : 0;
                                                            return (
                                                                <div key={`${shift.staffName}-${shift.workDate}`} style={{ display: 'grid', gridTemplateColumns: '58px 1fr auto', gap: 8, alignItems: 'center', padding: '7px 8px', borderRadius: 8, background: hours > 0 ? 'rgba(52,211,153,0.06)' : 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                                                    <span style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, fontWeight: 800 }}>{WEEK_DAYS.find(day => addDaysKey(report.weekStart, day.key) === shift.workDate)?.short || shift.workDate.slice(5)}</span>
                                                                    <span style={{ color: hours > 0 ? '#F2F2F2' : 'rgba(255,255,255,0.32)', fontSize: 11, fontWeight: 700 }}>
                                                                        {buildTimeLabel(shift.startTime, hours, lunchMinutes)}
                                                                    </span>
                                                                    <span style={{ color: hours > 0 ? '#34d399' : 'rgba(255,255,255,0.28)', fontSize: 11, fontWeight: 900 }}>{hours}h</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

function GdBalanceTab() {
    const [entries, setEntries] = useState<any[]>([]);
    const [balance, setBalance] = useState(0);
    const [loading, setLoading] = useState(true);
    const [amount, setAmount] = useState('');
    const [entryType, setEntryType] = useState<'charge' | 'payment'>('payment');
    const [description, setDescription] = useState('');
    const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const d = await (await fetch('/api/logistics/gd-balance')).json();
            setEntries(d.entries || []);
            setBalance(d.balance || 0);
        } catch (e) { console.error(e); } finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    async function addEntry() {
        const n = Number(amount);
        if (!n || n <= 0) return;
        setSaving(true);
        try {
            await fetch('/api/logistics/gd-balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: n, entryType, description, entryDate }) });
            setAmount(''); setDescription('');
            await load();
        } finally { setSaving(false); }
    }

    async function removeEntry(id: string) {
        setDeleting(id);
        try {
            await fetch('/api/logistics/gd-balance', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
            await load();
        } finally { setDeleting(null); }
    }

    const charges = entries.filter(e => e.entry_type === 'charge').reduce((s, e) => s + Number(e.amount), 0);
    const payments = entries.filter(e => e.entry_type === 'payment').reduce((s, e) => s + Number(e.amount), 0);

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 22 }}>
                {[{ label: 'Total Cargado', value: fmt(charges), color: '#f87171' },
                { label: 'Total Pagado', value: fmt(payments), color: '#34d399' },
                { label: 'Saldo Pendiente', value: fmt(Math.abs(balance)), color: balance > 0 ? '#fbbf24' : '#34d399' },
                ].map(({ label, value, color }) => (
                    <div key={label} style={{ ...glassHi, padding: '20px 22px' }}>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                        <p style={{ color, fontSize: 26, fontWeight: 700, margin: 0 }}>{value}</p>
                    </div>
                ))}
            </div>

            {/* Add entry form */}
            <div style={{ ...glass, padding: '18px 20px', marginBottom: 18 }}>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, margin: '0 0 12px', textTransform: 'uppercase', fontWeight: 700 }}>Registrar Movimiento</p>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select value={entryType} onChange={e => setEntryType(e.target.value as any)}
                        style={{ padding: '8px 14px', ...glass, color: entryType === 'payment' ? '#34d399' : '#f87171', fontSize: 13, outline: 'none', cursor: 'pointer', fontWeight: 700 }}>
                        <option value="payment">💳 Pago Recibido</option>
                        <option value="charge">📦 Cargo</option>
                    </select>
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Monto ₡"
                        style={{ width: 140, padding: '8px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                    <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="Descripción (opcional)"
                        style={{ flex: 1, minWidth: 140, padding: '8px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                    <input type="date" value={entryDate} onChange={e => setEntryDate(e.target.value)}
                        style={{ padding: '8px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                    <button onClick={addEntry} disabled={!amount || saving}
                        style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.08)', color: '#34d399', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <PlusCircle size={13} /> {saving ? '...' : 'Agregar'}
                    </button>
                </div>
            </div>

            {/* Ledger */}
            {loading ? <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.2)' }}>Cargando...</div> : (
                entries.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.2)' }}>
                        <Wallet size={28} style={{ display: 'block', margin: '0 auto 10px', opacity: 0.3 }} />
                        <p style={{ margin: 0, fontSize: 13 }}>Sin movimientos registrados</p>
                    </div>
                ) : (
                    <div style={{ ...glass, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                                    {['Fecha', 'Tipo', 'Descripción', 'Monto', ''].map(h => (
                                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map((e, idx) => (
                                    <tr key={e.id} style={{ borderBottom: idx < entries.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }} className="lm-table-row">
                                        <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{new Date(e.entry_date + 'T12:00:00').toLocaleDateString('es-CR', { day: '2-digit', month: 'short' })}</td>
                                        <td style={{ padding: '10px 14px' }}><span style={{ padding: '2px 10px', borderRadius: 20, background: e.entry_type === 'payment' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)', color: e.entry_type === 'payment' ? '#34d399' : '#f87171', fontSize: 11, fontWeight: 700 }}>{e.entry_type === 'payment' ? 'Pago' : 'Cargo'}</span></td>
                                        <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.5)' }}>{e.description || '—'}</td>
                                        <td style={{ padding: '10px 14px', color: e.entry_type === 'payment' ? '#34d399' : '#f87171', fontWeight: 700 }}>{e.entry_type === 'payment' ? '-' : '+'}{fmt(Number(e.amount))}</td>
                                        <td style={{ padding: '10px 14px' }}>
                                            <button onClick={() => removeEntry(e.id)} disabled={deleting === e.id}
                                                style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.05)', color: '#f87171', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5 }}>
                                                <Trash2 size={10} /> {deleting === e.id ? '...' : 'Quitar'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )
            )}
        </div>
    );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AccountingPage() {
    const [tab, setTab] = useState<Tab>('resumen');
    const [rates, setRates] = useState<Rates>({ mensajeria_rate: 2600, correos_rate: 2500, handling_rate: 600, salary_daily_rate: 10000 });

    useEffect(() => {
        fetch('/api/logistics/rates').then(r => r.json()).then(d => {
            if (d.rates) setRates({ ...rates, ...d.rates });
        });
    }, []);

    const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
        { id: 'resumen', label: 'Resumen', icon: <TrendingUp size={13} /> },
        { id: 'correos-cr', label: 'Correos de Costa Rica', icon: <Mail size={13} /> },
        { id: 'contra-entregas', label: 'Contra Entregas', icon: <DollarSign size={13} /> },
        { id: 'dias-trabajados', label: 'Días Trabajados', icon: <Calendar size={13} /> },
        { id: 'gd-balance', label: 'Saldo Green Delivery', icon: <Wallet size={13} /> },
    ];

    return (
        <div>
            <div style={{ marginBottom: 24 }}>
                <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Contabilidad de Envíos</h1>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>
                    Mensajería {fmt(rates.mensajeria_rate)} · Correos {fmt(rates.correos_rate)} · Manejo {fmt(rates.handling_rate)}/paq · Salario {fmt(rates.salary_daily_rate)}/día
                </p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {TABS.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: '8px 8px 0 0', border: 'none', borderBottom: tab === t.id ? '2px solid #8b87ff' : '2px solid transparent', background: tab === t.id ? 'rgba(139,135,255,0.08)' : 'transparent', color: tab === t.id ? '#F2F2F2' : 'rgba(255,255,255,0.35)', fontWeight: tab === t.id ? 700 : 400, fontSize: 13, cursor: 'pointer', marginBottom: -1, transition: 'all 0.15s' }}>
                        <span style={{ opacity: 0.7 }}>{t.icon}</span>{t.label}
                    </button>
                ))}
            </div>

            {tab === 'resumen' && <ResumenTab rates={rates} />}
            {tab === 'correos-cr' && <CorreosCRTab />}
            {tab === 'contra-entregas' && <ContraEntregasTab />}
            {tab === 'dias-trabajados' && <DiasTrabajadosScheduleTab dailyRate={rates.salary_daily_rate} />}
            {tab === 'gd-balance' && <GdBalanceTab />}

            <style>{`.lm-table-row:hover{background:rgba(255,255,255,0.03)!important} .lm-btn-accent:hover{background:rgba(139,135,255,0.12)!important;box-shadow:0 0 16px rgba(139,135,255,0.2)}`}</style>
        </div>
    );
}
