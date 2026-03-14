'use client';

import { useState, useEffect } from 'react';
import { Save, RefreshCw, Eye, EyeOff, MessageSquare, Megaphone } from 'lucide-react';
import { useTenantConfig, type TenantConfig } from '@/hooks/useTenantConfig';

interface FeedbackTicket {
  id: string; tenantId: string; userId: string; category: string; subject: string;
  description: string; status: string; adminNotes: string | null; priority: string;
  createdAt: string; resolvedAt: string | null;
  tenant?: { name: string; businessName: string | null };
  user?: { name: string | null; email: string };
}

interface ChangelogEntryType {
  id: string; title: string; description: string; category: string; createdAt: string;
}

interface Rates { mensajeria_rate: number; correos_rate: number; handling_rate: number; salary_daily_rate: number; gd_recoleccion_cost: number; }

const PRESETS = ['#6c63ff', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#8b5cf6'];

const glass = { background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14 } as const;

function RateCard({ label, desc, rateKey, value, onSave, color }: {
    label: string; desc: string; rateKey: keyof Rates; value: number;
    onSave: (k: keyof Rates, v: number) => Promise<void>; color: string;
}) {
    const [input, setInput] = useState(String(value));
    const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false);
    useEffect(() => { setInput(String(value)); }, [value]);
    async function save() {
        const n = Number(input); if (isNaN(n) || n < 0) return;
        setSaving(true); await onSave(rateKey, n); setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
    }
    return (
        <div style={{ ...glass, padding: '18px 22px', borderColor: `${color}30` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                    <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>{label}</p>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '3px 0 0' }}>{desc}</p>
                </div>
                {saved && <span style={{ color: '#34d399', fontSize: 12, fontWeight: 600 }}>✓ Guardado</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 18 }}>₡</span>
                <input type="number" value={input} onChange={e => setInput(e.target.value)}
                    style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: `1px solid ${color}45`, background: 'rgba(0,0,0,0.25)', color, fontSize: 20, fontWeight: 700, outline: 'none' }} />
                <button onClick={save} disabled={saving} style={{ padding: '9px 16px', borderRadius: 8, border: `1px solid ${color}40`, background: `${color}12`, color, fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s' }} className="lm-save-btn">
                    {saving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />} Guardar
                </button>
            </div>
        </div>
    );
}

