'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Building2, Users, CreditCard, TrendingUp,
  Bot, DollarSign, Plus, Trash2, MessageSquare, Megaphone,
  ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface OverviewData {
  summary: {
    totalTenants: number;
    activeTenants: number;
    payingTenants: number;
    trialingTenants: number;
    activeUsers: number;
    totalMemberships: number;
  };
  planDistribution: Record<string, number>;
  tenants: Array<{
    id: string; name: string; slug: string; plan: string;
    isActive: boolean; subscriptionStatus: string | null;
    trialEndsAt: string | null; currentPeriodEnd: string | null;
    createdAt: string; orders: number; users: number; botSessions: number;
  }>;
}

interface RevenueData {
  totalRevenue: number;
  currency: string;
  monthly: Array<{ month: string; revenue: number; count: number }>;
  revenueByPlan: Record<string, number>;
  transactions: Array<{
    id: string; tenantName: string; plan: string; amount: number;
    currency: string; status: string; description: string | null;
    periodStart: string; periodEnd: string; createdAt: string;
  }>;
}

interface UsageData {
  period: string;
  totalActiveSessions: number;
  totalSessions: number;
  botsByTenant: Array<{
    tenantId: string; tenantName: string;
    telegram: { active: number; total: number };
    whatsapp: { active: number; total: number };
  }>;
  usageByTenant: Array<{
    tenantId: string; tenantName: string;
    metrics: Record<string, number>;
  }>;
}

interface CostEntry {
  id: string; category: string; label: string; amount: number;
  currency: string; period: string; notes: string | null;
  created_by: string | null; created_at: string;
}

interface CostsData {
  costs: CostEntry[];
  totalByCategory: Record<string, number>;
  grandTotal: number;
}

interface ProfitabilityData {
  from: string; to: string;
  totalRevenue: number; totalCosts: number;
  netProfit: number; overallMargin: number;
  monthly: Array<{
    month: string; revenue: number; costs: number;
    profit: number; margin: number;
  }>;
}

interface FeedbackTicket {
  id: string; category: string; subject: string; description: string;
  status: string; adminNotes: string | null; priority: string;
  createdAt: string; resolvedAt: string | null;
  tenant?: { name: string; businessName: string | null };
  user?: { name: string | null; email: string };
}

interface ChangelogEntry {
  id: string; title: string; description: string;
  category: string; createdAt: string;
}

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

type Tab = 'overview' | 'revenue' | 'usage' | 'costs' | 'profitability' | 'workforce' | 'feedback' | 'changelog';

const TABS: { key: Tab; label: string; icon: typeof Building2 }[] = [
  { key: 'overview', label: 'Resumen', icon: Building2 },
  { key: 'revenue', label: 'Ingresos', icon: CreditCard },
  { key: 'usage', label: 'Uso', icon: Bot },
  { key: 'costs', label: 'Costos', icon: DollarSign },
  { key: 'profitability', label: 'Rentabilidad', icon: TrendingUp },
  { key: 'workforce', label: 'Workforce', icon: Users },
  { key: 'feedback', label: 'Feedback', icon: MessageSquare },
  { key: 'changelog', label: 'Changelog', icon: Megaphone },
];

const glass = {
  background: 'rgba(255,255,255,0.05)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 14,
} as const;

const COST_CATEGORIES = [
  'supabase', 'vercel', 'domain', 'hosting', 'api_service', 'salary', 'marketing', 'other',
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  supabase: '#3ECF8E', vercel: '#fff', domain: '#f59e0b',
  hosting: '#3b82f6', api_service: '#a855f7', salary: '#ef4444',
  marketing: '#ec4899', other: '#6b7280',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: '#6b7280', normal: '#3b82f6', high: '#f59e0b', critical: '#ef4444',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6', in_progress: '#f59e0b', resolved: '#22c55e', closed: '#6b7280',
};

