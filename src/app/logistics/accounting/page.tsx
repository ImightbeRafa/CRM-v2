'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, TrendingUp, Truck, Mail, FileDown, CheckCircle, Calendar, DollarSign, PlusCircle, Trash2, AlertCircle, Wallet } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

interface Rates { mensajeria_rate: number; correos_rate: number; handling_rate: number; salary_daily_rate: number; }

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;
const glassHi = { background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14 } as const;
const fmt = (n: number) => `₡${n.toLocaleString('es-CR')}`;

type Tab = 'resumen' | 'contra-entregas' | 'dias-trabajados' | 'gd-balance';

// ─── Resumen Tab ──────────────────────────────────────────────────────────────
function ResumenTab({ rates }: { rates: Rates }) {
    const { tenants, getTenantName, getTenantColor } = useTenantConfig();
    const [loading, setLoading] = useState(true);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    interface Row { tenantId: string; tenantName: string; total: number; mensajeria: number; correos: number; unassigned: number; mensajeriaCost: number; correosCost: number; handling: number; contraEntrega: number; }
    const [rows, setRows] = useState<Row[]>([]);
    const [totals, setTotals] = useState({ orders: 0, mensajeria: 0, correos: 0, unassigned: 0, mensajeriaCost: 0, correosCost: 0, handling: 0 });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const p = new URLSearchParams({ limit: '1000' });
            if (dateFrom) p.set('dateFrom', new Date(dateFrom).toISOString());
            if (dateTo) { const d = new Date(dateTo); d.setHours(23, 59, 59); p.set('dateTo', d.toISOString()); }
            const orders = ((await (await fetch(`/api/logistics/orders?${p}`)).json()).orders) || [];
            const byTenant: Record<string, Row> = {};
            for (const o of orders) {
                if (!byTenant[o.tenantId]) byTenant[o.tenantId] = { tenantId: o.tenantId, tenantName: getTenantName(o.tenantId), total: 0, mensajeria: 0, correos: 0, unassigned: 0, mensajeriaCost: 0, correosCost: 0, handling: 0, contraEntrega: 0 };
                const row = byTenant[o.tenantId];
                row.total++;
                if (o.lmCarrier === 'mensajeria') { row.mensajeria++; row.mensajeriaCost += rates.mensajeria_rate; row.handling += rates.handling_rate; }
                else if (o.lmCarrier === 'correos') { row.correos++; row.correosCost += rates.correos_rate; row.handling += rates.handling_rate; }
                else { row.unassigned++; }
                if (o.isContraEntrega) row.contraEntrega++;
            }
            const rowList = Object.values(byTenant).sort((a, b) => b.total - a.total);
            setRows(rowList);
            setTotals({ orders: orders.length, mensajeria: rowList.reduce((s, r) => s + r.mensajeria, 0), correos: rowList.reduce((s, r) => s + r.correos, 0), unassigned: rowList.reduce((s, r) => s + r.unassigned, 0), mensajeriaCost: rowList.reduce((s, r) => s + r.mensajeriaCost, 0), correosCost: rowList.reduce((s, r) => s + r.correosCost, 0), handling: rowList.reduce((s, r) => s + r.handling, 0) });
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
                        { label: 'Costo Correos', value: totals.correosCost, color: '#60a5fa', note: `${totals.correos} × ${fmt(rates.correos_rate)}` },
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
    const [staffName, setStaffName] = useState('Marlenn');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [newDate, setNewDate] = useState('');
    const [adding, setAdding] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

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
            await fetch('/api/logistics/work-days', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffName, workDate: newDate }) });
            setNewDate('');
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

    const daysCount = workDays.length;
    const salaryTotal = daysCount * dailyRate;

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
                        {['Marlenn', 'Otro'].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '7px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>→</span>
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '7px 12px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                    <button onClick={load} style={{ padding: '7px 16px', ...glass, color: '#8b87ff', cursor: 'pointer', fontSize: 13, borderColor: 'rgba(139,135,255,0.2)' }}>Filtrar</button>
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <DollarSign size={14} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                    <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={{ flex: 1, padding: '8px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8 }} />
                    <button onClick={addDay} disabled={!newDate || adding}
                        style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.08)', color: '#34d399', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        <PlusCircle size={13} /> {adding ? 'Agregando...' : 'Agregar Día'}
                    </button>
                </div>
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
                                        <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.6)' }}>{d.staff_name}</td>
                                        <td style={{ padding: '10px 14px', color: '#34d399', fontWeight: 700 }}>{fmt(dailyRate)}</td>
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
            {tab === 'contra-entregas' && <ContraEntregasTab />}
            {tab === 'dias-trabajados' && <DiasTrabajadosTab dailyRate={rates.salary_daily_rate} />}
            {tab === 'gd-balance' && <GdBalanceTab />}

            <style>{`.lm-table-row:hover{background:rgba(255,255,255,0.03)!important} .lm-btn-accent:hover{background:rgba(139,135,255,0.12)!important;box-shadow:0 0 16px rgba(139,135,255,0.2)}`}</style>
        </div>
    );
}