function TenantRow({ tenant, onSave }: { tenant: TenantConfig; onSave: (id: string, name: string, color: string) => Promise<void> }) {
    const [name, setName] = useState(tenant.name);
    const [color, setColor] = useState(tenant.color);
    const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false);
    useEffect(() => { setName(tenant.name); setColor(tenant.color); }, [tenant]);
    async function save() {
        if (!name.trim()) return;
        setSaving(true); await onSave(tenant.id, name.trim(), color); setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
    }
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'center', padding: '12px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}` }} />
                <input value={name} onChange={e => setName(e.target.value)} style={{ background: 'transparent', border: 'none', color: '#F2F2F2', fontSize: 13.5, fontWeight: 600, outline: 'none', width: '100%' }} placeholder="Nombre de cuenta" />
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 175 }}>
                {PRESETS.map(c => (
                    <button key={c} onClick={() => setColor(c)} style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: color === c ? '2px solid white' : '2px solid transparent', cursor: 'pointer', padding: 0, boxShadow: color === c ? `0 0 6px ${c}` : undefined }} />
                ))}
            </div>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 30, height: 30, borderRadius: 6, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
            <button onClick={save} disabled={saving} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${color}40`, background: `${color}12`, color, fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap', transition: 'all 0.2s' }} className="lm-save-btn">
                {saving ? <RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> : saved ? '✓' : <Save size={12} />}
                {saved ? 'Guardado' : 'Guardar'}
            </button>
        </div>
    );
}

export default function ConfigPage() {
    const { tenants } = useTenantConfig();
    const [rates, setRates] = useState<Rates>({ mensajeria_rate: 2600, correos_rate: 2500, handling_rate: 600, salary_daily_rate: 10000, gd_recoleccion_cost: 2700 });
    const [ratesLoaded, setRatesLoaded] = useState(false);
    const [tab, setTab] = useState<'rates' | 'tenants' | 'correos' | 'feedback' | 'changelog'>('rates');
    const [correosLoaded, setCorreosLoaded] = useState(false);
    const [wsUsername, setWsUsername] = useState('');
    const [wsPassword, setWsPassword] = useState('');
    const [wsSistema, setWsSistema] = useState('');
    const [wsUsuarioId, setWsUsuarioId] = useState('');
    const [wsServicioId, setWsServicioId] = useState('');
    const [wsCodCliente, setWsCodCliente] = useState('');
    const [hasWsCredentials, setHasWsCredentials] = useState(false);
    const [wsSaving, setWsSaving] = useState(false);
    const [wsSaved, setWsSaved] = useState(false);
    const [showWsPassword, setShowWsPassword] = useState(false);
    const [wsSenderName, setWsSenderName] = useState('');
    const [wsSenderAddress, setWsSenderAddress] = useState('');
    const [wsSenderZip, setWsSenderZip] = useState('');
    const [wsSenderPhone, setWsSenderPhone] = useState('');

    // Feedback state
    const [feedbackTickets, setFeedbackTickets] = useState<FeedbackTicket[]>([]);
    const [feedbackLoading, setFeedbackLoading] = useState(false);
    const [feedbackFilter, setFeedbackFilter] = useState<string>('');
    const [editingTicket, setEditingTicket] = useState<string | null>(null);
    const [editNotes, setEditNotes] = useState('');
    const [editStatus, setEditStatus] = useState('');
    const [editPriority, setEditPriority] = useState('');
    const [ticketSaving, setTicketSaving] = useState(false);

    // Changelog state
    const [changelogEntries, setChangelogEntries] = useState<ChangelogEntryType[]>([]);
    const [changelogLoading, setChangelogLoading] = useState(false);
    const [clTitle, setClTitle] = useState('');
    const [clDesc, setClDesc] = useState('');
    const [clCategory, setClCategory] = useState('improvement');
    const [clSaving, setClSaving] = useState(false);

    async function loadFeedback() {
        setFeedbackLoading(true);
        try {
            const params = new URLSearchParams();
            if (feedbackFilter) params.set('status', feedbackFilter);
            const res = await fetch(`/api/logistics/feedback?${params}`);
            const data = await res.json();
            if (data.status === 'success') setFeedbackTickets(data.data || []);
        } catch (e) { console.error('loadFeedback:', e); }
        setFeedbackLoading(false);
    }

    async function updateTicket(id: string) {
        setTicketSaving(true);
        const body: any = {};
        if (editStatus) body.status = editStatus;
        if (editPriority) body.priority = editPriority;
        if (editNotes !== undefined) body.adminNotes = editNotes;
        body.id = id;
        await fetch('/api/logistics/feedback', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        setEditingTicket(null);
        setTicketSaving(false);
        loadFeedback();
    }

    async function loadChangelog() {
        setChangelogLoading(true);
        try {
            const res = await fetch('/api/logistics/changelog');
            const data = await res.json();
            if (data.status === 'success') setChangelogEntries(data.data || []);
        } catch (e) { console.error('loadChangelog:', e); }
        setChangelogLoading(false);
    }

    async function createChangelog() {
        if (!clTitle.trim() || !clDesc.trim()) return;
        setClSaving(true);
        await fetch('/api/logistics/changelog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: clTitle.trim(), description: clDesc.trim(), category: clCategory }) });
        setClTitle(''); setClDesc(''); setClSaving(false);
        loadChangelog();
    }

    useEffect(() => {
        if (tab === 'feedback') loadFeedback();
        if (tab === 'changelog') loadChangelog();
    }, [tab]);

    useEffect(() => {
        fetch('/api/logistics/rates').then(r => r.json()).then(d => { if (d.rates) setRates(d.rates); }).finally(() => setRatesLoaded(true));
        fetch('/api/logistics/correos-config').then(r => r.json()).then(d => {
            setWsUsername(d.ws_username || '');
            setWsSistema(d.ws_sistema || '');
            setWsUsuarioId(d.ws_usuario_id || '');
            setWsServicioId(d.ws_servicio_id || '');
            setWsCodCliente(d.ws_cod_cliente || '');
            setHasWsCredentials(d.hasWsCredentials || false);
            setWsSenderName(d.ws_sender_name || '');
            setWsSenderAddress(d.ws_sender_address || '');
            setWsSenderZip(d.ws_sender_zip || '');
            setWsSenderPhone(d.ws_sender_phone || '');
        }).finally(() => setCorreosLoaded(true));
    }, []);

    async function saveRate(key: keyof Rates, value: number) {
        const res = await fetch('/api/logistics/rates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) });
        if (res.ok) setRates(p => ({ ...p, [key]: value }));
    }
    async function saveTenant(id: string, name: string, color: string) {
        await fetch('/api/logistics/tenant-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: id, name, color }) });
    }
    async function saveWsConfig() {
        if (!wsUsername.trim()) return;
        setWsSaving(true);
        const payload: Record<string, string> = {
            ws_username: wsUsername.trim(), ws_sistema: wsSistema.trim(),
            ws_usuario_id: wsUsuarioId.trim(), ws_servicio_id: wsServicioId.trim(), ws_cod_cliente: wsCodCliente.trim(),
            ws_sender_name: wsSenderName.trim(), ws_sender_address: wsSenderAddress.trim(),
            ws_sender_zip: wsSenderZip.trim(), ws_sender_phone: wsSenderPhone.trim(),
        };
        if (wsPassword) payload.ws_password = wsPassword;
        const res = await fetch('/api/logistics/correos-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) {
            setHasWsCredentials(true);
            setWsPassword('');
            setWsSaved(true);
            setTimeout(() => setWsSaved(false), 2500);
        }
        setWsSaving(false);
    }

    return (
        <div>
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Configuración</h1>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>Tarifas de envío y configuración por cuenta</p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {[{ id: 'rates' as const, label: 'Tarifas de Envío' }, { id: 'tenants' as const, label: 'Cuentas y Colores' }, { id: 'correos' as const, label: '📮 Correos CR' }, { id: 'feedback' as const, label: '💬 Feedback' }, { id: 'changelog' as const, label: '📋 Changelog' }].map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: '9px 20px', borderRadius: '8px 8px 0 0', border: 'none', borderBottom: tab === t.id ? '2px solid #8b87ff' : '2px solid transparent', background: tab === t.id ? 'rgba(139,135,255,0.08)' : 'transparent', color: tab === t.id ? '#F2F2F2' : 'rgba(255,255,255,0.35)', fontWeight: tab === t.id ? 700 : 400, fontSize: 13, cursor: 'pointer', marginBottom: -1, transition: 'all 0.15s' }}>
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'rates' && (
                <div>
                    {!ratesLoaded ? <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Cargando...</p> : (
                        <div style={{ display: 'grid', gap: 14, maxWidth: 560 }}>
                            <RateCard label="Mensajería Privada" desc="Costo plano por paquete vía mensajería" rateKey="mensajeria_rate" value={rates.mensajeria_rate} onSave={saveRate} color="#8b87ff" />
                            <RateCard label="Correos de Costa Rica" desc="Costo plano por paquete vía Correos CR" rateKey="correos_rate" value={rates.correos_rate} onSave={saveRate} color="#60a5fa" />
                            <RateCard label="Costo de Manejo" desc="Costo de gestión por paquete (todos)" rateKey="handling_rate" value={rates.handling_rate} onSave={saveRate} color="#34d399" />
                            <RateCard label="Salario Diario" desc="Tarifa diaria del colaborador (usado en reportes y contabilidad)" rateKey="salary_daily_rate" value={rates.salary_daily_rate} onSave={saveRate} color="#fbbf24" />
                            <RateCard label="Costo Recolección GD" desc="Costo plano de recolección por viaje de Green Delivery" rateKey="gd_recoleccion_cost" value={rates.gd_recoleccion_cost} onSave={saveRate} color="#c084fc" />
                            <div style={{ ...glass, padding: '14px 18px' }}>
                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: 0, lineHeight: 1.7 }}>
                                    <strong style={{ color: 'rgba(255,255,255,0.55)' }}>Fórmula costo semanal:</strong><br />
                                    Total = Correos + Mensajería + Manejo + Salario ({(rates.salary_daily_rate ?? 0).toLocaleString()} × días trabajados)
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {tab === 'correos' && (
                <div style={{ maxWidth: 560, display: 'grid', gap: 14 }}>
                    {/* ── Web Service Credentials ── */}
                    <div style={{ ...glass, padding: '22px 26px', borderColor: 'rgba(52,211,153,0.3)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                            <span style={{ fontSize: 18 }}>🔗</span>
                            <div>
                                <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>Web Service (SOAP API)</p>
                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '2px 0 0' }}>Credenciales del Web Service proporcionadas por Correos CR</p>
                            </div>
                            {hasWsCredentials && <span style={{ marginLeft: 'auto', color: '#34d399', fontSize: 12, fontWeight: 600 }}>✓ Configurado</span>}
                        </div>
                        {!correosLoaded ? <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Cargando...</p> : (
                            <div style={{ display: 'grid', gap: 12 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div>
                                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Username</label>
                                        <input value={wsUsername} onChange={e => setWsUsername(e.target.value)} placeholder="ccrWS..."
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                    </div>
                                    <div>
                                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Password {hasWsCredentials && <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}>(vacío = mantener)</span>}</label>
                                        <div style={{ position: 'relative' }}>
                                            <input type={showWsPassword ? 'text' : 'password'} value={wsPassword} onChange={e => setWsPassword(e.target.value)} placeholder={hasWsCredentials ? '••••••••' : 'Password'}
                                                style={{ width: '100%', padding: '10px 42px 10px 14px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                            <button onClick={() => setShowWsPassword(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4 }}>
                                                {showWsPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Sistema</label>
                                    <input value={wsSistema} onChange={e => setWsSistema(e.target.value)} placeholder="PYMEXPRESS"
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                    <div>
                                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Usuario ID</label>
                                        <input value={wsUsuarioId} onChange={e => setWsUsuarioId(e.target.value)} placeholder="117960921"
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                    </div>
                                    <div>
                                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Servicio ID</label>
                                        <input value={wsServicioId} onChange={e => setWsServicioId(e.target.value)} placeholder="1564"
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                    </div>
                                    <div>
                                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Código Cliente</label>
                                        <input value={wsCodCliente} onChange={e => setWsCodCliente(e.target.value)} placeholder="7362097"
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Sender (Remitente) Info ── */}
                    <div style={{ ...glass, padding: '22px 26px', borderColor: 'rgba(251,191,36,0.25)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                            <span style={{ fontSize: 18 }}>📦</span>
                            <div>
                                <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>Datos del Remitente</p>
                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '2px 0 0' }}>Información que aparece como remitente en cada guía generada</p>
                            </div>
                        </div>
                        {!correosLoaded ? <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Cargando...</p> : (
                            <div style={{ display: 'grid', gap: 12 }}>
                                <div>
                                    <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Nombre del Remitente</label>
                                    <input value={wsSenderName} onChange={e => setWsSenderName(e.target.value)} placeholder="Mi Empresa S.A."
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Dirección del Remitente</label>
                                    <input value={wsSenderAddress} onChange={e => setWsSenderAddress(e.target.value)} placeholder="Barrio Los Yoses, San Pedro, San José"
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                    <div>
                                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Código Postal</label>
                                        <input value={wsSenderZip} onChange={e => setWsSenderZip(e.target.value)} placeholder="10107"
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                    </div>
                                    <div>
                                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Teléfono</label>
                                        <input value={wsSenderPhone} onChange={e => setWsSenderPhone(e.target.value)} placeholder="22345678"
                                            style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ── Save Button ── */}
                    <button onClick={saveWsConfig} disabled={wsSaving || !wsUsername.trim()}
                        style={{ padding: '12px 20px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.12)', color: '#34d399', fontWeight: 700, fontSize: 13, cursor: wsUsername.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all 0.2s', opacity: wsUsername.trim() ? 1 : 0.4 }} className="lm-save-btn">
                        {wsSaving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : wsSaved ? '✓ Guardado' : <><Save size={13} /> Guardar Configuración Correos CR</>}
                    </button>

                    <div style={{ ...glass, padding: '14px 18px' }}>
                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: 0, lineHeight: 1.7 }}>
                            <strong style={{ color: 'rgba(255,255,255,0.55)' }}>Nota:</strong> Los datos del remitente aparecerán impresos en cada guía de Correos CR. Asegúrese de que la dirección, código postal y teléfono sean correctos.
                        </p>
                    </div>
                </div>
            )}

            {tab === 'tenants' && (
                <div style={{ maxWidth: 680 }}>
                    <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, marginBottom: 16 }}>Personaliza el nombre y color de cada cuenta en el tablero.</p>
                    <div style={{ display: 'grid', gap: 8 }}>
                        {tenants.map(t => <TenantRow key={t.id} tenant={t} onSave={saveTenant} />)}
                    </div>
                    <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: 12, marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        Los cambios se reflejan inmediatamente en el Tablero de Envíos, Dashboard y Contabilidad.
                    </p>
                </div>
            )}
            {tab === 'feedback' && (
                <div style={{ maxWidth: 800 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                            {['', 'open', 'in_progress', 'resolved', 'closed'].map(f => (
                                <button key={f} onClick={() => { setFeedbackFilter(f); setTimeout(loadFeedback, 0); }}
                                    style={{ padding: '6px 12px', borderRadius: 6, border: feedbackFilter === f ? '1px solid #8b87ff' : '1px solid rgba(255,255,255,0.1)', background: feedbackFilter === f ? 'rgba(139,135,255,0.15)' : 'transparent', color: feedbackFilter === f ? '#F2F2F2' : 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: feedbackFilter === f ? 600 : 400, cursor: 'pointer' }}>
                                    {f === '' ? 'Todos' : f === 'open' ? 'Abiertos' : f === 'in_progress' ? 'En Progreso' : f === 'resolved' ? 'Resueltos' : 'Cerrados'}
                                </button>
                            ))}
                        </div>
                        <button onClick={loadFeedback} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.5)', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                            <RefreshCw size={12} /> Recargar
                        </button>
                    </div>
                    {feedbackLoading ? <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Cargando tickets...</p> : feedbackTickets.length === 0 ? (
                        <div style={{ ...glass, padding: '40px 20px', textAlign: 'center' }}>
                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>No hay tickets de feedback{feedbackFilter ? ` con estado "${feedbackFilter}"` : ''}.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: 8 }}>
                            {feedbackTickets.map(t => {
                                const isEditing = editingTicket === t.id;
                                const priorityColors: Record<string, string> = { low: '#60a5fa', normal: '#F2F2F2', high: '#fbbf24', critical: '#ef4444' };
                                const statusColors: Record<string, string> = { open: '#60a5fa', in_progress: '#fbbf24', resolved: '#34d399', closed: '#6b7280' };
                                return (
                                    <div key={t.id} style={{ ...glass, padding: '14px 18px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                                    <span style={{ color: priorityColors[t.priority] || '#F2F2F2', fontWeight: 700, fontSize: 14 }}>{t.subject}</span>
                                                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: `${statusColors[t.status] || '#6b7280'}20`, color: statusColors[t.status] || '#6b7280', border: `1px solid ${statusColors[t.status] || '#6b7280'}40` }}>
                                                        {t.status === 'open' ? 'Abierto' : t.status === 'in_progress' ? 'En Progreso' : t.status === 'resolved' ? 'Resuelto' : 'Cerrado'}
                                                    </span>
                                                    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}>{t.category}</span>
                                                </div>
                                                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: '0 0 6px', lineHeight: 1.5 }}>{t.description}</p>
                                                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>
                                                    <span>🏢 {t.tenant?.businessName || t.tenant?.name || t.tenantId.slice(0, 8)}</span>
                                                    <span>👤 {t.user?.name || t.user?.email || 'N/A'}</span>
                                                    <span>📅 {new Date(t.createdAt).toLocaleDateString('es-CR')}</span>
                                                </div>
                                            </div>
                                            <button onClick={() => { if (isEditing) { setEditingTicket(null); } else { setEditingTicket(t.id); setEditStatus(t.status); setEditPriority(t.priority); setEditNotes(t.adminNotes || ''); } }}
                                                style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: isEditing ? 'rgba(139,135,255,0.15)' : 'transparent', color: isEditing ? '#8b87ff' : 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                                {isEditing ? 'Cancelar' : 'Editar'}
                                            </button>
                                        </div>
                                        {t.adminNotes && !isEditing && (
                                            <div style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 8, padding: '8px 12px', marginTop: 8 }}>
                                                <p style={{ color: '#34d399', fontSize: 11, fontWeight: 600, margin: '0 0 3px' }}>Nota admin:</p>
                                                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, margin: 0 }}>{t.adminNotes}</p>
                                            </div>
                                        )}
                                        {isEditing && (
                                            <div style={{ marginTop: 12, display: 'grid', gap: 10, padding: '12px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                                    <div>
                                                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Estado</label>
                                                        <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                                                            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12 }}>
                                                            <option value="open">Abierto</option>
                                                            <option value="in_progress">En Progreso</option>
                                                            <option value="resolved">Resuelto</option>
                                                            <option value="closed">Cerrado</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Prioridad</label>
                                                        <select value={editPriority} onChange={e => setEditPriority(e.target.value)}
                                                            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12 }}>
                                                            <option value="low">Baja</option>
                                                            <option value="normal">Normal</option>
                                                            <option value="high">Alta</option>
                                                            <option value="critical">Crítica</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, display: 'block', marginBottom: 4 }}>Nota / Respuesta</label>
                                                    <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3}
                                                        style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.3)', color: '#F2F2F2', fontSize: 12, resize: 'vertical', boxSizing: 'border-box' }}
                                                        placeholder="Escribe una respuesta o nota interna..." />
                                                </div>
                                                <button onClick={() => updateTicket(t.id)} disabled={ticketSaving}
                                                    style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.12)', color: '#34d399', fontWeight: 600, fontSize: 12, cursor: 'pointer' }} className="lm-save-btn">
                                                    {ticketSaving ? 'Guardando...' : '✓ Guardar Cambios'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {tab === 'changelog' && (
                <div style={{ maxWidth: 680 }}>
                    {/* Create new entry */}
                    <div style={{ ...glass, padding: '18px 22px', marginBottom: 20 }}>
                        <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: '0 0 14px' }}>Nueva Entrada de Changelog</p>
                        <div style={{ display: 'grid', gap: 10 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
                                <input value={clTitle} onChange={e => setClTitle(e.target.value)} placeholder="Título del cambio"
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                                <select value={clCategory} onChange={e => setClCategory(e.target.value)}
                                    style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13 }}>
                                    <option value="feature">Nueva Función</option>
                                    <option value="fix">Corrección</option>
                                    <option value="improvement">Mejora</option>
                                    <option value="announcement">Anuncio</option>
                                </select>
                            </div>
                            <textarea value={clDesc} onChange={e => setClDesc(e.target.value)} placeholder="Descripción detallada..." rows={3}
                                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
                            <button onClick={createChangelog} disabled={clSaving || !clTitle.trim() || !clDesc.trim()}
                                style={{ padding: '10px 16px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.4)', background: 'rgba(139,135,255,0.12)', color: '#8b87ff', fontWeight: 700, fontSize: 13, cursor: clTitle.trim() && clDesc.trim() ? 'pointer' : 'default', opacity: clTitle.trim() && clDesc.trim() ? 1 : 0.4 }} className="lm-save-btn">
                                {clSaving ? 'Publicando...' : '+ Publicar Entrada'}
                            </button>
                        </div>
                    </div>
                    {/* Existing entries */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, margin: 0 }}>Entradas publicadas</p>
                        <button onClick={loadChangelog} style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.4)', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <RefreshCw size={11} /> Recargar
                        </button>
                    </div>
                    {changelogLoading ? <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Cargando...</p> : changelogEntries.length === 0 ? (
                        <div style={{ ...glass, padding: '30px 20px', textAlign: 'center' }}>
                            <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>No hay entradas aún. Crea la primera arriba.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: 8 }}>
                            {changelogEntries.map(e => {
                                const catColors: Record<string, string> = { feature: '#8b87ff', fix: '#ef4444', improvement: '#34d399', announcement: '#fbbf24' };
                                const catLabels: Record<string, string> = { feature: 'Nueva Función', fix: 'Corrección', improvement: 'Mejora', announcement: 'Anuncio' };
                                return (
                                    <div key={e.id} style={{ ...glass, padding: '14px 18px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: `${catColors[e.category] || '#6b7280'}20`, color: catColors[e.category] || '#6b7280', border: `1px solid ${catColors[e.category] || '#6b7280'}40` }}>
                                                {catLabels[e.category] || e.category}
                                            </span>
                                            <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 11 }}>{new Date(e.createdAt).toLocaleDateString('es-CR')}</span>
                                        </div>
                                        <p style={{ color: '#F2F2F2', fontWeight: 600, fontSize: 14, margin: '0 0 4px' }}>{e.title}</p>
                                        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, margin: 0, lineHeight: 1.5 }}>{e.description}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            <style>{`.lm-save-btn:hover{filter:brightness(1.2);box-shadow:0 0 14px currentColor} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}
