'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
    FileDown, Printer, TrendingUp, Package, Truck,
    DollarSign, RefreshCw, AlertTriangle, ChevronDown, ChevronRight,
    CheckSquare, Square, Layers, Lock, Unlock, Clock, History,
    X, Check, Calendar,
} from 'lucide-react';
import { useTenantConfig } from '@/hooks/useTenantConfig';

/* ─── Styling constants ────────────────────────────────── */
const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;
const glassHi = { background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 14 } as const;
const fmt = (n: number) => `₡${(n || 0).toLocaleString('es-CR')}`;
const CORREOS_TAX_RATE = 0.13;
const getCorreosTax = (cost: number | null | undefined) => {
    if (cost == null || !Number.isFinite(Number(cost)) || Number(cost) <= 0) return 0;
    return Math.round(Number(cost) * CORREOS_TAX_RATE);
};
const fmtDate = (d: string) => {
    try {
        return new Date(d + 'T12:00:00').toLocaleDateString('es-CR', { weekday: 'short', day: '2-digit', month: 'short' });
    } catch { return d; }
};
const CR_TZ = 'America/Costa_Rica';
const toDateKeyCR = (date = new Date()) => date.toLocaleDateString('en-CA', { timeZone: CR_TZ });
const parseDateKey = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
};
const startOfMonthKey = (key: string) => {
    const date = parseDateKey(key);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
};
const startOfYearKey = (key: string) => `${key.slice(0, 4)}-01-01`;
const previousMonthRange = (key: string) => {
    const date = parseDateKey(startOfMonthKey(key));
    date.setMonth(date.getMonth() - 1);
    const from = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
    const next = parseDateKey(from);
    next.setMonth(next.getMonth() + 1);
    next.setDate(next.getDate() - 1);
    return { from, to: toDateKeyCR(next) };
};
const formatPeriodLabel = (from?: string | null, to?: string | null) => {
    if (!from && !to) return 'Todo el historial';
    if (from && to) return `${fmtDate(from)} - ${fmtDate(to)}`;
    if (from) return `Desde ${fmtDate(from)}`;
    return `Hasta ${fmtDate(to!)}`;
};

const MANAGED_IDS = [
    'cmh32z0ol0000k004hvx9tg3p', 'cmhsibjue0004js04gie724nx', 'cmhutd1th0000jp04oqibtz54',
    'cmigornmw0000lb04kl75262e', 'cmjdabz4d0000il04dyc5qmcc', 'cmln5u7k70000ld042qify2og',
    'cmh44aerw0006vijg0640vfl0', 'cmm4pv8fl0000jr045en1nik9',
];

/* ─── Types ───────────────────────────────────────────── */
type ReportPeriodMode = 'currentWeek' | 'custom';

interface ReportOrder {
    id: string;
    orderId: string;
    customerName: string;
    total: number;
    timestamp: string;
    timestampCR: string;
    dateCR: string;
    reportDate: string;
    reportTimestampCR: string;
    reportDateCR: string;
    province: string | null;
    product: string | null;
    shippingCost: number | null;
    carrier: string;
    isContraEntrega: boolean;
    contraentregaCollected: boolean;
    correosShippingCost: number | null;
    correosTax?: number;
    handlingCost: number;
    isTilopay?: boolean;
    tilopayCommission?: number;
    tilopayTransactionCost?: number;
    tilopayServiceTax?: number;
    tilopayFee?: number;
    guiaNumber: string | null;
    trackingNumber: string | null;
    billedWeekId: number | null;
    completedAt: string | null;
}

interface ReportData {
    period: { dateFrom: string | null; dateTo: string | null };
    tenantId: string;
    correos: {
        packages: number; shippingCost: number; pendingCostCount: number;
        taxRate?: number; taxCost?: number;
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
    tilopay?: {
        orders: number; commissionRate: number; transactionCostRate: number; serviceTaxRate: number;
        commission: number; transactionCost: number; serviceTax: number; total: number;
    };
    totals: {
        totalPackages: number; correosShipping: number; correosHandling: number;
        correosTax?: number;
        mensajeriaRecoleccion: number; mensajeriaHandling: number;
        tilopayFees?: number;
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

/* ─── Utilities ───────────────────────────────────────── */

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

    // Report controls — default to all tenants for the live dashboard
    const [selectedTenants, setSelectedTenants] = useState<string[]>([...MANAGED_IDS]);
    const [staffName, setStaffName] = useState('Ma');
    const [reportMode, setReportMode] = useState<ReportPeriodMode>('currentWeek');
    const [dateFrom, setDateFrom] = useState(() => startOfMonthKey(toDateKeyCR()));
    const [dateTo, setDateTo] = useState(() => toDateKeyCR());

    // Current billing week metadata
    const [weekInfo, setWeekInfo] = useState<{ id: number; week_start: string; week_end: string; finalized_at: string | null } | null>(null);

    // Report data
    const [reports, setReports] = useState<ReportEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});