function formatCurrency(v: number, currency = 'CRC') {
  const sym = currency === 'USD' ? '$' : '₡';
  return `${sym}${v.toLocaleString('es-CR', { maximumFractionDigits: 0 })}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('es-CR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ────────────────────────────────────────────
// KPI Card
// ────────────────────────────────────────────

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{ ...glass, padding: '20px 22px', borderLeft: `3px solid ${color}` }}>
      <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: 500, margin: 0, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</p>
      <p style={{ color: '#F2F2F2', fontSize: 28, fontWeight: 700, margin: '6px 0 0' }}>{value}</p>
      {sub && <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '4px 0 0' }}>{sub}</p>}
    </div>
  );
}

// ────────────────────────────────────────────
// Overview Tab
// ────────────────────────────────────────────

function OverviewTab({ data }: { data: OverviewData | null }) {
  if (!data) return <Loading />;
  const { summary: s, planDistribution, tenants } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <KPICard label="Total Tenants" value={s.totalTenants} sub={`${s.activeTenants} activos`} color="#3b82f6" />
        <KPICard label="Pagando" value={s.payingTenants} sub={`${s.trialingTenants} en trial`} color="#22c55e" />
        <KPICard label="Usuarios Activos" value={s.activeUsers} sub={`${s.totalMemberships} memberships`} color="#a855f7" />
        <KPICard label="Distribución" value={Object.keys(planDistribution).length + ' planes'} sub={Object.entries(planDistribution).map(([p, c]) => `${p}: ${c}`).join(' · ')} color="#f59e0b" />
      </div>

      <div style={{ ...glass, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>Todos los Tenants</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Tenant', 'Plan', 'Estado', 'Suscripción', 'Órdenes', 'Usuarios', 'Bot Sessions', 'Creado'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <p style={{ color: '#F2F2F2', fontWeight: 600, margin: 0 }}>{t.name}</p>
                    <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, margin: '2px 0 0' }}>{t.slug}</p>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: t.plan === 'PRO' ? 'rgba(168,85,247,0.15)' : t.plan === 'BASIC' ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.08)', color: t.plan === 'PRO' ? '#a855f7' : t.plan === 'BASIC' ? '#3b82f6' : 'rgba(255,255,255,0.5)' }}>
                      {t.plan}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: t.isActive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: t.isActive ? '#22c55e' : '#ef4444' }}>
                      {t.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>{t.subscriptionStatus || '—'}</td>
                  <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 600, textAlign: 'center' }}>{t.orders}</td>
                  <td style={{ padding: '10px 14px', color: '#F2F2F2', textAlign: 'center' }}>{t.users}</td>
                  <td style={{ padding: '10px 14px', color: '#F2F2F2', textAlign: 'center' }}>{t.botSessions}</td>
                  <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{formatDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────
// Revenue Tab
// ────────────────────────────────────────────

function RevenueTab({ data }: { data: RevenueData | null }) {
  if (!data) return <Loading />;

  const maxRevenue = Math.max(...data.monthly.map((m) => m.revenue), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <KPICard label="Ingreso Total" value={formatCurrency(data.totalRevenue, data.currency)} color="#22c55e" />
        <KPICard label="Transacciones" value={data.transactions.length} color="#3b82f6" />
        {Object.entries(data.revenueByPlan).map(([plan, amount]) => (
          <KPICard key={plan} label={`Plan ${plan}`} value={formatCurrency(amount, data.currency)} color="#a855f7" />
        ))}
      </div>

      <div style={{ ...glass, padding: '20px 22px' }}>
        <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: '0 0 16px' }}>Ingreso Mensual</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }}>
          {data.monthly.map((m) => {
            const h = Math.max((m.revenue / maxRevenue) * 140, 4);
            return (
              <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 600 }}>
                  {formatCurrency(m.revenue, data.currency)}
                </span>
                <div style={{ width: '100%', maxWidth: 48, height: h, borderRadius: 6, background: 'linear-gradient(180deg, #22c55e, #16a34a)', transition: 'height 0.3s' }} />
                <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>{m.month.slice(5)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ ...glass, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>Transacciones Recientes</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Tenant', 'Plan', 'Monto', 'Período', 'Fecha'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.transactions.slice(0, 50).map((tx) => (
                <tr key={tx.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 500 }}>{tx.tenantName || '—'}</td>
                  <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{tx.plan}</td>
                  <td style={{ padding: '10px 14px', color: '#22c55e', fontWeight: 700 }}>{formatCurrency(tx.amount, tx.currency)}</td>
                  <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{tx.periodStart?.slice(0, 10)} → {tx.periodEnd?.slice(0, 10)}</td>
                  <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>{formatDate(tx.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────
// Usage Tab
// ────────────────────────────────────────────

function UsageTab({ data }: { data: UsageData | null }) {
  if (!data) return <Loading />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <KPICard label="Sesiones Activas" value={data.totalActiveSessions} sub="Bot sessions en uso" color="#22c55e" />
        <KPICard label="Total Sesiones" value={data.totalSessions} sub={`Período: ${data.period}`} color="#3b82f6" />
      </div>

      <div style={{ ...glass, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>Bot Sessions por Tenant</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Tenant', 'Telegram', 'WhatsApp', 'Total'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.botsByTenant.map((t) => (
                <tr key={t.tenantId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 600 }}>{t.tenantName}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: '#3b82f6' }}>{t.telegram.active}</span>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}> / {t.telegram.total}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: '#22c55e' }}>{t.whatsapp.active}</span>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}> / {t.whatsapp.total}</span>
                  </td>
                  <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 700 }}>
                    {t.telegram.total + t.whatsapp.total}
                  </td>
                </tr>
              ))}
              {data.botsByTenant.length === 0 && (
                <tr><td colSpan={4} style={{ padding: '20px 14px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>Sin sesiones de bot registradas</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {data.usageByTenant.length > 0 && (
        <div style={{ ...glass, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>Métricas de Uso por Tenant</p>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>Tenant</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>Métricas</th>
                </tr>
              </thead>
              <tbody>
                {data.usageByTenant.map((u) => (
                  <tr key={u.tenantId} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 600 }}>{u.tenantName}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {Object.entries(u.metrics).map(([metric, count]) => (
                          <span key={metric} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', fontWeight: 600 }}>
                            {metric}: {count}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// Costs Tab
// ────────────────────────────────────────────

function CostsTab({ data, period, onPeriodChange, onAdd, onDelete, refreshing }: {
  data: CostsData | null; period: string;
  onPeriodChange: (p: string) => void;
  onAdd: (entry: { category: string; label: string; amount: number; currency: string; period: string; notes: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  refreshing: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: 'supabase', label: '', amount: '', currency: 'USD', notes: '' });
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!form.label.trim() || !form.amount) return;
    setSaving(true);
    await onAdd({ ...form, amount: Number(form.amount), period });
    setForm({ category: 'supabase', label: '', amount: '', currency: 'USD', notes: '' });
    setShowForm(false);
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>Período:</label>
          <input type="month" value={period} onChange={(e) => onPeriodChange(e.target.value)}
            style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 13, outline: 'none' }} />
        </div>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Agregar Costo
        </button>
      </div>

      {showForm && (
        <div style={{ ...glass, padding: '20px 22px' }}>
          <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: '0 0 16px' }}>Nuevo Costo Operativo</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Categoría</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 13, outline: 'none' }}>
                {COST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Etiqueta</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ej: Supabase Pro"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 13, outline: 'none' }} />
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Monto</label>
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="25.00"
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 13, outline: 'none' }} />
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Moneda</label>
              <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 13, outline: 'none' }}>
                <option value="USD">USD</option>
                <option value="CRC">CRC</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Notas (opcional)</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notas adicionales..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 13, outline: 'none' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
            <button onClick={handleSubmit} disabled={saving || !form.label.trim() || !form.amount}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: saving || !form.label.trim() || !form.amount ? 0.5 : 1 }}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {data && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <KPICard label="Total Costos" value={`$${data.grandTotal.toLocaleString('en', { minimumFractionDigits: 2 })}`} sub={period} color="#ef4444" />
            {Object.entries(data.totalByCategory).map(([cat, total]) => (
              <KPICard key={cat} label={cat} value={`$${Number(total).toLocaleString('en', { minimumFractionDigits: 2 })}`} color={CATEGORY_COLORS[cat] || '#6b7280'} />
            ))}
          </div>

          <div style={{ ...glass, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>Costos {period}</p>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {['Categoría', 'Etiqueta', 'Monto', 'Moneda', 'Notas', ''].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.costs.map((c) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: `${CATEGORY_COLORS[c.category] || '#6b7280'}18`, color: CATEGORY_COLORS[c.category] || '#6b7280' }}>
                          {c.category}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 500 }}>{c.label}</td>
                      <td style={{ padding: '10px 14px', color: '#ef4444', fontWeight: 700 }}>${Number(c.amount).toFixed(2)}</td>
                      <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.4)' }}>{c.currency}</td>
                      <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.notes || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <button onClick={() => onDelete(c.id)} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', cursor: 'pointer', fontSize: 11 }}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {data.costs.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '20px 14px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>Sin costos para este período</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {!data && <Loading />}
    </div>
  );
}

// ────────────────────────────────────────────
// Profitability Tab
// ────────────────────────────────────────────

function ProfitabilityTab({ data }: { data: ProfitabilityData | null }) {
  if (!data) return <Loading />;

  const isPositive = data.netProfit >= 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
        <KPICard label="Ingreso Total" value={formatCurrency(data.totalRevenue)} color="#22c55e" />
        <KPICard label="Costos Totales" value={`$${data.totalCosts.toLocaleString('en', { minimumFractionDigits: 2 })}`} color="#ef4444" />
        <KPICard label="Ganancia Neta" value={formatCurrency(data.netProfit)} sub={`Margen: ${data.overallMargin}%`} color={isPositive ? '#22c55e' : '#ef4444'} />
      </div>

      <div style={{ ...glass, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>P&L Mensual ({data.from} — {data.to})</p>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Mes', 'Ingresos', 'Costos', 'Ganancia', 'Margen', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((m) => {
                const pos = m.profit >= 0;
                return (
                  <tr key={m.month} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '10px 14px', color: '#F2F2F2', fontWeight: 600 }}>{m.month}</td>
                    <td style={{ padding: '10px 14px', color: '#22c55e', fontWeight: 600 }}>{formatCurrency(m.revenue)}</td>
                    <td style={{ padding: '10px 14px', color: '#ef4444', fontWeight: 600 }}>${m.costs.toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                    <td style={{ padding: '10px 14px', color: pos ? '#22c55e' : '#ef4444', fontWeight: 700 }}>{formatCurrency(m.profit)}</td>
                    <td style={{ padding: '10px 14px', color: pos ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{m.margin}%</td>
                    <td style={{ padding: '10px 14px' }}>
                      {pos ? <ArrowUpRight size={14} color="#22c55e" /> : m.profit < 0 ? <ArrowDownRight size={14} color="#ef4444" /> : <Minus size={14} color="#6b7280" />}
                    </td>
                  </tr>
                );
              })}
              {data.monthly.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '20px 14px', color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>Sin datos para el rango seleccionado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────
// Feedback Tab
// ────────────────────────────────────────────

function FeedbackTab({ tickets, onUpdateTicket }: {
  tickets: FeedbackTicket[];
  onUpdateTicket: (id: string, data: { status?: string; priority?: string; adminNotes?: string }) => Promise<void>;
}) {
  const [filter, setFilter] = useState<string>('all');
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [notesVal, setNotesVal] = useState('');

  const filtered = filter === 'all' ? tickets : tickets.filter((t) => t.status === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {['all', 'open', 'in_progress', 'resolved', 'closed'].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${filter === s ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`, background: filter === s ? 'rgba(59,130,246,0.15)' : 'transparent', color: filter === s ? '#3b82f6' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            {s === 'all' ? 'Todos' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {filtered.map((t) => (
        <div key={t.id} style={{ ...glass, padding: '18px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${STATUS_COLORS[t.status] || '#6b7280'}20`, color: STATUS_COLORS[t.status] || '#6b7280' }}>
                  {t.status}
                </span>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: `${PRIORITY_COLORS[t.priority] || '#6b7280'}20`, color: PRIORITY_COLORS[t.priority] || '#6b7280' }}>
                  {t.priority}
                </span>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}>
                  {t.category}
                </span>
              </div>
              <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 14, margin: '0 0 4px' }}>{t.subject}</p>
              <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>{t.description}</p>
              <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11, margin: '8px 0 0' }}>
                {t.tenant?.name || '—'} · {formatDate(t.createdAt)}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <select value={t.status}
                onChange={(e) => onUpdateTicket(t.id, { status: e.target.value })}
                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 11, outline: 'none' }}>
                {['open', 'in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={t.priority}
                onChange={(e) => onUpdateTicket(t.id, { priority: e.target.value })}
                style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 11, outline: 'none' }}>
                {['low', 'normal', 'high', 'critical'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          {t.adminNotes && editingNotes !== t.id && (
            <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.15)' }}>
              <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, margin: '0 0 4px', textTransform: 'uppercase' }}>Notas Admin</p>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, margin: 0, whiteSpace: 'pre-wrap' }}>{t.adminNotes}</p>
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            {editingNotes === t.id ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={notesVal} onChange={(e) => setNotesVal(e.target.value)} placeholder="Notas del admin..."
                  style={{ flex: 1, padding: '7px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12, outline: 'none' }} />
                <button onClick={async () => { await onUpdateTicket(t.id, { adminNotes: notesVal }); setEditingNotes(null); }}
                  style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(34,197,94,0.4)', background: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                  Guardar
                </button>
                <button onClick={() => setEditingNotes(null)}
                  style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer' }}>
                  Cancelar
                </button>
              </div>
            ) : (
              <button onClick={() => { setEditingNotes(t.id); setNotesVal(t.adminNotes || ''); }}
                style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.35)', fontSize: 11, cursor: 'pointer' }}>
                {t.adminNotes ? 'Editar notas' : 'Agregar notas'}
              </button>
            )}
          </div>
        </div>
      ))}
      {filtered.length === 0 && (
        <div style={{ ...glass, padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.3)', margin: 0 }}>Sin tickets {filter !== 'all' ? `con estado "${filter}"` : ''}</p>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// Changelog Tab
// ────────────────────────────────────────────

function ChangelogTab({ entries, onAdd }: {
  entries: ChangelogEntry[];
  onAdd: (entry: { title: string; description: string; category: string }) => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', category: 'improvement' });
  const [saving, setSaving] = useState(false);

  const catColors: Record<string, string> = {
    feature: '#22c55e', fix: '#ef4444', improvement: '#3b82f6', announcement: '#a855f7',
  };

  async function handleSubmit() {
    if (!form.title.trim() || !form.description.trim()) return;
    setSaving(true);
    await onAdd(form);
    setForm({ title: '', description: '', category: 'improvement' });
    setShowForm(false);
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.1)', color: '#a855f7', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> Nueva Entrada
        </button>
      </div>

      {showForm && (
        <div style={{ ...glass, padding: '20px 22px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
              <div>
                <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Título</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Título del cambio..."
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 13, outline: 'none' }} />
              </div>
              <div>
                <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Categoría</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 13, outline: 'none' }}>
                  {['feature', 'fix', 'improvement', 'announcement'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Descripción</label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe el cambio..."
                rows={3} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 13, outline: 'none', resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={handleSubmit} disabled={saving || !form.title.trim() || !form.description.trim()}
                style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.15)', color: '#a855f7', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: saving || !form.title.trim() || !form.description.trim() ? 0.5 : 1 }}>
                {saving ? 'Guardando...' : 'Publicar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {entries.map((e) => (
        <div key={e.id} style={{ ...glass, padding: '18px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: `${catColors[e.category] || '#6b7280'}18`, color: catColors[e.category] || '#6b7280' }}>
              {e.category}
            </span>
            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>{formatDate(e.createdAt)}</span>
          </div>
          <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: '0 0 6px' }}>{e.title}</p>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13, margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{e.description}</p>
        </div>
      ))}
      {entries.length === 0 && (
        <div style={{ ...glass, padding: '40px 20px', textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.3)', margin: 0 }}>Sin entradas de changelog</p>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────
// Loading component
// ────────────────────────────────────────────

function Loading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
      <RefreshCw size={24} color="rgba(255,255,255,0.3)" style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  );
}

// ────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────

function WorkforceTab() {
  return (
    <div style={{ ...glass, padding: '24px 26px', maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(139,135,255,0.14)', color: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Users size={20} />
        </div>
        <div>
          <p style={{ color: '#F2F2F2', fontSize: 18, fontWeight: 800, margin: 0 }}>Workforce management</p>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, margin: '4px 0 0' }}>Empleados, horarios, reloj, cobertura y payroll.</p>
        </div>
      </div>
      <p style={{ color: 'rgba(255,255,255,0.52)', fontSize: 13, lineHeight: 1.7, margin: '0 0 18px' }}>
        La administracion de personal vive en su propia seccion protegida para mantener separados los controles de plataforma y el payroll operativo.
      </p>
      <a href="/logistics/workforce" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.4)', background: 'rgba(139,135,255,0.1)', color: '#a78bfa', textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>
        Abrir Workforce
      </a>
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(false);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [costs, setCosts] = useState<CostsData | null>(null);
  const [profitability, setProfitability] = useState<ProfitabilityData | null>(null);
  const [tickets, setTickets] = useState<FeedbackTicket[]>([]);
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);

  const now = new Date();
  const [costPeriod, setCostPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

  const fetchOverview = useCallback(async () => {
    try {
      const r = await fetch('/api/logistics/admin/overview');
      if (r.ok) setOverview(await r.json());
    } catch (e) { console.error('overview fetch error', e); }
  }, []);

  const fetchRevenue = useCallback(async () => {
    try {
      const r = await fetch('/api/logistics/admin/revenue');
      if (r.ok) setRevenue(await r.json());
    } catch (e) { console.error('revenue fetch error', e); }
  }, []);

  const fetchUsage = useCallback(async () => {
    try {
      const r = await fetch('/api/logistics/admin/usage');
      if (r.ok) setUsage(await r.json());
    } catch (e) { console.error('usage fetch error', e); }
  }, []);

  const fetchCosts = useCallback(async (period?: string) => {
    try {
      const p = period || costPeriod;
      const r = await fetch(`/api/logistics/admin/costs?period=${p}`);
      if (r.ok) setCosts(await r.json());
    } catch (e) { console.error('costs fetch error', e); }
  }, [costPeriod]);

  const fetchProfitability = useCallback(async () => {
    try {
      const r = await fetch('/api/logistics/admin/profitability');
      if (r.ok) setProfitability(await r.json());
    } catch (e) { console.error('profitability fetch error', e); }
  }, []);

  const fetchFeedback = useCallback(async () => {
    try {
      const r = await fetch('/api/logistics/feedback?limit=100');
      if (r.ok) {
        const j = await r.json();
        setTickets(j.data || []);
      }
    } catch (e) { console.error('feedback fetch error', e); }
  }, []);

  const fetchChangelog = useCallback(async () => {
    try {
      const r = await fetch('/api/logistics/changelog');
      if (r.ok) {
        const j = await r.json();
        setChangelog(j.data || []);
      }
    } catch (e) { console.error('changelog fetch error', e); }
  }, []);

  useEffect(() => {
    const loaders: Record<Tab, () => Promise<void>> = {
      overview: fetchOverview,
      revenue: fetchRevenue,
      usage: fetchUsage,
      costs: () => fetchCosts(),
      profitability: fetchProfitability,
      workforce: async () => {},
      feedback: fetchFeedback,
      changelog: fetchChangelog,
    };
    setLoading(true);
    loaders[tab]().finally(() => setLoading(false));
  }, [tab, fetchOverview, fetchRevenue, fetchUsage, fetchCosts, fetchProfitability, fetchFeedback, fetchChangelog]);

  async function handleAddCost(entry: { category: string; label: string; amount: number; currency: string; period: string; notes: string }) {
    const r = await fetch('/api/logistics/admin/costs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (r.ok) await fetchCosts();
  }

  async function handleDeleteCost(id: string) {
    const r = await fetch(`/api/logistics/admin/costs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (r.ok) await fetchCosts();
  }

  async function handleUpdateTicket(id: string, data: { status?: string; priority?: string; adminNotes?: string }) {
    const r = await fetch('/api/logistics/feedback', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...data }),
    });
    if (r.ok) await fetchFeedback();
  }

  async function handleAddChangelog(entry: { title: string; description: string; category: string }) {
    const r = await fetch('/api/logistics/changelog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (r.ok) await fetchChangelog();
  }

  function handleCostPeriodChange(p: string) {
    setCostPeriod(p);
    fetchCosts(p);
  }

  async function handleRefresh() {
    setLoading(true);
    const loaders: Record<Tab, () => Promise<void>> = {
      overview: fetchOverview,
      revenue: fetchRevenue,
      usage: fetchUsage,
      costs: () => fetchCosts(),
      profitability: fetchProfitability,
      workforce: async () => {},
      feedback: fetchFeedback,
      changelog: fetchChangelog,
    };
    await loaders[tab]();
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ color: '#F2F2F2', fontSize: 26, fontWeight: 700, margin: 0 }}>Admin Dashboard</h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: '4px 0 0' }}>
            Plataforma, ingresos, uso y rentabilidad
          </p>
        </div>
        <button onClick={handleRefresh} disabled={loading}
          style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(108,63,255,0.4)', background: 'rgba(108,63,255,0.1)', color: '#8b5cf6', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: loading ? 0.5 : 1 }}>
          <RefreshCw size={14} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
          Actualizar
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)}
            style={{
              padding: '9px 16px', borderRadius: 9, border: `1px solid ${tab === key ? 'rgba(108,63,255,0.5)' : 'transparent'}`,
              background: tab === key ? 'rgba(108,63,255,0.12)' : 'transparent',
              color: tab === key ? '#a78bfa' : 'rgba(255,255,255,0.4)',
              fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7,
              whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'overview' && <OverviewTab data={overview} />}
      {tab === 'revenue' && <RevenueTab data={revenue} />}
      {tab === 'usage' && <UsageTab data={usage} />}
      {tab === 'costs' && <CostsTab data={costs} period={costPeriod} onPeriodChange={handleCostPeriodChange} onAdd={handleAddCost} onDelete={handleDeleteCost} refreshing={loading} />}
      {tab === 'profitability' && <ProfitabilityTab data={profitability} />}
      {tab === 'workforce' && <WorkforceTab />}
      {tab === 'feedback' && <FeedbackTab tickets={tickets} onUpdateTicket={handleUpdateTicket} />}
      {tab === 'changelog' && <ChangelogTab entries={changelog} onAdd={handleAddChangelog} />}
    </div>
  );
}
