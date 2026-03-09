'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
    FileDown, Printer, TrendingUp, Package, Truck, Mail,
    DollarSign, RefreshCw, AlertTriangle, ChevronDown, ChevronRight,
    CheckSquare, Square, Layers, Lock, Unlock, Clock, History,
    X, Check,
} from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

/* ─── Styling constants ────────────────────────────────── */
const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;
const glassHi = { background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14 } as const;
const fmt = (n: number) => `₡${(n || 0).toLocaleString('es-CR')}`;
const fmtDate = (d: string) => {
    try {
        return new Date(d + 'T12:00:00').toLocaleDateString('es-CR', { weekday: 'short', day: '2-digit', month: 'short' });
    } catch { return d; }
};

const MANAGED_IDS = [
    'cmh32z0ol0000k004hvx9tg3p', 'cmhsibjue0004js04gie724nx', 'cmhutd1th0000jp04oqibtz54',
    'cmigornmw0000lb04kl75262e', 'cmjdabz4d0000il04dyc5qmcc', 'cmln5u7k70000ld042qify2og',
    'cmh44aerw0006vijg0640vfl0', 'cmm4pv8fl0000jr045en1nik9',
];

/* ─── Types ───────────────────────────────────────────── */
interface ReportOrder {
    id: string;
    orderId: string;
    customerName: string;
    total: number;
    timestamp: string;
    timestampCR: string;
    dateCR: string;
    province: string | null;
    product: string | null;
    shippingCost: number | null;
    carrier: string;
    isContraEntrega: boolean;
    contraentregaCollected: boolean;
    correosShippingCost: number | null;
    handlingCost: number;
    guiaNumber: string | null;
    trackingNumber: string | null;
    billedWeekId: number | null;
}

interface ReportData {
    period: { dateFrom: string; dateTo: string };
    tenantId: string;
    correos: {
        packages: number; shippingCost: number; pendingCostCount: number;
        handlingRate: number; handlingCost: number; montoTotal: number;
        orders: ReportOrder[];
    };
    mensajeria: {
        packages: number; recoleccionCost: number; handlingRate: number;
        handlingCost: number; dailyBreakdown: { date: string; packages: number; total: number; ce: number }[];
        ceOrders: number; ceCollected: number; ceAmountTotal: number;
        orders: ReportOrder[];
    };
    salary: {
        staffName: string; daysWorked: number; dailyRate: number;
        total: number; workDays: any[];
    };
    totals: {
        totalPackages: number; correosShipping: number; correosHandling: number;
        mensajeriaRecoleccion: number; mensajeriaHandling: number;
        totalShipping: number; totalHandling: number; subtotalLogistics: number;
        salary: number; grandTotal: number;
    };
}

interface ReportEntry { tenantId: string; data: ReportData }

interface BillingWeek {
    id: number; week_start: string; week_end: string;
    finalized_at: string | null; finalized_by: string | null;
    order_count: number; total_amount: number;
}

/* ─── Week utility ────────────────────────────────────── */
function getMonday(d: Date): Date {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d);
    mon.setDate(diff);
    mon.setHours(0, 0, 0, 0);
    return mon;
}

function toLocalDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function generateWeekOptions(count: number): { weekStart: string; weekEnd: string; label: string }[] {
    const weeks: { weekStart: string; weekEnd: string; label: string }[] = [];
    const today = new Date();
    let monday = getMonday(today);

    for (let i = 0; i < count; i++) {
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const ws = toLocalDateStr(monday);
        const we = toLocalDateStr(sunday);

        const label = `${fmtDate(ws)} — ${fmtDate(we)}`;
        weeks.push({ weekStart: ws, weekEnd: we, label });

        monday = new Date(monday);
        monday.setDate(monday.getDate() - 7);
    }

    return weeks;
}