    // Order selection (excludes)
    const [excludedOrders, setExcludedOrders] = useState<Set<string>>(new Set());

    // Confirmation modals
    const [pendingConfirm, setPendingConfirm] = useState<{ orderId: string; orderDisplayId: string } | null>(null);
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    // History state
    const [billingWeeks, setBillingWeeks] = useState<BillingWeek[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyDetail, setHistoryDetail] = useState<{ weekId: number; reports: ReportEntry[] } | null>(null);
    const [revertConfirm, setRevertConfirm] = useState<BillingWeek | null>(null);
    const [revertToken, setRevertToken] = useState('');
    const [reverting, setReverting] = useState(false);


    const weekLabel = weekInfo
        ? `${fmtDate(weekInfo.week_start.slice(0, 10))} — ${fmtDate(weekInfo.week_end.slice(0, 10))}`
        : '';
    const firstReportPeriod = reports[0]?.data.period;
    const customLabelFrom = firstReportPeriod?.dateFrom ?? (dateFrom || null);
    const customLabelTo = firstReportPeriod?.dateTo ?? (dateTo || null);
    const periodLabel = reportMode === 'currentWeek'
        ? (weekLabel || (firstReportPeriod ? formatPeriodLabel(firstReportPeriod.dateFrom, firstReportPeriod.dateTo) : 'Semana actual'))
        : formatPeriodLabel(customLabelFrom, customLabelTo);

    const clearPeriodResults = () => {
        setReports([]);
        setExpanded({});
        setExcludedOrders(new Set());
        setError('');
    };

    const selectCurrentWeek = () => {
        setReportMode('currentWeek');
        setWeekInfo(null);
        clearPeriodResults();
    };

    const selectCustomRange = (from: string, to: string) => {
        setReportMode('custom');
        setDateFrom(from);
        setDateTo(to);
        setWeekInfo(null);
        clearPeriodResults();
    };

    const selectMaxRange = () => {
        setReportMode('custom');
        setDateFrom('');
        setDateTo('');
        setWeekInfo(null);
        clearPeriodResults();
    };

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

    // ─── Generate current week report ──────────────────
    const generate = useCallback(async () => {
        const tenants = selectedTenants.length > 0 ? selectedTenants : MANAGED_IDS;
        if (tenants.length === 0) return;

        if (reportMode === 'custom' && dateFrom && dateTo && dateFrom > dateTo) {
            setError('La fecha inicial no puede ser mayor que la fecha final.');
            return;
        }

        setLoading(true); setError(''); setExcludedOrders(new Set());
        try {
            const settled = await Promise.allSettled(
                tenants.map(async (tenantId) => {
                    const p = new URLSearchParams({
                        tenantId,
                        staffName,
                    });
                    if (reportMode === 'currentWeek') {
                        p.set('currentWeek', 'true');
                    } else {
                        p.set('includeBilled', 'true');
                        if (dateFrom) p.set('dateFrom', dateFrom);
                        if (dateTo) p.set('dateTo', dateTo);
                    }
                    const res = await fetch(`/api/logistics/reports?${p}`);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const d = await res.json();
                    if (d.error) throw new Error(d.error);
                    if (reportMode === 'currentWeek' && d.billingWeek) setWeekInfo(d.billingWeek);
                    return { tenantId, data: d } as ReportEntry;
                })
            );
            const succeeded = settled
                .filter((r): r is PromiseFulfilledResult<ReportEntry> => r.status === 'fulfilled')
                .map(r => r.value);
            const failed = settled
                .map((r, i) => r.status === 'rejected' ? getTenantName(tenants[i]) : null)
                .filter(Boolean);

            if (succeeded.length === 0) {
                setError('No se pudo generar ningún reporte. Verifica tu conexión e intenta de nuevo.');
                return;
            }
            setReports(succeeded);
            const expandAll: Record<string, boolean> = {};
            for (const r of succeeded) expandAll[r.tenantId] = true;
            setExpanded(prev => {
                const hasExpanded = Object.keys(prev).length > 0;
                return hasExpanded ? prev : expandAll;
            });
            if (failed.length > 0) {
                setError(`Reportes generados, pero fallaron: ${failed.join(', ')}`);
            }
        } catch (e: any) { setError(e.message || 'Error generando reportes'); }
        finally { setLoading(false); }
    }, [selectedTenants, staffName, getTenantName, reportMode, dateFrom, dateTo]);

