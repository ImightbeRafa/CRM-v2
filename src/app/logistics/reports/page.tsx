'use client';

import { useState, useCallback } from 'react';
import { FileDown, Printer, TrendingUp, Package, Truck, Mail, Calendar, DollarSign, RefreshCw, AlertTriangle, ChevronDown, ChevronRight, CheckSquare, Square, Layers } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;
const glassHi = { background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14 } as const;
const fmt = (n: number) => `₡${(n || 0).toLocaleString('es-CR')}`;
const fmtDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('es-CR', { weekday: 'short', day: '2-digit', month: 'short' });

const MANAGED_IDS = [
    'cmh32z0ol0000k004hvx9tg3p', 'cmhsibjue0004js04gie724nx', 'cmhutd1th0000jp04oqibtz54',
    'cmigornmw0000lb04kl75262e', 'cmjdabz4d0000il04dyc5qmcc', 'cmln5u7k70000ld042qify2og', 'cmh44aerw0006vijg0640vfl0',
    'cmm4pv8fl0000jr045en1nik9',
];

interface ReportEntry { tenantId: string; data: any }

function downloadCSV(content: string, filename: string) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' }));
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export default function ReportsPage() {
    const { getTenantName, getTenantColor } = useTenantConfig();
    const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [staffName, setStaffName] = useState('Marlenn');
    const [reports, setReports] = useState<ReportEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    const toggleTenant = (id: string) => {
        setSelectedTenants(prev =>
            prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
        );
    };

    const toggleAll = () => {
        setSelectedTenants(prev =>
            prev.length === MANAGED_IDS.length ? [] : [...MANAGED_IDS]
        );
    };

    const toggleExpanded = (id: string) => {
        setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const generate = useCallback(async () => {
        if (selectedTenants.length === 0 || !dateFrom || !dateTo) {
            setError('Selecciona al menos una cuenta y el rango de fechas');
            return;
        }
        setLoading(true); setError(''); setReports([]);
        try {
            const settled = await Promise.allSettled(
                selectedTenants.map(async (tenantId) => {
                    const p = new URLSearchParams({ tenantId, dateFrom, dateTo, staffName });
                    const res = await fetch(`/api/logistics/reports?${p}`);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const d = await res.json();
                    if (d.error) throw new Error(d.error);
                    return { tenantId, data: d } as ReportEntry;
                })
            );
            const succeeded = settled.filter((r): r is PromiseFulfilledResult<ReportEntry> => r.status === 'fulfilled').map(r => r.value);
            const failed = settled
                .map((r, i) => r.status === 'rejected' ? getTenantName(selectedTenants[i]) : null)
                .filter(Boolean);

            if (succeeded.length === 0) {
                setError('No se pudo generar ningún reporte. Verifica tu conexión e intenta de nuevo.');
                return;
            }
            setReports(succeeded);
            const expandAll: Record<string, boolean> = {};
            for (const r of succeeded) expandAll[r.tenantId] = true;
            setExpanded(expandAll);
            if (failed.length > 0) {
                setError(`Reportes generados, pero fallaron: ${failed.join(', ')}`);
            }
        } catch (e: any) { setError(e.message || 'Error generando reportes'); }
        finally { setLoading(false); }
    }, [selectedTenants, dateFrom, dateTo, staffName, getTenantName]);

    // --- CSV helpers ---
    function buildAccountCSVRows(r: any, name: string): string[][] {
        return [
            ['REPORTE DE LOGÍSTICA', '', '', ''],
            [`Período: ${dateFrom} al ${dateTo}`, '', '', ''],
            [`Cuenta: ${name}`, '', '', ''],
            ['', '', '', ''],
            ['=== CORREOS DE COSTA RICA ===', '', '', ''],
            ['Paquetes', 'Costo Envío (por orden)', 'Manejo', 'Total'],
            [`${r.correos.packages}`, fmt(r.correos.shippingCost), fmt(r.correos.handlingCost), fmt(r.correos.montoTotal)],
            ['', '', '', ''],
            ['=== GREEN DELIVERY (MENSAJERÍA) ===', '', '', ''],
            ['Fecha', 'Paquetes', 'Colones', 'Contra Entrega'],
            ...r.mensajeria.dailyBreakdown.map((d: any) => [fmtDate(d.date), `${d.packages}`, fmt(d.total), fmt(d.ce)]),
            ['TOTAL', `${r.mensajeria.packages}`, '', fmt(r.mensajeria.ceAmountTotal)],
            ['Costo Recolección', fmt(r.mensajeria.recoleccionCost), '', ''],
            ['', '', '', ''],
            ['=== TOTAL CUENTA ===', '', '', ''],
            ['Envíos', 'Manejo', 'Total Paquetes', 'TOTAL'],
            [fmt(r.totals.shipping), fmt(r.totals.handling), `${r.totals.totalPackages}`, fmt(r.totals.grandTotal - (r.totals.salary ?? 0))],
        ];
    }

    function exportIndividualCSV(entry: ReportEntry) {
        const name = getTenantName(entry.tenantId);
        const rows = buildAccountCSVRows(entry.data, name);
        const csv = rows.map(r => r.join(',')).join('\n');
        downloadCSV(csv, `reporte_${name.replace(/\s+/g, '_')}_${dateFrom}_${dateTo}.csv`);
    }

    function exportAllCSV() {
        if (reports.length === 0) return;
        const allRows: string[][] = [];
        for (const entry of reports) {
            const name = getTenantName(entry.tenantId);
            allRows.push(...buildAccountCSVRows(entry.data, name));
            allRows.push(['', '', '', ''], ['', '', '', '']);
        }
        const combined = computeCombined();
        const salary = reports[0].data.salary;
        allRows.push(
            ['=== RESUMEN COMBINADO ===', '', '', ''],
            ['Total Paquetes', 'Costo Envíos', 'Manejo', 'GRAN TOTAL'],
            [`${combined.totalPackages}`, fmt(combined.shipping), fmt(combined.handling), fmt(combined.grandTotal)],
            ['', '', '', ''],
            ['=== SALARIO ===', '', '', ''],
            ['Colaborador', 'Días', 'Tarifa/día', 'Total'],
            [salary.staffName, `${salary.daysWorked}`, fmt(salary.dailyRate), fmt(salary.total)],
        );
        const csv = allRows.map(r => r.join(',')).join('\n');
        downloadCSV(csv, `reporte_combinado_${dateFrom}_${dateTo}.csv`);
    }

    // --- Combined summary computation ---
    function computeCombined() {
        let totalPackages = 0, shipping = 0, handling = 0, grandTotal = 0;
        let correosPkgs = 0, correosTotal = 0, gdPkgs = 0, gdTotal = 0;
        const dailyMap: Record<string, { date: string; packages: number; total: number; byTenant: Record<string, number> }> = {};

        for (const entry of reports) {
            const d = entry.data;
            totalPackages += d.totals.totalPackages;
            shipping += d.totals.shipping;
            handling += d.totals.handling;
            // Subtract salary to avoid double-counting — salary is shown once, standalone
            grandTotal += d.totals.grandTotal - (d.totals.salary ?? 0);
            correosPkgs += d.correos.packages;
            correosTotal += d.correos.montoTotal;
            gdPkgs += d.mensajeria.packages;
            gdTotal += d.mensajeria.recoleccionCost + d.mensajeria.handlingCost;

            for (const day of d.mensajeria.dailyBreakdown) {
                if (!dailyMap[day.date]) dailyMap[day.date] = { date: day.date, packages: 0, total: 0, byTenant: {} };
                dailyMap[day.date].packages += day.packages;
                dailyMap[day.date].total += day.total;
                dailyMap[day.date].byTenant[entry.tenantId] = (dailyMap[day.date].byTenant[entry.tenantId] || 0) + day.packages;
            }

            for (const order of d.correos.orders || []) {
                const od = new Date(order.timestamp).toISOString().slice(0, 10);
                if (!dailyMap[od]) dailyMap[od] = { date: od, packages: 0, total: 0, byTenant: {} };
                dailyMap[od].packages += 1;
                dailyMap[od].byTenant[entry.tenantId] = (dailyMap[od].byTenant[entry.tenantId] || 0) + 1;
            }
        }

        const dailyBreakdown = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
        return { totalPackages, shipping, handling, grandTotal, correosPkgs, correosTotal, gdPkgs, gdTotal, dailyBreakdown };
    }

    const allSelected = selectedTenants.length === MANAGED_IDS.length;
    const hasReports = reports.length > 0;

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Reportes de Envíos</h1>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>Genera reportes por cuenta y período · Selecciona múltiples cuentas para reportes independientes</p>
            </div>

            {/* Controls */}
            <div style={{ ...glass, padding: '20px 22px', marginBottom: 24 }}>
                {/* Account checkboxes */}
                <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cuentas</label>
                        <button onClick={toggleAll} style={{ background: 'none', border: 'none', color: '#8b87ff', fontSize: 12, cursor: 'pointer', padding: '2px 6px', display: 'flex', alignItems: 'center', gap: 5 }}>
                            {allSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                            {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {MANAGED_IDS.map(id => {
                            const isSelected = selectedTenants.includes(id);
                            const color = getTenantColor(id);
                            return (
                                <button key={id} onClick={() => toggleTenant(id)}
                                    style={{
                                        padding: '7px 14px', borderRadius: 10, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                                        display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
                                        background: isSelected ? `${color}18` : 'rgba(255,255,255,0.03)',
                                        border: `1px solid ${isSelected ? `${color}60` : 'rgba(255,255,255,0.08)'}`,
                                        color: isSelected ? color : 'rgba(255,255,255,0.4)',
                                    }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: isSelected ? color : 'rgba(255,255,255,0.15)', flexShrink: 0 }} />
                                    {getTenantName(id)}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Date range + staff + generate */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                    <div>
                        <label style={{ display: 'block', color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Desde</label>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                            style={{ padding: '9px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8, display: 'block' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Hasta</label>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                            style={{ padding: '9px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', borderRadius: 8, display: 'block' }} />
                    </div>
                    <div>
                        <label style={{ display: 'block', color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Colaborador</label>
                        <select value={staffName} onChange={e => setStaffName(e.target.value)}
                            style={{ padding: '9px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                            {['Marlenn', 'Otro'].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </div>
                    <button onClick={generate} disabled={loading}
                        style={{ padding: '9px 24px', borderRadius: 10, border: '1px solid rgba(139,135,255,0.5)', background: 'rgba(139,135,255,0.12)', color: '#8b87ff', cursor: 'pointer', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s', whiteSpace: 'nowrap', alignSelf: 'flex-end' }}>
                        {loading ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <TrendingUp size={15} />}
                        {loading ? 'Generando...' : `Generar Reporte${selectedTenants.length > 1 ? 's' : ''}`}
                    </button>
                    {selectedTenants.length > 0 && (
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, alignSelf: 'flex-end', paddingBottom: 10 }}>
                            {selectedTenants.length} cuenta{selectedTenants.length !== 1 ? 's' : ''} seleccionada{selectedTenants.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                {error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 10, margin: '10px 0 0' }}>{error}</p>}
            </div>

            {/* Reports */}
            {hasReports && (
                <div id="report-content">
                    {/* Entregado-only notice (once at the top) */}
                    <div style={{ ...glass, padding: '10px 18px', marginBottom: 20, borderColor: 'rgba(96,165,250,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Mail size={13} style={{ color: '#60a5fa', flexShrink: 0 }} />
                        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>Estos reportes solo reflejan órdenes con estado <strong style={{ color: '#34d399' }}>Entregado</strong>. Los costos de envío se contabilizan únicamente al completar la entrega.</p>
                    </div>

                    {/* Individual account reports (accordion) */}
                    {reports.map((entry) => {
                        const r = entry.data;
                        const tenantColor = getTenantColor(entry.tenantId);
                        const tenantName = getTenantName(entry.tenantId);
                        const isExpanded = expanded[entry.tenantId] ?? true;

                        return (
                            <div key={entry.tenantId} style={{ marginBottom: 16 }}>
                                {/* Accordion header */}
                                <div
                                    onClick={() => toggleExpanded(entry.tenantId)}
                                    style={{
                                        ...glassHi, padding: '16px 22px', cursor: 'pointer', userSelect: 'none',
                                        borderColor: `${tenantColor}30`,
                                        borderBottomLeftRadius: isExpanded ? 0 : 14,
                                        borderBottomRightRadius: isExpanded ? 0 : 14,
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        transition: 'all 0.2s',
                                    }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{ color: tenantColor, transition: 'transform 0.2s' }}>
                                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                        </div>
                                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: tenantColor, flexShrink: 0 }} />
                                        <h2 style={{ color: tenantColor, fontSize: 17, fontWeight: 700, margin: 0 }}>{tenantName}</h2>
                                        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                                            {dateFrom} — {dateTo}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <Package size={13} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                            <span style={{ color: tenantColor, fontWeight: 700, fontSize: 14 }}>{r.totals.totalPackages}</span>
                                            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>paq</span>
                                        </div>
                                        <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
                                        <span style={{ color: '#34d399', fontWeight: 700, fontSize: 15 }}>{fmt(r.totals.grandTotal - (r.totals.salary ?? 0))}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); exportIndividualCSV(entry); }}
                                            style={{ ...glass, display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', color: '#34d399', cursor: 'pointer', fontSize: 11, borderColor: 'rgba(52,211,153,0.2)', marginLeft: 6 }}>
                                            <FileDown size={11} /> CSV
                                        </button>
                                    </div>
                                </div>

                                {/* Accordion body */}
                                {isExpanded && (
                                    <div style={{
                                        ...glass, borderTopLeftRadius: 0, borderTopRightRadius: 0,
                                        borderTop: `1px solid ${tenantColor}20`, padding: '20px 22px',
                                    }}>
                                        {/* Warning: Correos orders missing shipping cost */}
                                        {r.correos.pendingCostCount > 0 && (
                                            <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 10, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.3)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                                <AlertTriangle size={15} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
                                                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                                                    <strong style={{ color: '#fbbf24' }}>{r.correos.pendingCostCount}</strong> {r.correos.pendingCostCount === 1 ? 'orden sin' : 'órdenes sin'} costo de envío asignado en <strong style={{ color: '#60a5fa' }}>Contabilidad</strong>.
                                                </p>
                                            </div>
                                        )}

                                        {/* KPI cards */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 18 }}>
                                            {[
                                                { label: 'Total Paquetes', value: r.totals.totalPackages, color: tenantColor, icon: <Package size={14} /> },
                                                { label: 'Costo Envíos', value: fmt(r.totals.shipping), color: '#60a5fa', icon: <Truck size={14} /> },
                                                { label: 'Manejo + Otros', value: fmt(r.totals.handling), color: '#fbbf24', icon: <Package size={14} /> },
                                                { label: 'TOTAL', value: fmt(r.totals.grandTotal - (r.totals.salary ?? 0)), color: '#34d399', icon: <TrendingUp size={14} /> },
                                            ].map(({ label, value, color, icon }) => (
                                                <div key={label} style={{ background: `${color}08`, padding: '14px 16px', borderRadius: 10, border: `1px solid ${color}15` }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9.5, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                                                        <div style={{ color, opacity: 0.5 }}>{icon}</div>
                                                    </div>
                                                    <p style={{ color, fontSize: 18, fontWeight: 700, margin: 0 }}>{value}</p>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Two column: Correos + Mensajería */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
                                            {/* Correos */}
                                            <div style={{ background: 'rgba(96,165,250,0.04)', padding: '16px 18px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.12)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(96,165,250,0.1)' }}>
                                                    <Mail size={14} style={{ color: '#60a5fa' }} />
                                                    <p style={{ color: '#60a5fa', fontWeight: 700, fontSize: 13, margin: 0 }}>Correos de Costa Rica</p>
                                                </div>
                                                {[
                                                    { label: 'Paquetes enviados', value: `${r.correos.packages} paq` },
                                                    { label: 'Costo envío (por orden)', value: fmt(r.correos.shippingCost) },
                                                    { label: `Manejo (${fmt(r.correos.handlingRate)} × ${r.correos.packages})`, value: fmt(r.correos.handlingCost) },
                                                ].map(({ label, value }) => (
                                                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12.5 }}>{label}</span>
                                                        <span style={{ color: '#F2F2F2', fontWeight: 600, fontSize: 12.5 }}>{value}</span>
                                                    </div>
                                                ))}
                                                {r.correos.pendingCostCount > 0 && (
                                                    <div style={{ padding: '6px 0 2px', display: 'flex', alignItems: 'center', gap: 5 }}>
                                                        <span style={{ color: '#fbbf24', fontSize: 11 }}>⚠ {r.correos.pendingCostCount} sin costo asignado</span>
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 4 }}>
                                                    <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 12.5 }}>Monto Total</span>
                                                    <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 15 }}>{fmt(r.correos.montoTotal)}</span>
                                                </div>
                                            </div>

                                            {/* Green Delivery */}
                                            <div style={{ background: 'rgba(139,135,255,0.04)', padding: '16px 18px', borderRadius: 10, border: '1px solid rgba(139,135,255,0.12)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(139,135,255,0.1)' }}>
                                                    <Truck size={14} style={{ color: '#8b87ff' }} />
                                                    <p style={{ color: '#8b87ff', fontWeight: 700, fontSize: 13, margin: 0 }}>Green Delivery (Mensajería)</p>
                                                </div>
                                                {[
                                                    { label: 'Paquetes', value: `${r.mensajeria.packages} paq` },
                                                    { label: 'Costo recolección (flat)', value: fmt(r.mensajeria.recoleccionCost) },
                                                    { label: `Manejo (${fmt(r.mensajeria.handlingRate)} × ${r.mensajeria.packages})`, value: fmt(r.mensajeria.handlingCost) },
                                                    { label: 'CE — órdenes', value: `${r.mensajeria.ceOrders} (${r.mensajeria.ceCollected} cobradas)` },
                                                    { label: 'CE — monto total', value: fmt(r.mensajeria.ceAmountTotal) },
                                                ].map(({ label, value }) => (
                                                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                                        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12.5 }}>{label}</span>
                                                        <span style={{ color: '#F2F2F2', fontWeight: 600, fontSize: 12.5 }}>{value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Per-day breakdown for mensajería */}
                                        {r.mensajeria.dailyBreakdown.length > 0 && (
                                            <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                                                <div style={{ padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,0.02)' }}>
                                                    <Calendar size={12} style={{ color: '#8b87ff' }} />
                                                    <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 12.5, margin: 0 }}>Desglose Diario — Green Delivery</p>
                                                </div>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                                    <thead>
                                                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                            {['Fecha', 'Paquetes', 'Colones', 'Contra Entrega'].map(h => (
                                                                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {r.mensajeria.dailyBreakdown.map((d: any, idx: number) => (
                                                            <tr key={d.date} style={{ borderBottom: idx < r.mensajeria.dailyBreakdown.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }} className="lm-table-row">
                                                                <td style={{ padding: '7px 14px', color: '#F2F2F2', fontWeight: 600, textTransform: 'capitalize' }}>{fmtDate(d.date)}</td>
                                                                <td style={{ padding: '7px 14px', color: '#8b87ff', fontWeight: 700 }}>{d.packages}</td>
                                                                <td style={{ padding: '7px 14px', color: 'rgba(255,255,255,0.6)' }}>{fmt(d.total)}</td>
                                                                <td style={{ padding: '7px 14px', color: d.ce > 0 ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}>{d.ce > 0 ? fmt(d.ce) : '—'}</td>
                                                            </tr>
                                                        ))}
                                                        <tr style={{ borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
                                                            <td style={{ padding: '8px 14px', color: 'rgba(255,255,255,0.5)', fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase' }}>TOTAL</td>
                                                            <td style={{ padding: '8px 14px', color: '#8b87ff', fontWeight: 700 }}>{r.mensajeria.packages}</td>
                                                            <td style={{ padding: '8px 14px', color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>
                                                                {fmt(r.mensajeria.dailyBreakdown.reduce((s: number, d: any) => s + d.total, 0))}
                                                            </td>
                                                            <td style={{ padding: '8px 14px', color: '#fbbf24', fontWeight: 700 }}>{fmt(r.mensajeria.ceAmountTotal)}</td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Combined Summary */}
                    {reports.length > 0 && (() => {
                        const combined = computeCombined();
                        const salary = reports[0].data.salary;

                        return (
                            <>
                                {/* Resumen General */}
                                <div style={{ ...glassHi, padding: '24px 26px', marginBottom: 16, marginTop: 28, borderColor: 'rgba(139,135,255,0.25)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <Layers size={18} style={{ color: '#8b87ff' }} />
                                            <h2 style={{ color: '#F2F2F2', fontSize: 18, fontWeight: 700, margin: 0 }}>Resumen Combinado</h2>
                                            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                                                {reports.length} cuenta{reports.length !== 1 ? 's' : ''} · {dateFrom} — {dateTo}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button onClick={exportAllCSV} style={{ ...glass, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', color: '#34d399', cursor: 'pointer', fontSize: 12, borderColor: 'rgba(52,211,153,0.2)' }}>
                                                <FileDown size={12} /> Exportar Todo
                                            </button>
                                            <button onClick={() => window.print()} style={{ ...glass, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', color: '#60a5fa', cursor: 'pointer', fontSize: 12, borderColor: 'rgba(96,165,250,0.2)' }}>
                                                <Printer size={12} /> Imprimir
                                            </button>
                                        </div>
                                    </div>

                                    {/* Combined KPIs */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                                        {[
                                            { label: 'Total Paquetes', value: combined.totalPackages, color: '#8b87ff', icon: <Package size={15} /> },
                                            { label: 'Costo Envíos', value: fmt(combined.shipping), color: '#60a5fa', icon: <Truck size={15} /> },
                                            { label: 'Manejo + Otros', value: fmt(combined.handling), color: '#fbbf24', icon: <Package size={15} /> },
                                            { label: 'GRAN TOTAL', value: fmt(combined.grandTotal), color: '#34d399', icon: <TrendingUp size={15} /> },
                                        ].map(({ label, value, color, icon }) => (
                                            <div key={label} style={{ ...glassHi, padding: '16px 18px', borderColor: `${color}20` }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                                                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                                                    <div style={{ color, opacity: 0.6 }}>{icon}</div>
                                                </div>
                                                <p style={{ color, fontSize: 22, fontWeight: 700, margin: 0 }}>{value}</p>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Per-account breakdown */}
                                    <div style={{ marginBottom: 20 }}>
                                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 10px' }}>Por Cuenta</p>
                                        <div style={{ display: 'grid', gap: 6 }}>
                                            {reports.map(entry => {
                                                const color = getTenantColor(entry.tenantId);
                                                return (
                                                    <div key={entry.tenantId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                                            <span style={{ color: '#F2F2F2', fontSize: 13, fontWeight: 600 }}>{getTenantName(entry.tenantId)}</span>
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                                            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{entry.data.totals.totalPackages} paq</span>
                                                            <span style={{ color, fontWeight: 700, fontSize: 13 }}>{fmt(entry.data.totals.grandTotal - (entry.data.totals.salary ?? 0))}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Combined daily breakdown */}
                                    {combined.dailyBreakdown.length > 0 && (
                                        <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                                            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)' }}>
                                                <Calendar size={14} style={{ color: '#8b87ff' }} />
                                                <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13, margin: 0 }}>Paquetes por Día — Todas las Cuentas</p>
                                            </div>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                        <th style={{ padding: '9px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Fecha</th>
                                                        <th style={{ padding: '9px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>Total Paquetes</th>
                                                        {reports.map(entry => (
                                                            <th key={entry.tenantId} style={{ padding: '9px 14px', textAlign: 'left', color: getTenantColor(entry.tenantId), fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>
                                                                {getTenantName(entry.tenantId)}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {combined.dailyBreakdown.map((d, idx) => (
                                                        <tr key={d.date} style={{ borderBottom: idx < combined.dailyBreakdown.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }} className="lm-table-row">
                                                            <td style={{ padding: '7px 14px', color: '#F2F2F2', fontWeight: 600, textTransform: 'capitalize' }}>{fmtDate(d.date)}</td>
                                                            <td style={{ padding: '7px 14px', color: '#8b87ff', fontWeight: 700 }}>{d.packages}</td>
                                                            {reports.map(entry => (
                                                                <td key={entry.tenantId} style={{ padding: '7px 14px', color: d.byTenant[entry.tenantId] ? getTenantColor(entry.tenantId) : 'rgba(255,255,255,0.15)', fontWeight: 600 }}>
                                                                    {d.byTenant[entry.tenantId] || '—'}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
                                                        <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.5)', fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase' }}>TOTAL</td>
                                                        <td style={{ padding: '9px 14px', color: '#8b87ff', fontWeight: 700 }}>{combined.totalPackages}</td>
                                                        {reports.map(entry => (
                                                            <td key={entry.tenantId} style={{ padding: '9px 14px', color: getTenantColor(entry.tenantId), fontWeight: 700 }}>
                                                                {entry.data.totals.totalPackages}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>

                                {/* Salary (standalone, once) */}
                                <div style={{ ...glass, padding: '20px 22px', marginBottom: 20, borderColor: 'rgba(52,211,153,0.15)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(52,211,153,0.12)' }}>
                                        <DollarSign size={15} style={{ color: '#34d399' }} />
                                        <p style={{ color: '#34d399', fontWeight: 700, fontSize: 14, margin: 0 }}>Salario — {salary.staffName}</p>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                        {[
                                            { label: 'Días Trabajados', value: salary.daysWorked },
                                            { label: 'Tarifa Diaria', value: fmt(salary.dailyRate) },
                                            { label: 'Total Salario', value: fmt(salary.total) },
                                        ].map(({ label, value }) => (
                                            <div key={label} style={{ background: 'rgba(52,211,153,0.05)', padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(52,211,153,0.1)' }}>
                                                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5, margin: '0 0 8px', textTransform: 'uppercase' }}>{label}</p>
                                                <p style={{ color: '#34d399', fontWeight: 700, fontSize: 18, margin: 0 }}>{value}</p>
                                            </div>
                                        ))}
                                    </div>
                                    {salary.workDays.length > 0 && (
                                        <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            {salary.workDays.map((d: any) => (
                                                <span key={d.id} style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.15)', color: '#34d399', fontSize: 11 }}>
                                                    {fmtDate(d.work_date)}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Grand Total Summary Box */}
                                <div style={{ ...glassHi, padding: '24px 26px', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.04)' }}>
                                    <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, margin: '0 0 16px' }}>Total a Pagar — Todas las Cuentas</p>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
                                        {[
                                            { label: 'Envíos', value: combined.shipping, color: '#60a5fa' },
                                            { label: 'Manejo + Otros', value: combined.handling, color: '#8b87ff' },
                                            { label: 'Salario', value: salary.total, color: '#34d399' },
                                            { label: 'Logística Total', value: combined.grandTotal, color: '#fbbf24' },
                                        ].map(({ label, value, color }) => (
                                            <div key={label}>
                                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: '0 0 4px' }}>{label}</p>
                                                <p style={{ color, fontSize: 16, fontWeight: 700, margin: 0 }}>{fmt(value)}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ borderTop: '1px solid rgba(52,211,153,0.2)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: 700, margin: 0 }}>GRAN TOTAL (Logística + Salario)</p>
                                        <p style={{ color: '#34d399', fontSize: 28, fontWeight: 700, margin: 0 }}>{fmt(combined.grandTotal + salary.total)}</p>
                                    </div>
                                </div>
                            </>
                        );
                    })()}
                </div>
            )}

            <style>{`
                .lm-table-row:hover{background:rgba(255,255,255,0.03)!important}
                @keyframes spin{to{transform:rotate(360deg)}}
                @media print {
                    body { background: white !important; color: black !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    aside, nav { display: none !important; }
                    #report-content { padding: 20px; }
                    * { background: white !important; border-color: #ddd !important; }
                    h1, h2, p, span, td, th { color: #1a1a1a !important; }
                    button { display: none !important; }
                }
            `}</style>
        </div>
    );
}