function csvEscape(field: string): string {
    if (/[",\n\r]/.test(field)) return `"${field.replace(/"/g, '""')}"`;
    return field;
}

function downloadCSV(content: string, filename: string) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' }));
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/* ─── Main Component ──────────────────────────────────── */
export default function ReportsPage() {
    const { getTenantName, getTenantColor } = useTenantConfig();

    // Tab state
    const [activeTab, setActiveTab] = useState<'reports' | 'history'>('reports');

    // Report controls
    const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
    const weekOptions = useMemo(() => generateWeekOptions(16), []);
    const [selectedWeekIdx, setSelectedWeekIdx] = useState<number>(-1);
    const [staffName, setStaffName] = useState('Marlenn');

    // Report data
    const [reports, setReports] = useState<ReportEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    // Order selection (excludes)
    const [excludedOrders, setExcludedOrders] = useState<Set<string>>(new Set());

    // Confirmation modals
    const [pendingConfirm, setPendingConfirm] = useState<{ orderId: string; orderDisplayId: string } | null>(null);
    const [finalizeConfirm, setFinalizeConfirm] = useState(false);
    const [finalizing, setFinalizing] = useState(false);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    // History state
    const [billingWeeks, setBillingWeeks] = useState<BillingWeek[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyDetail, setHistoryDetail] = useState<{ weekId: number; reports: ReportEntry[] } | null>(null);
    const [revertConfirm, setRevertConfirm] = useState<BillingWeek | null>(null);
    const [revertToken, setRevertToken] = useState('');
    const [reverting, setReverting] = useState(false);

    // Finalized weeks lookup (to mark in dropdown)
    const [finalizedWeekStarts, setFinalizedWeekStarts] = useState<Set<string>>(new Set());

    const selectedWeek = selectedWeekIdx >= 0 ? weekOptions[selectedWeekIdx] : null;

    // ─── Tenant toggles ────────────────────────────────
    const toggleTenant = (id: string) => {
        setSelectedTenants(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
    };
    const toggleAll = () => {
        setSelectedTenants(prev => prev.length === MANAGED_IDS.length ? [] : [...MANAGED_IDS]);
    };
    const toggleExpanded = (id: string) => {
        setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // ─── Load finalized weeks on mount ─────────────────
    const loadFinalizedWeeks = useCallback(async () => {
        try {
            const res = await fetch('/api/logistics/billing-weeks?status=finalized&limit=100');
            if (!res.ok) return;
            const data = await res.json();
            const starts = new Set<string>(data.weeks.map((w: BillingWeek) => w.week_start.slice(0, 10)));
            setFinalizedWeekStarts(starts);
        } catch { /* ignore */ }
    }, []);

    // Load finalized weeks on mount
    useEffect(() => { loadFinalizedWeeks(); }, [loadFinalizedWeeks]);

    // ─── Generate Report ───────────────────────────────
    const generate = useCallback(async () => {
        if (selectedTenants.length === 0 || !selectedWeek) {
            setError('Selecciona al menos una cuenta y una semana');
            return;
        }
        setLoading(true); setError(''); setReports([]); setExcludedOrders(new Set());
        try {
            const settled = await Promise.allSettled(
                selectedTenants.map(async (tenantId) => {
                    const p = new URLSearchParams({
                        tenantId,
                        dateFrom: selectedWeek.weekStart,
                        dateTo: selectedWeek.weekEnd,
                        staffName,
                    });
                    const res = await fetch(`/api/logistics/reports?${p}`);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const d = await res.json();
                    if (d.error) throw new Error(d.error);
                    return { tenantId, data: d } as ReportEntry;
                })
            );
            const succeeded = settled
                .filter((r): r is PromiseFulfilledResult<ReportEntry> => r.status === 'fulfilled')
                .map(r => r.value);
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
            await loadFinalizedWeeks();
        } catch (e: any) { setError(e.message || 'Error generando reportes'); }
        finally { setLoading(false); }
    }, [selectedTenants, selectedWeek, staffName, getTenantName, loadFinalizedWeeks]);

    // ─── Get all orders across all reports ──────────────
    const allOrders = useMemo(() => {
        const orders: (ReportOrder & { tenantId: string })[] = [];
        for (const entry of reports) {
            for (const o of entry.data.correos.orders) orders.push({ ...o, tenantId: entry.tenantId });
            for (const o of entry.data.mensajeria.orders) orders.push({ ...o, tenantId: entry.tenantId });
        }
        return orders;
    }, [reports]);

    const selectedOrders = useMemo(() => allOrders.filter(o => !excludedOrders.has(o.id)), [allOrders, excludedOrders]);

    // ─── Compute selected totals per tenant ─────────────
    const computeTenantTotals = useCallback((entry: ReportEntry) => {
        const hRate = entry.data.correos.handlingRate;
        const allTenantOrders = [...entry.data.correos.orders, ...entry.data.mensajeria.orders];
        const selected = allTenantOrders.filter(o => !excludedOrders.has(o.id));
        const selectedCorreos = selected.filter(o => o.carrier === 'correos');
        const selectedMensajeria = selected.filter(o => o.carrier === 'mensajeria');

        const correosShipping = selectedCorreos.reduce((s, o) => s + (o.correosShippingCost ?? 0), 0);
        const correosHandling = selectedCorreos.length * hRate;
        const mensajeriaRecoleccion = selectedMensajeria.length > 0 ? entry.data.mensajeria.recoleccionCost : 0;
        const mensajeriaHandling = selectedMensajeria.length * hRate;

        const totalShipping = correosShipping + mensajeriaRecoleccion;
        const totalHandling = correosHandling + mensajeriaHandling;
        const subtotal = totalShipping + totalHandling;

        return {
            packages: selected.length,
            correosPackages: selectedCorreos.length,
            mensajeriaPackages: selectedMensajeria.length,
            correosShipping,
            correosHandling,
            mensajeriaRecoleccion,
            mensajeriaHandling,
            totalShipping,
            totalHandling,
            subtotal,
            pendingCost: selectedCorreos.filter(o => o.correosShippingCost == null).length,
            ceOrders: selected.filter(o => o.isContraEntrega).length,
            ceAmount: selected.filter(o => o.isContraEntrega).reduce((s, o) => s + o.total, 0),
        };
    }, [excludedOrders]);

    // ─── Compute combined totals ────────────────────────
    const computeCombined = useCallback(() => {
        let totalPackages = 0, totalShipping = 0, totalHandling = 0, subtotalLogistics = 0;

        const perTenant: { tenantId: string; packages: number; subtotal: number }[] = [];

        for (const entry of reports) {
            const t = computeTenantTotals(entry);
            totalPackages += t.packages;
            totalShipping += t.totalShipping;
            totalHandling += t.totalHandling;
            subtotalLogistics += t.subtotal;
            perTenant.push({ tenantId: entry.tenantId, packages: t.packages, subtotal: t.subtotal });
        }

        const salary = reports.length > 0 ? reports[0].data.salary.total : 0;
        const grandTotal = subtotalLogistics + salary;

        return { totalPackages, totalShipping, totalHandling, subtotalLogistics, salary, grandTotal, perTenant };
    }, [reports, computeTenantTotals]);

    // ─── Exclude order (return to pending) ──────────────
    const handleExcludeOrder = async (orderId: string) => {
        setPendingConfirm(null);
        try {
            const res = await fetch('/api/logistics/orders/return-to-pending', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    orderIds: [orderId],
                    reason: 'Excluido del reporte semanal por el administrador',
                }),
            });
            if (!res.ok) {
                const data = await res.json();
                showToast(data.error || 'Error al cambiar estado', 'error');
                return;
            }
            setExcludedOrders(prev => new Set(prev).add(orderId));
            showToast('Orden devuelta a Pendiente', 'success');
        } catch {
            showToast('Error de conexión', 'error');
        }
    };

    // ─── Finalize week ──────────────────────────────────
    const handleFinalize = async () => {
        if (!selectedWeek) return;
        setFinalizing(true);
        try {
            const orderIds = selectedOrders.map(o => o.id);
            const res = await fetch('/api/logistics/billing-weeks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    weekStart: selectedWeek.weekStart,
                    weekEnd: selectedWeek.weekEnd,
                    orderIds,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error || 'Error al finalizar', 'error');
                return;
            }
            showToast(`Semana finalizada. ${data.billedCount} órdenes facturadas.`, 'success');
            setFinalizeConfirm(false);
            await loadFinalizedWeeks();
            await generate();
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setFinalizing(false);
        }
    };

    // ─── History ────────────────────────────────────────
    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const res = await fetch('/api/logistics/billing-weeks?status=finalized&limit=50');
            if (!res.ok) throw new Error();
            const data = await res.json();
            setBillingWeeks(data.weeks);
        } catch {
            showToast('Error cargando historial', 'error');
        } finally {
            setHistoryLoading(false);
        }
    }, []);

    const loadHistoryDetail = useCallback(async (week: BillingWeek) => {
        try {
            const settled = await Promise.allSettled(
                MANAGED_IDS.map(async (tenantId) => {
                    const p = new URLSearchParams({
                        tenantId,
                        dateFrom: week.week_start.slice(0, 10),
                        dateTo: week.week_end.slice(0, 10),
                        staffName,
                        billedWeekId: String(week.id),
                    });
                    const res = await fetch(`/api/logistics/reports?${p}`);
                    if (!res.ok) return null;
                    const d = await res.json();
                    if (d.error) return null;
                    if (d.totals.totalPackages === 0) return null;
                    return { tenantId, data: d } as ReportEntry;
                })
            );
            const entries = settled
                .filter((r): r is PromiseFulfilledResult<ReportEntry | null> => r.status === 'fulfilled')
                .map(r => r.value)
                .filter((r): r is ReportEntry => r !== null);
            setHistoryDetail({ weekId: week.id, reports: entries });
        } catch {
            showToast('Error cargando detalle', 'error');
        }
    }, [staffName]);

    const handleRevert = async () => {
        if (!revertConfirm) return;
        setReverting(true);
        try {
            const res = await fetch('/api/logistics/billing-weeks/revert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ weekId: revertConfirm.id, confirmToken: revertToken }),
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error || 'Error al revertir', 'error');
                return;
            }
            showToast(`Semana revertida. ${data.revertedOrders} órdenes desbloqueadas.`, 'success');
            setRevertConfirm(null);
            setRevertToken('');
            setHistoryDetail(null);
            await loadHistory();
            await loadFinalizedWeeks();
        } catch {
            showToast('Error de conexión', 'error');
        } finally {
            setReverting(false);
        }
    };

    // ─── Toast ──────────────────────────────────────────
    const showToast = (message: string, type: 'success' | 'error') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4000);
    };

    // ─── CSV Export ─────────────────────────────────────
    function exportAllCSV() {
        if (reports.length === 0 || !selectedWeek) return;
        const rows: string[][] = [];
        rows.push(['REPORTE SEMANAL DE LOGÍSTICA'], [`Semana: ${selectedWeek.label}`], []);

        for (const entry of reports) {
            const name = getTenantName(entry.tenantId);
            const t = computeTenantTotals(entry);
            rows.push([`=== ${name} ===`]);
            rows.push(['Orden', 'Cliente', 'Fecha/Hora', 'Producto', 'Carrier', 'Provincia', 'Total', 'Envío', 'Manejo', 'Guía', 'CE']);
            const allOrd = [...entry.data.correos.orders, ...entry.data.mensajeria.orders]
                .filter(o => !excludedOrders.has(o.id));
            for (const o of allOrd) {
                rows.push([
                    o.orderId, o.customerName, o.timestampCR, o.product ?? '',
                    o.carrier, o.province ?? '', `${o.total}`,
                    `${o.correosShippingCost ?? ''}`, `${o.handlingCost}`,
                    o.guiaNumber ?? '', o.isContraEntrega ? 'Sí' : '',
                ]);
            }
            rows.push([`Subtotal: ${t.packages} paq`, '', '', '', '', '', fmt(t.subtotal)]);
            rows.push([]);
        }

        const combined = computeCombined();
        rows.push(['=== RESUMEN COMBINADO ===']);
        rows.push(['Total Paquetes', 'Envíos', 'Manejo', 'Subtotal Logística', 'Salario', 'GRAN TOTAL']);
        rows.push([
            `${combined.totalPackages}`, fmt(combined.totalShipping), fmt(combined.totalHandling),
            fmt(combined.subtotalLogistics), fmt(combined.salary), fmt(combined.grandTotal),
        ]);

        const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
        downloadCSV(csv, `reporte_semana_${selectedWeek.weekStart}_${selectedWeek.weekEnd}.csv`);
    }

    const allSelected = selectedTenants.length === MANAGED_IDS.length;
    const hasReports = reports.length > 0;
    const isWeekFinalized = selectedWeek ? finalizedWeekStarts.has(selectedWeek.weekStart) : false;

    return (
        <div>
            {/* Toast notification */}
            {toast && (
                <div style={{
                    position: 'fixed', top: 20, right: 20, zIndex: 9999, padding: '12px 20px', borderRadius: 10,
                    background: toast.type === 'success' ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)',
                    border: `1px solid ${toast.type === 'success' ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'}`,
                    color: toast.type === 'success' ? '#34d399' : '#f87171', fontSize: 13, fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 8, backdropFilter: 'blur(12px)',
                }}>
                    {toast.type === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
                    {toast.message}
                </div>
            )}

            {/* Header */}
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Reportes de Envíos</h1>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>
                    Reportes semanales por cuenta · Selecciona, verifica y finaliza cada semana
                </p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 2, marginBottom: 20 }}>
                {([['reports', 'Reportes', <TrendingUp key="r" size={14} />], ['history', 'Historial', <History key="h" size={14} />]] as const).map(([key, label, icon]) => (
                    <button key={key} onClick={() => { setActiveTab(key); if (key === 'history') loadHistory(); }}
                        style={{
                            padding: '10px 22px', borderRadius: '10px 10px 0 0', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: 7, transition: 'all 0.2s', border: 'none',
                            background: activeTab === key ? 'rgba(255,255,255,0.08)' : 'transparent',
                            color: activeTab === key ? '#F2F2F2' : 'rgba(255,255,255,0.35)',
                            borderBottom: activeTab === key ? '2px solid #8b87ff' : '2px solid transparent',
                        }}>
                        {icon} {label}
                    </button>
                ))}
            </div>

            {/* ─── REPORTS TAB ─────────────────────────────────── */}
            {activeTab === 'reports' && (
                <>
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

                        {/* Week selector + staff + generate */}
                        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 16 }}>
                            <div style={{ flex: '1 1 280px' }}>
                                <label style={{ display: 'block', color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>
                                    Semana (Lun — Dom)
                                </label>
                                <select value={selectedWeekIdx} onChange={e => setSelectedWeekIdx(Number(e.target.value))}
                                    style={{ padding: '9px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', cursor: 'pointer', width: '100%', borderRadius: 8 }}>
                                    <option value={-1} style={{ background: '#1a1a2e' }}>— Seleccionar semana —</option>
                                    {weekOptions.map((w, i) => (
                                        <option key={w.weekStart} value={i} style={{ background: '#1a1a2e' }}>
                                            {finalizedWeekStarts.has(w.weekStart) ? '✓ ' : '○ '}{w.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>Colaborador</label>
                                <select value={staffName} onChange={e => setStaffName(e.target.value)}
                                    style={{ padding: '9px 14px', ...glass, color: '#F2F2F2', fontSize: 13, outline: 'none', cursor: 'pointer' }}>
                                    {['Marlenn', 'Otro'].map(n => <option key={n} value={n} style={{ background: '#1a1a2e' }}>{n}</option>)}
                                </select>
                            </div>
                            <button onClick={generate} disabled={loading}
                                style={{ padding: '9px 24px', borderRadius: 10, border: '1px solid rgba(139,135,255,0.5)', background: 'rgba(139,135,255,0.12)', color: '#8b87ff', cursor: loading ? 'wait' : 'pointer', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s', whiteSpace: 'nowrap', alignSelf: 'flex-end', opacity: loading ? 0.6 : 1 }}>
                                {loading ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <TrendingUp size={15} />}
                                {loading ? 'Generando...' : 'Generar Reporte'}
                            </button>
                            {selectedTenants.length > 0 && selectedWeek && (
                                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, alignSelf: 'flex-end', paddingBottom: 10 }}>
                                    {selectedTenants.length} cuenta{selectedTenants.length !== 1 ? 's' : ''} · {selectedWeek.label}
                                </span>
                            )}
                        </div>
                        {error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 10, margin: '10px 0 0' }}>{error}</p>}
                    </div>

                    {/* Finalized week notice */}
                    {hasReports && isWeekFinalized && (
                        <div style={{ ...glass, padding: '10px 18px', marginBottom: 20, borderColor: 'rgba(52,211,153,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Lock size={13} style={{ color: '#34d399', flexShrink: 0 }} />
                            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>
                                Esta semana ya fue <strong style={{ color: '#34d399' }}>finalizada</strong>. Las órdenes están bloqueadas. Para modificar, revierta desde el Historial.
                            </p>
                        </div>
                    )}

                    {/* Entregado-only notice */}
                    {hasReports && !isWeekFinalized && (
                        <div style={{ ...glass, padding: '10px 18px', marginBottom: 20, borderColor: 'rgba(96,165,250,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Mail size={13} style={{ color: '#60a5fa', flexShrink: 0 }} />
                            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>
                                Solo órdenes con estado <strong style={{ color: '#34d399' }}>Entregado</strong> y <strong style={{ color: '#fbbf24' }}>no facturadas</strong>.
                                Desmarca una orden para devolverla a Pendiente.
                            </p>
                        </div>
                    )}

                    {/* Per-tenant reports */}
                    {hasReports && (
                        <div id="report-content">
                            {reports.map((entry) => {
                                const r = entry.data;
                                const tenantColor = getTenantColor(entry.tenantId);
                                const tenantName = getTenantName(entry.tenantId);
                                const isExpanded = expanded[entry.tenantId] ?? true;
                                const t = computeTenantTotals(entry);
                                const allTenantOrders = [...r.correos.orders, ...r.mensajeria.orders]
                                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                                return (
                                    <div key={entry.tenantId} style={{ marginBottom: 16 }}>
                                        {/* Accordion header */}
                                        <div onClick={() => toggleExpanded(entry.tenantId)}
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
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>
                                                    {t.packages} de {allTenantOrders.length} seleccionadas
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <Package size={13} style={{ color: 'rgba(255,255,255,0.3)' }} />
                                                    <span style={{ color: tenantColor, fontWeight: 700, fontSize: 14 }}>{t.packages}</span>
                                                    <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>paq</span>
                                                </div>
                                                <span style={{ color: 'rgba(255,255,255,0.1)' }}>|</span>
                                                <span style={{ color: '#34d399', fontWeight: 700, fontSize: 15 }}>{fmt(t.subtotal)}</span>
                                            </div>
                                        </div>

                                        {/* Accordion body */}
                                        {isExpanded && (
                                            <div style={{ ...glass, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: `1px solid ${tenantColor}20`, padding: '20px 22px' }}>
                                                {/* Pending cost warning */}
                                                {t.pendingCost > 0 && (
                                                    <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 8, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                        <AlertTriangle size={13} style={{ color: '#fbbf24', flexShrink: 0 }} />
                                                        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                                                            <strong style={{ color: '#fbbf24' }}>{t.pendingCost}</strong> orden(es) de Correos sin costo de envío asignado.
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Cost breakdown cards */}
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
                                                    {[
                                                        { label: 'Paquetes', value: `${t.packages}`, sub: `${t.correosPackages} correos · ${t.mensajeriaPackages} mensajería`, color: tenantColor },
                                                        { label: 'Envíos', value: fmt(t.totalShipping), sub: `Correos: ${fmt(t.correosShipping)} + Recol: ${fmt(t.mensajeriaRecoleccion)}`, color: '#60a5fa' },
                                                        { label: `Manejo (${fmt(r.correos.handlingRate)} × ${t.packages})`, value: fmt(t.totalHandling), sub: `Correos: ${fmt(t.correosHandling)} + GD: ${fmt(t.mensajeriaHandling)}`, color: '#fbbf24' },
                                                        { label: 'Subtotal Cuenta', value: fmt(t.subtotal), sub: `${fmt(t.totalShipping)} + ${fmt(t.totalHandling)}`, color: '#34d399' },
                                                    ].map(({ label, value, sub, color }) => (
                                                        <div key={label} style={{ background: `${color}08`, padding: '12px 14px', borderRadius: 10, border: `1px solid ${color}15` }}>
                                                            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                                                            <p style={{ color, fontSize: 17, fontWeight: 700, margin: '0 0 4px' }}>{value}</p>
                                                            <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, margin: 0 }}>{sub}</p>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* CE summary if any */}
                                                {t.ceOrders > 0 && (
                                                    <div style={{ padding: '8px 14px', marginBottom: 14, borderRadius: 8, background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.12)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                                                        <DollarSign size={12} style={{ color: '#fbbf24' }} />
                                                        <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                                                            Contra Entrega: <strong style={{ color: '#fbbf24' }}>{t.ceOrders}</strong> orden(es) · Monto: <strong style={{ color: '#fbbf24' }}>{fmt(t.ceAmount)}</strong>
                                                        </span>
                                                    </div>
                                                )}

                                                {/* Order table */}
                                                {allTenantOrders.length > 0 && (
                                                    <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.06)' }}>
                                                        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                                                <Package size={12} style={{ color: tenantColor }} />
                                                                <span style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 12.5 }}>Detalle de Órdenes</span>
                                                            </div>
                                                            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11 }}>
                                                                {t.packages} de {allTenantOrders.length} seleccionadas
                                                            </span>
                                                        </div>
                                                        <div style={{ overflowX: 'auto' }}>
                                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 900 }}>
                                                                <thead>
                                                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                                        {['', 'Orden', 'Cliente', 'Fecha y Hora', 'Producto', 'Carrier', 'Provincia', 'Total', 'Envío', 'Manejo', 'Guía', 'CE'].map(h => (
                                                                            <th key={h} style={{ padding: '7px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 9.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {allTenantOrders.map((o, idx) => {
                                                                        const isExcluded = excludedOrders.has(o.id);
                                                                        return (
                                                                            <tr key={o.id}
                                                                                style={{
                                                                                    borderBottom: idx < allTenantOrders.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                                                                                    opacity: isExcluded ? 0.3 : 1,
                                                                                    textDecoration: isExcluded ? 'line-through' : 'none',
                                                                                }}
                                                                                className="lm-table-row">
                                                                                <td style={{ padding: '6px 8px' }}>
                                                                                    {!isExcluded && !isWeekFinalized && (
                                                                                        <button onClick={() => setPendingConfirm({ orderId: o.id, orderDisplayId: o.orderId })}
                                                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#34d399', padding: 2 }}>
                                                                                            <CheckSquare size={14} />
                                                                                        </button>
                                                                                    )}
                                                                                    {isExcluded && (
                                                                                        <span style={{ color: 'rgba(255,255,255,0.15)', padding: 2 }}>
                                                                                            <Square size={14} />
                                                                                        </span>
                                                                                    )}
                                                                                    {isWeekFinalized && !isExcluded && (
                                                                                        <Lock size={12} style={{ color: 'rgba(255,255,255,0.2)' }} />
                                                                                    )}
                                                                                </td>
                                                                                <td style={{ padding: '6px 8px', color: '#F2F2F2', fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }}>{o.orderId}</td>
                                                                                <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.7)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customerName}</td>
                                                                                <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                                        <Clock size={10} style={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />
                                                                                        {o.timestampCR}
                                                                                    </div>
                                                                                </td>
                                                                                <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.5)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.product ?? '—'}</td>
                                                                                <td style={{ padding: '6px 8px' }}>
                                                                                    <span style={{
                                                                                        padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600,
                                                                                        background: o.carrier === 'correos' ? 'rgba(96,165,250,0.12)' : 'rgba(139,135,255,0.12)',
                                                                                        color: o.carrier === 'correos' ? '#60a5fa' : '#8b87ff',
                                                                                        border: `1px solid ${o.carrier === 'correos' ? 'rgba(96,165,250,0.25)' : 'rgba(139,135,255,0.25)'}`,
                                                                                    }}>
                                                                                        {o.carrier === 'correos' ? 'Correos' : 'GD'}
                                                                                    </span>
                                                                                </td>
                                                                                <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{o.province ?? '—'}</td>
                                                                                <td style={{ padding: '6px 8px', color: '#F2F2F2', fontWeight: 600 }}>{fmt(o.total)}</td>
                                                                                <td style={{ padding: '6px 8px', color: o.correosShippingCost != null ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.2)' }}>
                                                                                    {o.carrier === 'correos' ? (o.correosShippingCost != null ? fmt(o.correosShippingCost) : '⚠ sin costo') : '—'}
                                                                                </td>
                                                                                <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.5)' }}>{fmt(o.handlingCost)}</td>
                                                                                <td style={{ padding: '6px 8px', color: o.guiaNumber ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.15)', fontFamily: 'monospace', fontSize: 10 }}>{o.guiaNumber ?? '—'}</td>
                                                                                <td style={{ padding: '6px 8px' }}>
                                                                                    {o.isContraEntrega && (
                                                                                        <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' }}>CE</span>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* ─── Combined Summary ────────────────────── */}
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
                                                        {reports.length} cuenta{reports.length !== 1 ? 's' : ''} · {selectedWeek?.label}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', gap: 8 }}>
                                                    <button onClick={exportAllCSV} style={{ ...glass, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', color: '#34d399', cursor: 'pointer', fontSize: 12, borderColor: 'rgba(52,211,153,0.2)' }}>
                                                        <FileDown size={12} /> CSV
                                                    </button>
                                                    <button onClick={() => window.print()} style={{ ...glass, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', color: '#60a5fa', cursor: 'pointer', fontSize: 12, borderColor: 'rgba(96,165,250,0.2)' }}>
                                                        <Printer size={12} /> Imprimir
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Combined KPIs */}
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                                                {[
                                                    { label: 'Total Paquetes', value: `${combined.totalPackages}`, color: '#8b87ff', icon: <Package size={15} /> },
                                                    { label: 'Envíos', value: fmt(combined.totalShipping), color: '#60a5fa', icon: <Truck size={15} /> },
                                                    { label: 'Manejo', value: fmt(combined.totalHandling), color: '#fbbf24', icon: <Package size={15} /> },
                                                    { label: 'Subtotal Logística', value: fmt(combined.subtotalLogistics), color: '#34d399', icon: <TrendingUp size={15} /> },
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
                                                    {combined.perTenant.map(pt => {
                                                        const color = getTenantColor(pt.tenantId);
                                                        return (
                                                            <div key={pt.tenantId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                                                    <span style={{ color: '#F2F2F2', fontSize: 13, fontWeight: 600 }}>{getTenantName(pt.tenantId)}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                                                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{pt.packages} paq</span>
                                                                    <span style={{ color, fontWeight: 700, fontSize: 13 }}>{fmt(pt.subtotal)}</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Salary */}
                                        <div style={{ ...glass, padding: '20px 22px', marginBottom: 20, borderColor: 'rgba(52,211,153,0.15)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid rgba(52,211,153,0.12)' }}>
                                                <DollarSign size={15} style={{ color: '#34d399' }} />
                                                <p style={{ color: '#34d399', fontWeight: 700, fontSize: 14, margin: 0 }}>Salario — {salary.staffName}</p>
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                                {[
                                                    { label: 'Días Trabajados', value: `${salary.daysWorked}` },
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

                                        {/* Grand Total + Finalize */}
                                        <div style={{ ...glassHi, padding: '24px 26px', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.04)' }}>
                                            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, margin: '0 0 16px' }}>Total a Pagar — Todas las Cuentas</p>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
                                                {[
                                                    { label: 'Envíos', value: combined.totalShipping, color: '#60a5fa' },
                                                    { label: 'Manejo', value: combined.totalHandling, color: '#8b87ff' },
                                                    { label: 'Salario', value: combined.salary, color: '#34d399' },
                                                    { label: 'Logística Total', value: combined.subtotalLogistics, color: '#fbbf24' },
                                                ].map(({ label, value, color }) => (
                                                    <div key={label}>
                                                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: '0 0 4px' }}>{label}</p>
                                                        <p style={{ color, fontSize: 16, fontWeight: 700, margin: 0 }}>{fmt(value)}</p>
                                                    </div>
                                                ))}
                                            </div>
                                            <div style={{ borderTop: '1px solid rgba(52,211,153,0.2)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, fontWeight: 700, margin: 0 }}>GRAN TOTAL (Logística + Salario)</p>
                                                <p style={{ color: '#34d399', fontSize: 28, fontWeight: 700, margin: 0 }}>{fmt(combined.grandTotal)}</p>
                                            </div>

                                            {/* Finalize button */}
                                            {!isWeekFinalized && selectedOrders.length > 0 && (
                                                <div style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                                                    <button onClick={() => setFinalizeConfirm(true)}
                                                        style={{
                                                            padding: '12px 28px', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700,
                                                            display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.2s',
                                                            background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.4)', color: '#34d399',
                                                        }}>
                                                        <Lock size={15} />
                                                        Finalizar Semana ({selectedOrders.length} órdenes)
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </>
            )}

            {/* ─── HISTORY TAB ────────────────────────────────── */}
            {activeTab === 'history' && (
                <div>
                    {historyLoading && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, textAlign: 'center', padding: 40 }}>Cargando historial...</p>}

                    {!historyLoading && billingWeeks.length === 0 && (
                        <div style={{ ...glass, padding: 40, textAlign: 'center' }}>
                            <History size={32} style={{ color: 'rgba(255,255,255,0.15)', marginBottom: 12 }} />
                            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>No hay semanas finalizadas aún</p>
                        </div>
                    )}

                    {billingWeeks.length > 0 && (
                        <div style={{ ...glass, overflow: 'hidden' }}>
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.02)' }}>
                                <History size={14} style={{ color: '#8b87ff' }} />
                                <span style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13 }}>Semanas Facturadas</span>
                                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>({billingWeeks.length})</span>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                        {['Semana', 'Finalizada', 'Órdenes', 'Monto', 'Acciones'].map(h => (
                                            <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {billingWeeks.map((w, idx) => {
                                        const ws = w.week_start.slice(0, 10);
                                        const we = w.week_end.slice(0, 10);
                                        return (
                                            <tr key={w.id} style={{ borderBottom: idx < billingWeeks.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }} className="lm-table-row">
                                                <td style={{ padding: '10px 16px', color: '#F2F2F2', fontWeight: 600 }}>
                                                    {fmtDate(ws)} — {fmtDate(we)}
                                                </td>
                                                <td style={{ padding: '10px 16px', color: 'rgba(255,255,255,0.5)' }}>
                                                    {w.finalized_at ? new Date(w.finalized_at).toLocaleDateString('es-CR') : '—'}
                                                </td>
                                                <td style={{ padding: '10px 16px', color: '#8b87ff', fontWeight: 700 }}>{w.order_count}</td>
                                                <td style={{ padding: '10px 16px', color: '#34d399', fontWeight: 600 }}>{fmt(w.total_amount)}</td>
                                                <td style={{ padding: '10px 16px' }}>
                                                    <div style={{ display: 'flex', gap: 6 }}>
                                                        <button onClick={() => loadHistoryDetail(w)}
                                                            style={{ ...glass, padding: '4px 12px', color: '#60a5fa', cursor: 'pointer', fontSize: 11, borderColor: 'rgba(96,165,250,0.2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <Package size={10} /> Detalle
                                                        </button>
                                                        <button onClick={() => { setRevertConfirm(w); setRevertToken(''); }}
                                                            style={{ ...glass, padding: '4px 12px', color: '#f87171', cursor: 'pointer', fontSize: 11, borderColor: 'rgba(248,113,113,0.2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <Unlock size={10} /> Revertir
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* History detail view */}
                    {historyDetail && (
                        <div style={{ marginTop: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <h3 style={{ color: '#F2F2F2', fontSize: 16, fontWeight: 700, margin: 0 }}>Detalle de Semana Facturada</h3>
                                <button onClick={() => setHistoryDetail(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 4 }}>
                                    <X size={16} />
                                </button>
                            </div>
                            {historyDetail.reports.map(entry => {
                                const tenantColor = getTenantColor(entry.tenantId);
                                const tenantName = getTenantName(entry.tenantId);
                                const allOrd = [...entry.data.correos.orders, ...entry.data.mensajeria.orders]
                                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

                                return (
                                    <div key={entry.tenantId} style={{ ...glass, padding: '16px 20px', marginBottom: 12 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: tenantColor, flexShrink: 0 }} />
                                            <span style={{ color: tenantColor, fontWeight: 700, fontSize: 14 }}>{tenantName}</span>
                                            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{allOrd.length} órdenes</span>
                                        </div>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 700 }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                        {['Orden', 'Cliente', 'Fecha y Hora', 'Carrier', 'Total', 'Envío', 'Manejo', 'Guía'].map(h => (
                                                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 9, textTransform: 'uppercase' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {allOrd.map(o => (
                                                        <tr key={o.id} className="lm-table-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                                            <td style={{ padding: '5px 8px', color: '#F2F2F2', fontFamily: 'monospace', fontSize: 10 }}>{o.orderId}</td>
                                                            <td style={{ padding: '5px 8px', color: 'rgba(255,255,255,0.6)' }}>{o.customerName}</td>
                                                            <td style={{ padding: '5px 8px', color: 'rgba(255,255,255,0.5)' }}>{o.timestampCR}</td>
                                                            <td style={{ padding: '5px 8px' }}>
                                                                <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: o.carrier === 'correos' ? 'rgba(96,165,250,0.12)' : 'rgba(139,135,255,0.12)', color: o.carrier === 'correos' ? '#60a5fa' : '#8b87ff' }}>
                                                                    {o.carrier === 'correos' ? 'Correos' : 'GD'}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '5px 8px', color: '#F2F2F2', fontWeight: 600 }}>{fmt(o.total)}</td>
                                                            <td style={{ padding: '5px 8px', color: 'rgba(255,255,255,0.5)' }}>{o.correosShippingCost != null ? fmt(o.correosShippingCost) : '—'}</td>
                                                            <td style={{ padding: '5px 8px', color: 'rgba(255,255,255,0.5)' }}>{fmt(o.handlingCost)}</td>
                                                            <td style={{ padding: '5px 8px', color: 'rgba(255,255,255,0.4)', fontFamily: 'monospace', fontSize: 10 }}>{o.guiaNumber ?? '—'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* ─── MODALS ─────────────────────────────────────── */}

            {/* Exclude order confirmation */}
            {pendingConfirm && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
                    onClick={() => setPendingConfirm(null)}>
                    <div style={{ ...glassHi, padding: '28px 32px', maxWidth: 440, width: '90%', borderColor: 'rgba(251,191,36,0.3)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                            <AlertTriangle size={20} style={{ color: '#fbbf24' }} />
                            <h3 style={{ color: '#F2F2F2', fontSize: 16, fontWeight: 700, margin: 0 }}>Excluir Orden</h3>
                        </div>
                        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 1.6, margin: '0 0 20px' }}>
                            Cambiar orden <strong style={{ color: '#F2F2F2' }}>{pendingConfirm.orderDisplayId}</strong> a estado <strong style={{ color: '#fbbf24' }}>Pendiente</strong>?
                            <br />Esta orden no se cobrará y volverá al tablero de envíos.
                        </p>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button onClick={() => setPendingConfirm(null)}
                                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13 }}>
                                Cancelar
                            </button>
                            <button onClick={() => handleExcludeOrder(pendingConfirm.orderId)}
                                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.12)', color: '#fbbf24', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                                Sí, confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Finalize confirmation */}
            {finalizeConfirm && selectedWeek && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
                    onClick={() => !finalizing && setFinalizeConfirm(false)}>
                    <div style={{ ...glassHi, padding: '28px 32px', maxWidth: 500, width: '90%', borderColor: 'rgba(52,211,153,0.3)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                            <Lock size={20} style={{ color: '#34d399' }} />
                            <h3 style={{ color: '#F2F2F2', fontSize: 16, fontWeight: 700, margin: 0 }}>Finalizar Semana</h3>
                        </div>
                        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 1.6, margin: '0 0 16px' }}>
                            Vas a facturar <strong style={{ color: '#34d399' }}>{selectedOrders.length}</strong> órdenes para la semana:
                        </p>
                        <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 16 }}>
                            <p style={{ color: '#F2F2F2', fontSize: 14, fontWeight: 600, margin: '0 0 8px' }}>{selectedWeek.label}</p>
                            {(() => {
                                const combined = computeCombined();
                                return (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                                        <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Órdenes: </span><strong style={{ color: '#8b87ff' }}>{selectedOrders.length}</strong></div>
                                        <div><span style={{ color: 'rgba(255,255,255,0.4)' }}>Logística: </span><strong style={{ color: '#34d399' }}>{fmt(combined.subtotalLogistics)}</strong></div>
                                        {combined.perTenant.map(pt => (
                                            <div key={pt.tenantId}>
                                                <span style={{ color: 'rgba(255,255,255,0.3)' }}>{getTenantName(pt.tenantId)}: </span>
                                                <strong style={{ color: getTenantColor(pt.tenantId) }}>{pt.packages} paq</strong>
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}
                        </div>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: '0 0 16px' }}>
                            Las órdenes quedarán bloqueadas y no aparecerán en futuros reportes.
                        </p>
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button onClick={() => setFinalizeConfirm(false)} disabled={finalizing}
                                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13 }}>
                                Cancelar
                            </button>
                            <button onClick={handleFinalize} disabled={finalizing}
                                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.12)', color: '#34d399', cursor: finalizing ? 'wait' : 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, opacity: finalizing ? 0.6 : 1 }}>
                                {finalizing ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Lock size={13} />}
                                {finalizing ? 'Finalizando...' : 'Finalizar Semana'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Revert confirmation */}
            {revertConfirm && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
                    onClick={() => !reverting && setRevertConfirm(null)}>
                    <div style={{ ...glassHi, padding: '28px 32px', maxWidth: 440, width: '90%', borderColor: 'rgba(248,113,113,0.3)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                            <AlertTriangle size={20} style={{ color: '#f87171' }} />
                            <h3 style={{ color: '#F2F2F2', fontSize: 16, fontWeight: 700, margin: 0 }}>Revertir Semana</h3>
                        </div>
                        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 1.6, margin: '0 0 12px' }}>
                            Esto desbloqueará <strong style={{ color: '#f87171' }}>{revertConfirm.order_count}</strong> órdenes de la semana <strong style={{ color: '#F2F2F2' }}>{fmtDate(revertConfirm.week_start.slice(0, 10))} — {fmtDate(revertConfirm.week_end.slice(0, 10))}</strong>.
                        </p>
                        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, margin: '0 0 16px' }}>
                            Escribe <strong style={{ color: '#f87171' }}>REVERTIR</strong> para confirmar:
                        </p>
                        <input type="text" value={revertToken} onChange={e => setRevertToken(e.target.value)}
                            placeholder="REVERTIR"
                            style={{ width: '100%', padding: '10px 14px', ...glass, color: '#F2F2F2', fontSize: 14, outline: 'none', borderRadius: 8, marginBottom: 16, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', boxSizing: 'border-box' }} />
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button onClick={() => { setRevertConfirm(null); setRevertToken(''); }} disabled={reverting}
                                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13 }}>
                                Cancelar
                            </button>
                            <button onClick={handleRevert} disabled={reverting || revertToken !== 'REVERTIR'}
                                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.12)', color: '#f87171', cursor: (reverting || revertToken !== 'REVERTIR') ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, opacity: (reverting || revertToken !== 'REVERTIR') ? 0.5 : 1 }}>
                                {reverting ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Unlock size={13} />}
                                {reverting ? 'Revirtiendo...' : 'Revertir Semana'}
                            </button>
                        </div>
                    </div>
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