    // ─── Auto-load on mount ────────────────────────────
    useEffect(() => { generate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ─── Auto-refresh every 60 seconds ─────────────────
    useEffect(() => {
        if (activeTab !== 'reports') return;
        if (reportMode !== 'currentWeek') return;
        const interval = setInterval(generate, 60000);
        return () => clearInterval(interval);
    }, [activeTab, reportMode, generate]);

    // ─── Refresh on focus ──────────────────────────────
    useEffect(() => {
        const onFocus = () => { if (activeTab === 'reports' && reportMode === 'currentWeek') generate(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [activeTab, reportMode, generate]);

    // ─── Compute selected totals per tenant ─────────────
    const computeTenantTotals = useCallback((entry: ReportEntry) => {
        const hRate = entry.data.correos.handlingRate;
        const allTenantOrders = [...entry.data.correos.orders, ...entry.data.mensajeria.orders];
        const selected = allTenantOrders.filter(o => !excludedOrders.has(o.id));
        const selectedCorreos = selected.filter(o => o.carrier === 'correos');
        const selectedMensajeria = selected.filter(o => o.carrier === 'mensajeria');

        const correosShipping = selectedCorreos.reduce((s, o) => s + (o.correosShippingCost ?? 0), 0);
        const correosTax = selectedCorreos.reduce((s, o) => s + (o.correosTax ?? getCorreosTax(o.correosShippingCost)), 0);
        const correosHandling = selectedCorreos.length * hRate;
        const mensajeriaRecoleccion = selectedMensajeria.length > 0 ? entry.data.mensajeria.recoleccionCost : 0;
        const mensajeriaHandling = selectedMensajeria.length * hRate;
        const tilopayOrders = selected.filter(o => o.isTilopay);
        const tilopayCommission = tilopayOrders.reduce((s, o) => s + (o.tilopayCommission ?? 0), 0);
        const tilopayTransactionCost = tilopayOrders.reduce((s, o) => s + (o.tilopayTransactionCost ?? 0), 0);
        const tilopayServiceTax = tilopayOrders.reduce((s, o) => s + (o.tilopayServiceTax ?? 0), 0);
        const tilopayFees = tilopayOrders.reduce((s, o) => s + (o.tilopayFee ?? 0), 0);

        const totalShipping = correosShipping + mensajeriaRecoleccion;
        const totalHandling = correosHandling + mensajeriaHandling;
        const subtotal = totalShipping + totalHandling + correosTax + tilopayFees;

        return {
            packages: selected.length,
            correosPackages: selectedCorreos.length,
            mensajeriaPackages: selectedMensajeria.length,
            correosShipping,
            correosTax,
            correosHandling,
            mensajeriaRecoleccion,
            mensajeriaHandling,
            tilopayOrders: tilopayOrders.length,
            tilopayCommission,
            tilopayTransactionCost,
            tilopayServiceTax,
            tilopayFees,
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
        let totalPackages = 0, totalShipping = 0, totalHandling = 0, totalTaxes = 0, totalTilopayFees = 0, subtotalLogistics = 0;

        const perTenant: { tenantId: string; packages: number; subtotal: number; tilopayFees: number }[] = [];

        for (const entry of reports) {
            const t = computeTenantTotals(entry);
            totalPackages += t.packages;
            totalShipping += t.totalShipping;
            totalHandling += t.totalHandling;
            totalTaxes += t.correosTax;
            totalTilopayFees += t.tilopayFees;
            subtotalLogistics += t.subtotal;
            perTenant.push({ tenantId: entry.tenantId, packages: t.packages, subtotal: t.subtotal, tilopayFees: t.tilopayFees });
        }

        const salary = reports.length > 0 ? reports[0].data.salary.total : 0;
        const grandTotal = subtotalLogistics + salary;

        return { totalPackages, totalShipping, totalHandling, totalTaxes, totalTilopayFees, subtotalLogistics, salary, grandTotal, perTenant };
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
                    reason: 'Excluido del reporte por el administrador',
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

    // ─── History ────────────────────────────────────────
    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const res = await fetch('/api/logistics/billing-weeks?status=all&limit=50');
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
            showToast(`Periodo revertido. ${data.revertedOrders} órdenes desbloqueadas.`, 'success');
            setRevertConfirm(null);
            setRevertToken('');
            setHistoryDetail(null);
            await loadHistory();
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
        if (reports.length === 0) return;
        const rows: string[][] = [];
        rows.push(['REPORTE DE LOGÍSTICA'], [`Periodo: ${periodLabel}`], []);

        for (const entry of reports) {
            const name = getTenantName(entry.tenantId);
            const t = computeTenantTotals(entry);
            rows.push([`=== ${name} ===`]);
            rows.push(['Orden', 'Cliente', 'Fecha/Hora', 'Producto', 'Carrier', 'Provincia', 'Total', 'Envío', 'Impuestos', 'Manejo', 'Tilopay Comisión', 'Tilopay Transacción', 'Tilopay IVA', 'Tilopay Total', 'Guía', 'CE']);
            const allOrd = [...entry.data.correos.orders, ...entry.data.mensajeria.orders]
                .filter(o => !excludedOrders.has(o.id));
            for (const o of allOrd) {
                rows.push([
                    o.orderId, o.customerName, o.reportTimestampCR ?? o.timestampCR, o.product ?? '',
                    o.carrier, o.province ?? '', `${o.total}`,
                    `${o.correosShippingCost ?? ''}`,
                    o.carrier === 'correos' && o.correosShippingCost != null ? `${o.correosTax ?? getCorreosTax(o.correosShippingCost)}` : '',
                    `${o.handlingCost}`,
                    o.isTilopay ? `${o.tilopayCommission ?? 0}` : '',
                    o.isTilopay ? `${o.tilopayTransactionCost ?? 0}` : '',
                    o.isTilopay ? `${o.tilopayServiceTax ?? 0}` : '',
                    o.isTilopay ? `${o.tilopayFee ?? 0}` : '',
                    o.guiaNumber ?? '', o.isContraEntrega ? 'Sí' : '',
                ]);
            }
            rows.push([`Subtotal: ${t.packages} paq`, '', '', '', '', '', fmt(t.subtotal)]);
            rows.push([]);
        }

        const combined = computeCombined();
        rows.push(['=== RESUMEN COMBINADO ===']);
        rows.push(['Total Paquetes', 'Envíos', 'Impuestos', 'Manejo', 'Tilopay', 'Subtotal Logística', 'Salario', 'GRAN TOTAL']);
        rows.push([
            `${combined.totalPackages}`, fmt(combined.totalShipping), fmt(combined.totalTaxes), fmt(combined.totalHandling), fmt(combined.totalTilopayFees),
            fmt(combined.subtotalLogistics), fmt(combined.salary), fmt(combined.grandTotal),
        ]);

        const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
        const reportPeriod = reports[0]?.data.period;
        const ws = reportPeriod?.dateFrom ?? weekInfo?.week_start?.slice(0, 10) ?? 'inicio';
        const we = reportPeriod?.dateTo ?? weekInfo?.week_end?.slice(0, 10) ?? 'hoy';
        downloadCSV(csv, `reporte_${ws}_${we}.csv`);
    }

    const allSelected = selectedTenants.length === MANAGED_IDS.length;
    const hasReports = reports.length > 0;
    const isWeekFinalized = weekInfo?.finalized_at != null;
    const isCustomReport = reportMode === 'custom';
    const canManageLiveWeek = reportMode === 'currentWeek' && !isWeekFinalized;
    const todayKey = toDateKeyCR();
    const lastMonth = previousMonthRange(todayKey);

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
                    Reportes por cuenta · Selecciona fechas, verifica y finaliza cada periodo
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

            {/* ─── REPORTS TAB — Live Weekly Dashboard ─────────── */}
            {activeTab === 'reports' && (
                <>
                    {/* Week header + controls */}
                    <div style={{ ...glass, padding: '20px 22px', marginBottom: 24 }}>
                        {/* Week period header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <span style={{
                                    padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                                    background: isCustomReport ? 'rgba(96,165,250,0.12)' : isWeekFinalized ? 'rgba(52,211,153,0.15)' : 'rgba(139,135,255,0.15)',
                                    color: isCustomReport ? '#60a5fa' : isWeekFinalized ? '#34d399' : '#8b87ff',
                                    border: `1px solid ${isCustomReport ? 'rgba(96,165,250,0.3)' : isWeekFinalized ? 'rgba(52,211,153,0.35)' : 'rgba(139,135,255,0.35)'}`,
                                    animation: isCustomReport || isWeekFinalized ? 'none' : 'pulse 2s ease-in-out infinite',
                                }}>
                                    {isCustomReport ? 'Consulta' : isWeekFinalized ? 'Finalizada' : 'En vivo'}
                                </span>
                                <h2 style={{ color: '#F2F2F2', fontSize: 16, fontWeight: 700, margin: 0 }}>
                                    {periodLabel || 'Semana actual'}
                                </h2>
                            </div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <select value={staffName} onChange={e => setStaffName(e.target.value)}
                                    style={{ padding: '7px 12px', ...glass, color: '#F2F2F2', fontSize: 12, outline: 'none', cursor: 'pointer', borderRadius: 8 }}>
                                    {['Ma', 'JKY'].map(n => <option key={n} value={n} style={{ background: '#1a1a2e' }}>{n}</option>)}
                                </select>
                                <button onClick={generate} disabled={loading}
                                    style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.4)', background: 'rgba(139,135,255,0.1)', color: '#8b87ff', cursor: loading ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, opacity: loading ? 0.6 : 1 }}>
                                    <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
                                    {loading ? 'Cargando...' : isCustomReport ? 'Generar' : 'Actualizar'}
                                </button>
                            </div>
                        </div>

                        {/* Period controls */}
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14, marginBottom: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                                <label style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Calendar size={12} /> Periodo
                                </label>
                                <span style={{ color: 'rgba(255,255,255,0.32)', fontSize: 11 }}>
                                    {isCustomReport ? 'Incluye periodos cerrados y abiertos en el rango.' : 'Control semanal: cierre automatico domingo 12:00 PM.'}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                {[
                                    { label: 'Semana actual', onClick: selectCurrentWeek, active: reportMode === 'currentWeek' },
                                    { label: 'Este mes', onClick: () => selectCustomRange(startOfMonthKey(todayKey), todayKey), active: isCustomReport && dateFrom === startOfMonthKey(todayKey) && dateTo === todayKey },
                                    { label: 'Mes pasado', onClick: () => selectCustomRange(lastMonth.from, lastMonth.to), active: isCustomReport && dateFrom === lastMonth.from && dateTo === lastMonth.to },
                                    { label: 'Este ano', onClick: () => selectCustomRange(startOfYearKey(todayKey), todayKey), active: isCustomReport && dateFrom === startOfYearKey(todayKey) && dateTo === todayKey },
                                    { label: 'Max', onClick: selectMaxRange, active: isCustomReport && !dateFrom && !dateTo },
                                ].map(item => (
                                    <button key={item.label} onClick={item.onClick}
                                        style={{
                                            padding: '7px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                            background: item.active ? 'rgba(96,165,250,0.14)' : 'rgba(255,255,255,0.03)',
                                            border: `1px solid ${item.active ? 'rgba(96,165,250,0.35)' : 'rgba(255,255,255,0.08)'}`,
                                            color: item.active ? '#60a5fa' : 'rgba(255,255,255,0.48)',
                                        }}>
                                        {item.label}
                                    </button>
                                ))}
                                <input type="date" value={dateFrom} onChange={e => { setReportMode('custom'); setDateFrom(e.target.value); setWeekInfo(null); clearPeriodResults(); }}
                                    style={{ padding: '7px 10px', ...glass, color: '#F2F2F2', fontSize: 12, outline: 'none', borderRadius: 8 }} />
                                <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }}>a</span>
                                <input type="date" value={dateTo} onChange={e => { setReportMode('custom'); setDateTo(e.target.value); setWeekInfo(null); clearPeriodResults(); }}
                                    style={{ padding: '7px 10px', ...glass, color: '#F2F2F2', fontSize: 12, outline: 'none', borderRadius: 8 }} />
                                {isCustomReport && (
                                    <button onClick={() => { setDateFrom(''); setDateTo(''); clearPeriodResults(); }}
                                        style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 11, cursor: 'pointer', padding: '4px 6px' }}>
                                        Limpiar fechas
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Account checkboxes */}
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14 }}>
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
                        {error && <p style={{ color: '#f87171', fontSize: 12, marginTop: 10, margin: '10px 0 0' }}>{error}</p>}
                    </div>

                    {/* Finalized week notice */}
                    {hasReports && reportMode === 'currentWeek' && isWeekFinalized && (
                        <div style={{ ...glass, padding: '10px 18px', marginBottom: 20, borderColor: 'rgba(52,211,153,0.3)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Lock size={13} style={{ color: '#34d399', flexShrink: 0 }} />
                            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>
                                Esta semana ya fue <strong style={{ color: '#34d399' }}>finalizada</strong> automáticamente. Consulte reportes anteriores en el Historial.
                            </p>
                        </div>
                    )}

                    {/* Live dashboard info */}
                    {hasReports && reportMode === 'currentWeek' && !isWeekFinalized && (
                        <div style={{ ...glass, padding: '10px 18px', marginBottom: 20, borderColor: 'rgba(139,135,255,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <TrendingUp size={13} style={{ color: '#8b87ff', flexShrink: 0 }} />
                            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>
                                Dashboard en vivo — se actualiza cada 60 segundos. Las órdenes aparecen aquí al hacer clic en <strong style={{ color: '#34d399' }}>Terminar</strong> desde el tablero.
                            </p>
                        </div>
                    )}

                    {/* Custom dashboard info */}
                    {hasReports && isCustomReport && (
                        <div style={{ ...glass, padding: '10px 18px', marginBottom: 20, borderColor: 'rgba(96,165,250,0.2)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Calendar size={13} style={{ color: '#60a5fa', flexShrink: 0 }} />
                            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0 }}>
                                Consulta de rango personalizado. Este reporte es solo visualizacion y no cambia los cierres semanales.
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
                                    .sort((a, b) => new Date(a.reportDate ?? a.timestamp).getTime() - new Date(b.reportDate ?? b.timestamp).getTime());

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
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 16 }}>
                                                    {[
                                                        { label: 'Paquetes', value: `${t.packages}`, sub: `${t.correosPackages} correos · ${t.mensajeriaPackages} mensajería`, color: tenantColor },
                                                        { label: 'Envíos', value: fmt(t.totalShipping), sub: `Correos: ${fmt(t.correosShipping)} + Recol: ${fmt(t.mensajeriaRecoleccion)}`, color: '#60a5fa' },
                                                        { label: 'Impuestos', value: fmt(t.correosTax), sub: '13% Correos Regular', color: '#fb7185' },
                                                        { label: `Manejo (${fmt(r.correos.handlingRate)} × ${t.packages})`, value: fmt(t.totalHandling), sub: `Correos: ${fmt(t.correosHandling)} + GD: ${fmt(t.mensajeriaHandling)}`, color: '#fbbf24' },
                                                        { label: 'Tilopay', value: fmt(t.tilopayFees), sub: `${t.tilopayOrders} orden(es) web`, color: '#22d3ee' },
                                                        { label: 'Subtotal Cuenta', value: fmt(t.subtotal), sub: `${fmt(t.totalShipping)} + ${fmt(t.correosTax)} + ${fmt(t.totalHandling)} + ${fmt(t.tilopayFees)}`, color: '#34d399' },
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
                                                                {t.packages} completadas de {allTenantOrders.length} total
                                                            </span>
                                                        </div>
                                                        <div style={{ overflowX: 'auto' }}>
                                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, minWidth: 1080 }}>
                                                                <thead>
                                                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                                        {['', 'Orden', 'Cliente', 'Fecha y Hora', 'Producto', 'Carrier', 'Provincia', 'Total', 'Envío', 'Impuestos', 'Manejo', 'Tilopay', 'Guía', 'CE'].map(h => (
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
                                                                                    {!isExcluded && canManageLiveWeek && (
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
                                                                                    {!canManageLiveWeek && !isExcluded && (
                                                                                        <Lock size={12} style={{ color: 'rgba(255,255,255,0.2)' }} />
                                                                                    )}
                                                                                </td>
                                                                                <td style={{ padding: '6px 8px', color: '#F2F2F2', fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }}>{o.orderId}</td>
                                                                                <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.7)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customerName}</td>
                                                                                <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                                        <Clock size={10} style={{ color: 'rgba(255,255,255,0.25)', flexShrink: 0 }} />
                                                                                        {o.reportTimestampCR ?? o.timestampCR}
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
                                                                                <td style={{ padding: '6px 8px', color: o.carrier === 'correos' ? '#fb7185' : 'rgba(255,255,255,0.2)' }}>
                                                                                    {o.carrier === 'correos' && o.correosShippingCost != null ? fmt(o.correosTax ?? getCorreosTax(o.correosShippingCost)) : '—'}
                                                                                </td>
                                                                                <td style={{ padding: '6px 8px', color: 'rgba(255,255,255,0.5)' }}>{fmt(o.handlingCost)}</td>
                                                                                <td style={{ padding: '6px 8px', color: o.isTilopay ? '#22d3ee' : 'rgba(255,255,255,0.2)' }}>{o.isTilopay ? fmt(o.tilopayFee ?? 0) : '—'}</td>
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
                                                        {reports.length} cuenta{reports.length !== 1 ? 's' : ''} · {periodLabel}
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
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 20 }}>
                                                {[
                                                    { label: 'Total Paquetes', value: `${combined.totalPackages}`, color: '#8b87ff', icon: <Package size={15} /> },
                                                    { label: 'Envíos', value: fmt(combined.totalShipping), color: '#60a5fa', icon: <Truck size={15} /> },
                                                    { label: 'Impuestos', value: fmt(combined.totalTaxes), color: '#fb7185', icon: <DollarSign size={15} /> },
                                                    { label: 'Manejo', value: fmt(combined.totalHandling), color: '#fbbf24', icon: <Package size={15} /> },
                                                    { label: 'Tilopay', value: fmt(combined.totalTilopayFees), color: '#22d3ee', icon: <DollarSign size={15} /> },
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
                                                                    {pt.tilopayFees > 0 && <span style={{ color: '#22d3ee', fontSize: 12 }}>Tilopay {fmt(pt.tilopayFees)}</span>}
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
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 12, marginBottom: 16 }}>
                                                {[
                                                    { label: 'Envíos', value: combined.totalShipping, color: '#60a5fa' },
                                                    { label: 'Impuestos', value: combined.totalTaxes, color: '#fb7185' },
                                                    { label: 'Manejo', value: combined.totalHandling, color: '#8b87ff' },
                                                    { label: 'Tilopay', value: combined.totalTilopayFees, color: '#22d3ee' },
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

                                            {/* Auto-finalization notice */}
                                            {canManageLiveWeek && (
                                                <div style={{ marginTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <Clock size={13} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
                                                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11.5, margin: 0 }}>
                                                        Este periodo se finaliza automáticamente el <strong style={{ color: 'rgba(255,255,255,0.5)' }}>domingo a las 12:00 PM</strong> con reporte PDF descargable.
                                                    </p>
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
                            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, margin: 0 }}>No hay periodos registrados aún</p>
                        </div>
                    )}

                    {billingWeeks.length > 0 && (
                        <div style={{ ...glass, overflow: 'hidden' }}>
                            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.02)' }}>
                                <History size={14} style={{ color: '#8b87ff' }} />
                                <span style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 13 }}>Periodos de Facturación</span>
                                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>({billingWeeks.length})</span>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                        {['Estado', 'Periodo', 'Finalizada', 'Órdenes', 'Monto', 'Acciones'].map(h => (
                                            <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {billingWeeks.map((w, idx) => {
                                        const ws = w.week_start.slice(0, 10);
                                        const we = w.week_end.slice(0, 10);
                                        const isOpen = !w.finalized_at;
                                        return (
                                            <tr key={w.id} style={{ borderBottom: idx < billingWeeks.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', background: isOpen ? 'rgba(139,135,255,0.04)' : 'transparent' }} className="lm-table-row">
                                                <td style={{ padding: '10px 16px' }}>
                                                    <span style={{
                                                        padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                                                        background: isOpen ? 'rgba(139,135,255,0.15)' : 'rgba(52,211,153,0.12)',
                                                        color: isOpen ? '#8b87ff' : '#34d399',
                                                        border: `1px solid ${isOpen ? 'rgba(139,135,255,0.35)' : 'rgba(52,211,153,0.25)'}`,
                                                    }}>
                                                        {isOpen ? 'En progreso' : 'Finalizada'}
                                                    </span>
                                                </td>
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
                                                        <a href={`/api/logistics/reports/pdf?weekId=${w.id}`} target="_blank" rel="noopener noreferrer"
                                                            style={{ ...glass, padding: '4px 12px', color: '#34d399', cursor: 'pointer', fontSize: 11, borderColor: 'rgba(52,211,153,0.2)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>
                                                            <FileDown size={10} /> PDF
                                                        </a>
                                                        {!isOpen && (
                                                            <button onClick={() => { setRevertConfirm(w); setRevertToken(''); }}
                                                                style={{ ...glass, padding: '4px 12px', color: '#f87171', cursor: 'pointer', fontSize: 11, borderColor: 'rgba(248,113,113,0.2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                <Unlock size={10} /> Revertir
                                                            </button>
                                                        )}
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
                                <h3 style={{ color: '#F2F2F2', fontSize: 16, fontWeight: 700, margin: 0 }}>Detalle de Periodo Facturado</h3>
                                <button onClick={() => setHistoryDetail(null)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', padding: 4 }}>
                                    <X size={16} />
                                </button>
                            </div>
                            {historyDetail.reports.map(entry => {
                                const tenantColor = getTenantColor(entry.tenantId);
                                const tenantName = getTenantName(entry.tenantId);
                                const allOrd = [...entry.data.correos.orders, ...entry.data.mensajeria.orders]
                                    .sort((a, b) => new Date(a.reportDate ?? a.timestamp).getTime() - new Date(b.reportDate ?? b.timestamp).getTime());

                                return (
                                    <div key={entry.tenantId} style={{ ...glass, padding: '16px 20px', marginBottom: 12 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: tenantColor, flexShrink: 0 }} />
                                            <span style={{ color: tenantColor, fontWeight: 700, fontSize: 14 }}>{tenantName}</span>
                                            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>{allOrd.length} órdenes</span>
                                        </div>
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 860 }}>
                                                <thead>
                                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                                        {['Orden', 'Cliente', 'Fecha y Hora', 'Carrier', 'Total', 'Envío', 'Impuestos', 'Manejo', 'Tilopay', 'Guía'].map(h => (
                                                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: 'rgba(255,255,255,0.3)', fontWeight: 600, fontSize: 9, textTransform: 'uppercase' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {allOrd.map(o => (
                                                        <tr key={o.id} className="lm-table-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                                            <td style={{ padding: '5px 8px', color: '#F2F2F2', fontFamily: 'monospace', fontSize: 10 }}>{o.orderId}</td>
                                                            <td style={{ padding: '5px 8px', color: 'rgba(255,255,255,0.6)' }}>{o.customerName}</td>
                                                            <td style={{ padding: '5px 8px', color: 'rgba(255,255,255,0.5)' }}>{o.reportTimestampCR ?? o.timestampCR}</td>
                                                            <td style={{ padding: '5px 8px' }}>
                                                                <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: o.carrier === 'correos' ? 'rgba(96,165,250,0.12)' : 'rgba(139,135,255,0.12)', color: o.carrier === 'correos' ? '#60a5fa' : '#8b87ff' }}>
                                                                    {o.carrier === 'correos' ? 'Correos' : 'GD'}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '5px 8px', color: '#F2F2F2', fontWeight: 600 }}>{fmt(o.total)}</td>
                                                            <td style={{ padding: '5px 8px', color: 'rgba(255,255,255,0.5)' }}>{o.correosShippingCost != null ? fmt(o.correosShippingCost) : '—'}</td>
                                                            <td style={{ padding: '5px 8px', color: o.carrier === 'correos' ? '#fb7185' : 'rgba(255,255,255,0.2)' }}>{o.carrier === 'correos' && o.correosShippingCost != null ? fmt(o.correosTax ?? getCorreosTax(o.correosShippingCost)) : '—'}</td>
                                                            <td style={{ padding: '5px 8px', color: 'rgba(255,255,255,0.5)' }}>{fmt(o.handlingCost)}</td>
                                                            <td style={{ padding: '5px 8px', color: o.isTilopay ? '#22d3ee' : 'rgba(255,255,255,0.2)' }}>{o.isTilopay ? fmt(o.tilopayFee ?? 0) : '—'}</td>
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

            {/* Revert confirmation */}
            {revertConfirm && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
                    onClick={() => !reverting && setRevertConfirm(null)}>
                    <div style={{ ...glassHi, padding: '28px 32px', maxWidth: 440, width: '90%', borderColor: 'rgba(248,113,113,0.3)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                            <AlertTriangle size={20} style={{ color: '#f87171' }} />
                            <h3 style={{ color: '#F2F2F2', fontSize: 16, fontWeight: 700, margin: 0 }}>Revertir Periodo</h3>
                        </div>
                        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, lineHeight: 1.6, margin: '0 0 12px' }}>
                            Esto desbloqueará <strong style={{ color: '#f87171' }}>{revertConfirm.order_count}</strong> órdenes del periodo <strong style={{ color: '#F2F2F2' }}>{fmtDate(revertConfirm.week_start.slice(0, 10))} — {fmtDate(revertConfirm.week_end.slice(0, 10))}</strong>.
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
                                {reverting ? 'Revirtiendo...' : 'Revertir Periodo'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .lm-table-row:hover{background:rgba(255,255,255,0.03)!important}
                @keyframes spin{to{transform:rotate(360deg)}}
                @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
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
