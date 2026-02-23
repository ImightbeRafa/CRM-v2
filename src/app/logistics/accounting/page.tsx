'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, TrendingUp, Truck, Mail, FileDown } from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

interface Rates { mensajeria_rate: number; correos_rate: number; handling_rate: number; }

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;
const glassHi = { background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14 } as const;

export default function AccountingPage() {
    const { tenants, getTenantName, getTenantColor } = useTenantConfig();
    const [loading, setLoading] = useState(true);
    const [rates, setRates] = useState<Rates>({ mensajeria_rate: 2600, correos_rate: 2500, handling_rate: 600 });

    interface Row { tenantId: string; tenantName: string; total: number; mensajeria: number; correos: number; unassigned: number; mensajeriaCost: number; correosCost: number; handling: number; contraEntrega: number; }
    const [rows, setRows] = useState<Row[]>([]);
    const [totals, setTotals] = useState({ orders: 0, mensajeria: 0, correos: 0, unassigned: 0, mensajeriaCost: 0, correosCost: 0, handling: 0 });

    useEffect(() => {
        async function load() {
            try {
                const [od, rd] = await Promise.all([fetch('/api/logistics/orders?limit=500'), fetch('/api/logistics/rates')]);
                const orders = (await od.json()).orders || [];
                const r: Rates = (await rd.json()).rates || rates;
                setRates(r);
                const byTenant: Record<string, Row> = {};
                for (const o of orders) {
                    if (!byTenant[o.tenantId]) byTenant[o.tenantId] = { tenantId: o.tenantId, tenantName: getTenantName(o.tenantId), total: 0, mensajeria: 0, correos: 0, unassigned: 0, mensajeriaCost: 0, correosCost: 0, handling: 0, contraEntrega: 0 };
                    const row = byTenant[o.tenantId];
                    row.total++;
                    if (o.lmCarrier === 'mensajeria') {
                        row.mensajeria++; row.mensajeriaCost += r.mensajeria_rate; row.handling += r.handling_rate;
                    } else if (o.lmCarrier === 'correos') {
                        row.correos++; row.correosCost += r.correos_rate; row.handling += r.handling_rate;
                    } else {
                        row.unassigned++; // unassigned → no handling charge
                    }
                    if (o.isContraEntrega) row.contraEntrega++;
                }
                const rowList = Object.values(byTenant).sort((a, b) => b.total - a.total);
                setRows(rowList);
                setTotals({
                    orders: orders.length,
                    mensajeria: rowList.reduce((s, r) => s + r.mensajeria, 0),
                    correos: rowList.reduce((s, r) => s + r.correos, 0),
                    unassigned: rowList.reduce((s, r) => s + r.unassigned, 0),
                    mensajeriaCost: rowList.reduce((s, r) => s + r.mensajeriaCost, 0),
                    correosCost: rowList.reduce((s, r) => s + r.correosCost, 0),
                    handling: rowList.reduce((s, r) => s + r.handling, 0),
                });
            } catch (e) { console.error(e); } finally { setLoading(false); }
        }
        load();
    }, [tenants]);

    function exportCSV() {
        const h = ['Cuenta', 'Total', 'Mensajería', 'Correos', 'Sin Asignar', 'CE', 'Costo Envío', 'Manejo', 'Total'];
        const data = rows.map(r => [r.tenantName, r.total, r.mensajeria, r.correos, r.unassigned, r.contraEntrega, r.mensajeriaCost + r.correosCost, r.handling, r.mensajeriaCost + r.correosCost + r.handling]);
        const csv = [h, ...data].map(r => r.join(',')).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `contabilidad_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    }

    const totalShipping = totals.mensajeriaCost + totals.correosCost;
    const grand = totalShipping + totals.handling;
    const pct = totals.mensajeria + totals.correos > 0 ? Math.round(totals.mensajeria / (totals.mensajeria + totals.correos) * 100) : 50;

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>
                <TrendingUp size={36} style={{ display: 'block', margin: '0 auto 12px' }} />
                <p style={{ margin: 0, fontSize: 14 }}>Cargando contabilidad...</p>
            </div>
        </div>
    );

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
                <div>
                    <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Contabilidad de Envíos</h1>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>
                        Mensajería ₡{rates.mensajeria_rate.toLocaleString()} · Correos ₡{rates.correos_rate.toLocaleString()} · Manejo ₡{rates.handling_rate.toLocaleString()}/paq
                    </p>
                </div>
                <button onClick={exportCSV} style={{ ...glass, display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', color: '#8b87ff', cursor: 'pointer', fontSize: 13, transition: 'all 0.2s' }} className="lm-btn-accent">
                    <FileDown size={14} /> Exportar CSV
                </button>
            </div>

            {/* KPI Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 22 }}>
                {[
                    { label: 'Total Paquetes', value: totals.orders, color: '#8b87ff', icon: <Package size={17} /> },
                    { label: 'Mensajería', value: `${totals.mensajeria} paq`, color: '#8b87ff', icon: <Truck size={17} /> },
                    { label: 'Correos CR', value: `${totals.correos} paq`, color: '#60a5fa', icon: <Mail size={17} /> },
                    { label: 'Gran Total', value: `₡${grand.toLocaleString('es-CR')}`, color: '#34d399', icon: <TrendingUp size={17} /> },
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
                {[
                    { label: 'Costo Mensajería', value: totals.mensajeriaCost, color: '#8b87ff', note: `${totals.mensajeria} × ₡${rates.mensajeria_rate.toLocaleString()}` },
                    { label: 'Costo Correos', value: totals.correosCost, color: '#60a5fa', note: `${totals.correos} × ₡${rates.correos_rate.toLocaleString()}` },
                    { label: 'Total Manejo', value: totals.handling, color: '#34d399', note: `${totals.mensajeria + totals.correos} asignados × ₡${rates.handling_rate.toLocaleString()}` },
                ].map(({ label, value, color, note }) => (
                    <div key={label} style={{ ...glass, padding: '14px 18px', borderColor: `${color}20` }}>
                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10.5, margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</p>
                        <p style={{ color, fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>₡{value.toLocaleString('es-CR')}</p>
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
                {totals.unassigned > 0 && <p style={{ color: '#fbbf24', fontSize: 12, margin: 0 }}>⚠ {totals.unassigned} sin carrier — no incluidos en costo</p>}
            </div>

            {/* Per-tenant table */}
            <div style={{ ...glass, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 14, margin: 0 }}>Desglose por Cuenta</p>
                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, margin: 0 }}>Gran Total: <strong style={{ color: '#34d399' }}>₡{grand.toLocaleString('es-CR')}</strong></p>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            {['Cuenta', 'Total', 'Mensajería', 'Correos', 'Sin Asig.', 'C.E.', 'Costo Envío', 'Manejo', 'Total Costo'].map((h, i) => (
                                <th key={i} style={{ padding: '10px 14px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, idx) => {
                            const tc = getTenantColor(row.tenantId);
                            const rowTotal = row.mensajeriaCost + row.correosCost + row.handling;
                            return (
                                <tr key={row.tenantId} style={{ borderBottom: idx < rows.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }} className="lm-table-row">
                                    <td style={{ padding: '11px 14px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 8, height: 8, borderRadius: '50%', background: tc, flexShrink: 0 }} />
                                            <span style={{ color: '#F2F2F2', fontWeight: 600 }}>{getTenantName(row.tenantId)}</span>
                                        </div>
                                    </td>
                                    <td style={{ padding: '11px 14px', color: '#F2F2F2', fontWeight: 700 }}>{row.total}</td>
                                    <td style={{ padding: '11px 14px' }}><span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(139,135,255,0.15)', color: '#8b87ff', fontWeight: 600, fontSize: 11 }}>{row.mensajeria}</span></td>
                                    <td style={{ padding: '11px 14px' }}><span style={{ padding: '2px 8px', borderRadius: 20, background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontWeight: 600, fontSize: 11 }}>{row.correos}</span></td>
                                    <td style={{ padding: '11px 14px', color: row.unassigned > 0 ? '#fbbf24' : 'rgba(255,255,255,0.25)', fontWeight: row.unassigned > 0 ? 600 : 400 }}>{row.unassigned || '—'}</td>
                                    <td style={{ padding: '11px 14px', color: row.contraEntrega > 0 ? '#fbbf24' : 'rgba(255,255,255,0.2)' }}>{row.contraEntrega || '—'}</td>
                                    <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.5)' }}>₡{(row.mensajeriaCost + row.correosCost).toLocaleString('es-CR')}</td>
                                    <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.4)' }}>₡{row.handling.toLocaleString('es-CR')}</td>
                                    <td style={{ padding: '11px 14px', color: '#34d399', fontWeight: 700 }}>₡{rowTotal.toLocaleString('es-CR')}</td>
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
                            <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.5)', fontWeight: 700 }}>₡{totalShipping.toLocaleString('es-CR')}</td>
                            <td style={{ padding: '11px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 700 }}>₡{totals.handling.toLocaleString('es-CR')}</td>
                            <td style={{ padding: '11px 14px', color: '#34d399', fontWeight: 700 }}>₡{grand.toLocaleString('es-CR')}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <style>{`.lm-table-row:hover{background:rgba(255,255,255,0.03)} .lm-btn-accent:hover{background:rgba(139,135,255,0.12)!important;box-shadow:0 0 16px rgba(139,135,255,0.2)}`}</style>
        </div>
    );
}
