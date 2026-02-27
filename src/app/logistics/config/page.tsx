'use client';

import { useState, useEffect } from 'react';
import { Save, RefreshCw, Mail, Eye, EyeOff } from 'lucide-react';
import { useTenantConfig, type TenantConfig } from '@/hooks/useTenantConfig';

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
    const [tab, setTab] = useState<'rates' | 'tenants' | 'correos'>('rates');
    const [correosEmail, setCorreosEmail] = useState('');
    const [correosPassword, setCorreosPassword] = useState('');
    const [correosHasCredentials, setCorreosHasCredentials] = useState(false);
    const [correosLoaded, setCorreosLoaded] = useState(false);
    const [correosSaving, setCorreosSaving] = useState(false);
    const [correosSaved, setCorreosSaved] = useState(false);
    const [showCorreosPassword, setShowCorreosPassword] = useState(false);

    useEffect(() => {
        fetch('/api/logistics/rates').then(r => r.json()).then(d => { if (d.rates) setRates(d.rates); }).finally(() => setRatesLoaded(true));
        fetch('/api/logistics/correos-config').then(r => r.json()).then(d => {
            setCorreosEmail(d.email || '');
            setCorreosHasCredentials(d.hasCredentials || false);
        }).finally(() => setCorreosLoaded(true));
    }, []);

    async function saveRate(key: keyof Rates, value: number) {
        const res = await fetch('/api/logistics/rates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) });
        if (res.ok) setRates(p => ({ ...p, [key]: value }));
    }
    async function saveTenant(id: string, name: string, color: string) {
        await fetch('/api/logistics/tenant-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenantId: id, name, color }) });
    }
    async function saveCorreosConfig() {
        if (!correosEmail.trim()) return;
        setCorreosSaving(true);
        const payload: any = { email: correosEmail.trim() };
        if (correosPassword) payload.password = correosPassword;
        const res = await fetch('/api/logistics/correos-config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) {
            setCorreosHasCredentials(true);
            setCorreosPassword('');
            setCorreosSaved(true);
            setTimeout(() => setCorreosSaved(false), 2500);
        }
        setCorreosSaving(false);
    }

    return (
        <div>
            <div style={{ marginBottom: 28 }}>
                <h1 style={{ color: '#F2F2F2', fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>Configuración</h1>
                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, margin: 0 }}>Tarifas de envío y configuración por cuenta</p>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                {[{ id: 'rates' as const, label: 'Tarifas de Envío' }, { id: 'tenants' as const, label: 'Cuentas y Colores' }, { id: 'correos' as const, label: '📮 Correos CR' }].map(t => (
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
                <div style={{ maxWidth: 560 }}>
                    <div style={{ ...glass, padding: '22px 26px', borderColor: 'rgba(96,165,250,0.25)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                            <Mail size={20} style={{ color: '#60a5fa' }} />
                            <div>
                                <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 16, margin: 0 }}>Correos de Costa Rica</p>
                                <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '2px 0 0' }}>Credenciales globales para generación automática de guías</p>
                            </div>
                            {correosHasCredentials && <span style={{ marginLeft: 'auto', color: '#34d399', fontSize: 12, fontWeight: 600 }}>✓ Configurado</span>}
                        </div>
                        {!correosLoaded ? <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>Cargando...</p> : (
                            <div style={{ display: 'grid', gap: 14 }}>
                                <div>
                                    <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Email de acceso</label>
                                    <input type="email" value={correosEmail} onChange={e => setCorreosEmail(e.target.value)}
                                        placeholder="usuario@correos.go.cr"
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Contraseña {correosHasCredentials && <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}>(dejar vacío para mantener actual)</span>}</label>
                                    <div style={{ position: 'relative' }}>
                                        <input type={showCorreosPassword ? 'text' : 'password'} value={correosPassword} onChange={e => setCorreosPassword(e.target.value)}
                                            placeholder={correosHasCredentials ? '••••••••' : 'Contraseña de acceso'}
                                            style={{ width: '100%', padding: '10px 42px 10px 14px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.3)', background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
                                        <button onClick={() => setShowCorreosPassword(p => !p)} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: 4 }}>
                                            {showCorreosPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                        </button>
                                    </div>
                                </div>
                                <button onClick={saveCorreosConfig} disabled={correosSaving || !correosEmail.trim()}
                                    style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.4)', background: 'rgba(96,165,250,0.12)', color: '#60a5fa', fontWeight: 700, fontSize: 13, cursor: correosEmail.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, transition: 'all 0.2s', opacity: correosEmail.trim() ? 1 : 0.4 }} className="lm-save-btn">
                                    {correosSaving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : correosSaved ? '✓ Guardado' : <><Save size={13} /> Guardar Credenciales</>}
                                </button>
                            </div>
                        )}
                    </div>
                    <div style={{ ...glass, padding: '14px 18px', marginTop: 14 }}>
                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: 0, lineHeight: 1.7 }}>
                            <strong style={{ color: 'rgba(255,255,255,0.55)' }}>Nota:</strong> Estas credenciales se usan para la generación automática de guías en la sección <strong style={{ color: '#60a5fa' }}>Guías → Correos de Costa Rica</strong>. Una sola cuenta se aplica a todas las órdenes de todos los clientes.
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
            <style>{`.lm-save-btn:hover{filter:brightness(1.2);box-shadow:0 0 14px currentColor} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}
