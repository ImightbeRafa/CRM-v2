'use client';

import { useState, useCallback } from 'react';
import { FileDown, Printer, TrendingUp, Package, Truck, Mail, Calendar, DollarSign, RefreshCw, AlertTriangle } from 'lucide-react';
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

export default function ReportsPage() {
    const { getTenantName } = useTenantConfig();
    const [tenantId, setTenantId] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [staffName, setStaffName] = useState('Marlenn');
    const [report, setReport] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const generate = useCallback(async () => {
        if (!tenantId || !dateFrom || !dateTo) { setError('Selecciona cuenta y rango de fechas'); return; }
        setLoading(true); setError(''); setReport(null);
        try {
            const p = new URLSearchParams({ tenantId, dateFrom, dateTo, staffName });
            const d = await (await fetch(`/api/logistics/reports?${p}`)).json();
            if (d.error) throw new Error(d.error);
            setReport(d);
        } catch (e: any) { setError(e.message || 'Error generando reporte'); }
        finally { setLoading(false); }
    }, [tenantId, dateFrom, dateTo, staffName]);

    function exportCSV() {
        if (!report) return;
        const r = report;
        const rows = [
            ['REPORTE DE LOGÍSTICA', '', '', ''],
            [`Período: ${dateFrom} al ${dateTo}`, '', '', ''],
            [`Cuenta: ${getTenantName(tenantId)}`, '', '', ''],
            ['', '', '', ''],
            ['=== CORREOS DE COSTA RICA ===', '', '', ''],
            ['Paquetes', 'Costo Envío (por orden)', 'Manejo', 'Total'],
            [r.correos.packages, fmt(r.correos.shippingCost), fmt(r.correos.handlingCost), fmt(r.correos.montoTotal)],
            ['', '', '', ''],
            ['=== GREEN DELIVERY (MENSAJERÍA) ===', '', '', ''],
            ['Fecha', 'Paquetes', 'Colones', 'Contra Entrega'],
            ...r.mensajeria.dailyBreakdown.map((d: any) => [fmtDate(d.date), d.packages, fmt(d.total), fmt(d.ce)]),
            ['TOTAL', r.mensajeria.packages, '', fmt(r.mensajeria.ceAmountTotal)],
            ['Costo Recolección', fmt(r.mensajeria.recoleccionCost), '', ''],
            ['', '', '', ''],
            ['=== SALARIO ===', '', '', ''],
            ['Colaborador', 'Días', 'Tarifa/día', 'Total'],
            [r.salary.staffName, r.salary.daysWorked, fmt(r.salary.dailyRate), fmt(r.salary.total)],
            ['', '', '', ''],
            ['=== TOTAL GENERAL ===', '', '', ''],
            ['Envíos', 'Manejo', 'Salario', 'TOTAL'],
            [fmt(r.totals.shipping), fmt(r.totals.handling), fmt(r.totals.salary), fmt(r.totals.grandTotal)],
        ];
        const csv = rows.map(r => (Array.isArray(r) ? r : [r]).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `reporte_${getTenantName(tenantId).replace(/\s+/g, '_')}_${dateFrom}_${dateTo}.csv`;
        a.click();
    }

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Reportes de Envíos</h1>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>Genera reportes por cuenta y período · Equivalente a tus hojas semanales</p>
            </div>

            {/* Controls */}
            <div style={{ ...glass, padding: '20px 22px', marginBottom: 24 }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                        <label style={{ display: 'block', color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Cuenta</label>
                        <select value={tenantId} onChange={e => setTenantId(e.target.value)}
                            style={{ width: '100%', padding: '9px 14px', ...glass, color: tenantId ? '#F2F2F2' : 'rgba(255,255,255,0.3)', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                            <option value="">Seleccionar cuenta...</option>
                            {MANAGED_IDS.map(id => <option key={id} value={id}>{getTenantName(id)}</option>)}
                        </select>
                    </div>
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
                        {loading ? 'Generando...' : 'Generar Reporte'}
                    </button>
                </div>
                {error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 10, margin: '10px 0 0' }}>{error}</p>}
            </div>

            {report && (
                <div id="report-content">
                    {/* Report Header */}
                    <div style={{ ...glassHi, padding: '22px 26px', marginBottom: 20, borderColor: 'rgba(139,135,255,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <h2 style={{ color: '#F2F2F2', fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>{getTenantName(tenantId)}</h2>
                                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>
                                    Período: <strong style={{ color: '#F2F2F2' }}>{dateFrom}</strong> al <strong style={{ color: '#F2F2F2' }}>{dateTo}</strong>
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={exportCSV} style={{ ...glass, display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', color: '#34d399', cursor: 'pointer', fontSize: 13, borderColor: 'rgba(52,211,153,0.2)' }}>
                                    <FileDown size={13} /> CSV
                                </button>
                                <button onClick={() => window.print()} style={{ ...glass, display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', color: '#60a5fa', cursor: 'pointer', fontSize: 13, borderColor: 'rgba(96,165,250,0.2)' }}>
                                    <Printer size={13} /> Imprimir
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Entregado-only notice */}
                    <div style={{ ...glass, padding: '10px 18px', marginBottom: 14, borderColor: 'rgba(96,165,250,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Mail size={13} style={{ color: '#60a5fa', flexShrink: 0 }} />
                        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>Este reporte solo refleja órdenes con estado <strong style={{ color: '#34d399' }}>Entregado</strong>. Los costos de envío se contabilizan únicamente al completar la entrega.</p>
                    </div>

                    {/* Warning: Correos orders missing shipping cost */}
                    {report.correos.pendingCostCount > 0 && (
                        <div style={{ padding: '14px 20px', marginBottom: 16, borderRadius: 12, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.35)', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <AlertTriangle size={18} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
                            <div>
                                <p style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13, margin: '0 0 4px' }}>Costos de Correos CR incompletos</p>
                                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
                                    Hay <strong style={{ color: '#fbbf24' }}>{report.correos.pendingCostCount}</strong> {report.correos.pendingCostCount === 1 ? 'orden de Correos de Costa Rica que no tiene' : 'órdenes de Correos de Costa Rica que no tienen'} un costo de envío asignado en la sección de <strong style={{ color: '#60a5fa' }}>Contabilidad → Correos de Costa Rica</strong>. Los totales de este reporte pueden no reflejar los costos reales hasta que se ingresen todos los montos.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Grand total KPIs */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
                        {[
                            { label: 'Total Paquetes', value: report.totals.totalPackages, color: '#8b87ff', icon: <Package size={16} /> },
                            { label: 'Costo Envíos', value: fmt(report.totals.shipping), color: '#60a5fa', icon: <Truck size={16} /> },
                            { label: 'Manejo + Otros', value: fmt(report.totals.handling), color: '#fbbf24', icon: <Package size={16} /> },
                            { label: 'GRAN TOTAL', value: fmt(report.totals.grandTotal), color: '#34d399', icon: <TrendingUp size={16} /> },
                        ].map(({ label, value, color, icon }) => (
                            <div key={label} style={{ ...glassHi, padding: '18px 20px', borderColor: `${color}20` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                                    <div style={{ color, opacity: 0.6 }}>{icon}</div>
                                </div>
                                <p style={{ color, fontSize: 20, fontWeight: 700, margin: 0 }}>{value}</p>
                            </div>
                        ))}
                    </div>

                    {/* Two column: Correos + Mensajería */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                        {/* Correos */}
                        <div style={{ ...glass, padding: '20px 22px', borderColor: 'rgba(96,165,250,0.2)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(96,165,250,0.15)' }}>
                                <Mail size={16} style={{ color: '#60a5fa' }} />
                                <p style={{ color: '#60a5fa', fontWeight: 700, fontSize: 14, margin: 0 }}>Correos de Costa Rica</p>
                            </div>
                            {[
                                { label: 'Paquetes enviados', value: `${report.correos.packages} paq` },
                                { label: `Costo envío (por orden)`, value: fmt(report.correos.shippingCost) },
                                { label: `Manejo (${fmt(report.correos.handlingRate)} × ${report.correos.packages})`, value: fmt(report.correos.handlingCost) },
                            ].map(({ label, value }) => (
                                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                    <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{label}</span>
                                    <span style={{ color: '#F2F2F2', fontWeight: 600, fontSize: 13 }}>{value}</span>
                                </div>
                            ))}
                            {report.correos.pendingCostCount > 0 && (
                                <div style={{ padding: '8px 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ color: '#fbbf24', fontSize: 12 }}>⚠ {report.correos.pendingCostCount} {report.correos.pendingCostCount === 1 ? 'orden sin' : 'órdenes sin'} costo de envío asignado</span>
                                </div>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', marginTop: 4 }}>
                                <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 13 }}>Monto Total</span>
                                <span style={{ color: '#60a5fa', fontWeight: 700, fontSize: 16 }}>{fmt(report.correos.montoTotal)}</span>
                            </div>
                        </div>

                        {/* Green Delivery */}
                        <div style={{ ...glass, padding: '20px 22px', borderColor: 'rgba(139,135,255,0.2)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(139,135,255,0.15)' }}>
                                <Truck size={16} style={{ color: '#8b87ff' }} />
                                <p style={{ color: '#8b87ff', fontWeight: 700, fontSize: 14, margin: 0 }}>Green Delivery (Mensajería)</p>
                            </div>
                            {[
                                { label: 'Paquetes', value: `${report.mensajeria.packages} paq` },
                                { label: 'Costo recolección (flat)', value: fmt(report.mensajeria.recoleccionCost) },
                                { label: `Manejo (${fmt(report.mensajeria.handlingRate)} × ${report.mensajeria.packages})`, value: fmt(report.mensajeria.handlingCost) },
                                { label: 'CE — órdenes', value: `${report.mensajeria.ceOrders} (${report.mensajeria.ceCollected} cobradas)` },
                                { label: 'CE — monto total', value: fmt(report.mensajeria.ceAmountTotal) },
                            ].map(({ label, value }) => (
                                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                    <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>{label}</span>
                                    <span style={{ color: '#F2F2F2', fontWeight: 600, fontSize: 13 }}>{value}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Per-day breakdown for mensajería */}
                    {report.mensajeria.dailyBreakdown.length > 0 && (
                        <div style={{ ...glass, marginBottom: 20, overflow: 'hidden' }}>
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Calendar size={14} style={{ color: '#8b87ff' }} />
                                <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 14, margin: 0 }}>Desglose Diario — Green Delivery</p>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                        {['Fecha', 'Paquetes', 'Colones', 'Contra Entrega'].map(h => (
                                            <th key={h} style={{ padding: '9px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {report.mensajeria.dailyBreakdown.map((d: any, idx: number) => (
                                        <tr key={d.date} style={{ borderBottom: idx < report.mensajeria.dailyBreakdown.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }} className="lm-table-row">
                                            <td style={{ padding: '9px 16px', color: '#F2F2F2', fontWeight: 600, textTransform: 'capitalize' }}>{fmtDate(d.date)}</td>
                                            <td style={{ padding: '9px 16px', color: '#8b87ff', fontWeight: 700 }}>{d.packages}</td>
                                            <td style={{ padding: '9px 16px', color: 'rgba(255,255,255,0.6)' }}>{fmt(d.total)}</td>
                                            <td style={{ padding: '9px 16px', color: d.ce > 0 ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}>{d.ce > 0 ? fmt(d.ce) : '—'}</td>
                                        </tr>
                                    ))}
                                    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
                                        <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,0.5)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>TOTAL</td>
                                        <td style={{ padding: '10px 16px', color: '#8b87ff', fontWeight: 700 }}>{report.mensajeria.packages}</td>
                                        <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>
                                            {fmt(report.mensajeria.dailyBreakdown.reduce((s: number, d: any) => s + d.total, 0))}
                                        </td>
                                        <td style={{ padding: '10px 16px', color: '#fbbf24', fontWeight: 700 }}>{fmt(report.mensajeria.ceAmountTotal)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Salary Section */}
                    <div style={{ ...glass, padding: '20px 22px', marginBottom: 20, borderColor: 'rgba(52,211,153,0.15)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(52,211,153,0.12)' }}>
                            <DollarSign size={15} style={{ color: '#34d399' }} />
                            <p style={{ color: '#34d399', fontWeight: 700, fontSize: 14, margin: 0 }}>Salario — {report.salary.staffName}</p>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                            {[
                                { label: 'Días Trabajados', value: report.salary.daysWorked },
                                { label: 'Tarifa Diaria', value: fmt(report.salary.dailyRate) },
                                { label: 'Total Salario', value: fmt(report.salary.total) },
                            ].map(({ label, value }) => (
                                <div key={label} style={{ background: 'rgba(52,211,153,0.05)', padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(52,211,153,0.1)' }}>
                                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5, margin: '0 0 8px', textTransform: 'uppercase' }}>{label}</p>
                                    <p style={{ color: '#34d399', fontWeight: 700, fontSize: 18, margin: 0 }}>{value}</p>
                                </div>
                            ))}
                        </div>
                        {report.salary.workDays.length > 0 && (
                            <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                {report.salary.workDays.map((d: any) => (
                                    <span key={d.id} style={{ padding: '3px 10px', borderRadius: 20, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.15)', color: '#34d399', fontSize: 11 }}>
                                        {fmtDate(d.work_date)}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Grand Total Summary Box */}
                    <div style={{ ...glassHi, padding: '24px 26px', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.04)' }}>
                        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, margin: '0 0 16px' }}>Total a Pagar</p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
                            {[
                                { label: 'Correos Total', value: report.correos.montoTotal, color: '#60a5fa' },
                                { label: 'GD Recolección', value: report.mensajeria.recoleccionCost + report.mensajeria.handlingCost, color: '#8b87ff' },
                                { label: 'Salario', value: report.salary.total, color: '#34d399' },
                                { label: 'CE Cobrado', value: report.mensajeria.ceAmountTotal, color: '#fbbf24' },
                            ].map(({ label, value, color }) => (
                                <div key={label}>
                                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: '0 0 4px' }}>{label}</p>
                                    <p style={{ color, fontSize: 16, fontWeight: 700, margin: 0 }}>{fmt(value)}</p>
                                </div>
                            ))}
                        </div>
                        <div style={{ borderTop: '1px solid rgba(52,211,153,0.2)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: 700, margin: 0 }}>GRAN TOTAL</p>
                            <p style={{ color: '#34d399', fontSize: 28, fontWeight: 700, margin: 0 }}>{fmt(report.totals.grandTotal)}</p>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .lm-table-row:hover{background:rgba(255,255,255,0.03)!important}
                @keyframes spin{to{transform:rotate(360deg)}}
                @media print {
                    body { background: white !important; color: black !important; }
                    aside, nav, button { display: none !important; }
                    #report-content { padding: 20px; }
                    * { color: black !important; background: white !important; border-color: #ccc !important; }
                }
            `}</style>
        </div>
    );
}
