'use client';

import React, { useEffect, useState } from 'react';
import { Check, Plug, RefreshCw, Save, ShieldCheck, XCircle } from 'lucide-react';

/** Correos API v3 (REST) platform settings, next to the SOAP card in Logística › Config › Correos CR. */

type V3State = {
  enabled: boolean;
  environment: 'test' | 'prod';
  username: string;
  hasPassword: boolean;
  codCliente: string;
  servicioId: string;
  usuarioId: string;
  pickupCedula: string;
  pickupEmail: string;
  baseUrl: string;
  status: { configured: boolean; source: string | null; activeEnvironment: string | null; enabled: boolean };
};

type TestResult = { ok: boolean; diagnosis: string; results: { step: string; ok: boolean; ms: number; detail?: string }[] };

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(96,165,250,0.3)',
  borderRadius: 14,
  padding: '22px 26px',
};
const label: React.CSSProperties = { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 };
const input: React.CSSProperties = {
  width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.3)',
  background: 'rgba(0,0,0,0.25)', color: '#F2F2F2', fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
const pill = (active: boolean, color: string): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  border: `1px solid ${active ? color : 'rgba(255,255,255,0.12)'}`,
  background: active ? `${color}22` : 'transparent', color: active ? color : 'rgba(255,255,255,0.5)',
});

export function CorreosV3Settings() {
  const [s, setS] = useState<V3State | null>(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  const load = () =>
    fetch('/api/logistics/correos-v3', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => (d && !d.error ? setS(d) : setError(d?.error || 'No se pudo cargar')))
      .catch(() => setError('No se pudo cargar'));

  useEffect(() => {
    load();
  }, []);

  if (!s) {
    return <div style={card}><p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14, margin: 0 }}>{error || 'Cargando API v3…'}</p></div>;
  }

  const set = <K extends keyof V3State>(k: K, v: V3State[K]) => setS({ ...s, [k]: v });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/logistics/correos-v3', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: s.enabled, environment: s.environment, username: s.username, codCliente: s.codCliente,
          servicioId: s.servicioId, usuarioId: s.usuarioId, pickupCedula: s.pickupCedula, pickupEmail: s.pickupEmail,
          ...(password ? { password } : {}),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'No se pudo guardar');
      setPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch('/api/logistics/correos-v3', { method: 'POST', credentials: 'include' });
      setTest(await res.json());
    } catch {
      setTest({ ok: false, diagnosis: 'No se pudo ejecutar la prueba', results: [] });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={card} data-testid="correos-v3-settings">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <ShieldCheck size={18} aria-hidden style={{ color: '#60a5fa' }} />
        <div>
          <p style={{ color: '#F2F2F2', fontWeight: 700, fontSize: 15, margin: 0 }}>API v3 (REST) — nueva</p>
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, margin: '2px 0 0' }}>
            Guía en una sola llamada, PDF + etiqueta térmica, entrega en sucursal, recolecciones y rastreo con mapa.
          </p>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: s.status.enabled ? '#34d399' : 'rgba(255,255,255,0.4)' }}>
          {s.status.enabled ? `Activa (${s.status.activeEnvironment === 'prod' ? 'producción' : 'pruebas'})` : s.status.configured ? 'Configurada, apagada' : 'Sin configurar'}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ ...label, marginBottom: 0, marginRight: 4 }}>Ambiente</span>
          <button type="button" style={pill(s.environment === 'test', '#fbbf24')} onClick={() => set('environment', 'test')}>Pruebas</button>
          <button type="button" style={pill(s.environment === 'prod', '#34d399')} onClick={() => set('environment', 'prod')}>Producción</button>
          <span style={{ flex: 1 }} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.7)', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            Habilitar v3 en la plataforma
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <label style={label} htmlFor="v3-user">Usuario</label>
            <input id="v3-user" style={input} value={s.username} onChange={(e) => set('username', e.target.value)} placeholder="ccrWS…" autoComplete="off" />
          </div>
          <div>
            <label style={label} htmlFor="v3-pass">Contraseña {s.hasPassword && <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}>(vacío = mantener)</span>}</label>
            <input id="v3-pass" type="password" style={input} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={s.hasPassword ? '••••••••' : ''} autoComplete="new-password" />
          </div>
          <div>
            <label style={label} htmlFor="v3-cli">Código de cliente</label>
            <input id="v3-cli" style={input} value={s.codCliente} onChange={(e) => set('codCliente', e.target.value)} inputMode="numeric" />
          </div>
          <div>
            <label style={label} htmlFor="v3-svc">Código de servicio</label>
            <input id="v3-svc" style={input} value={s.servicioId} onChange={(e) => set('servicioId', e.target.value)} inputMode="numeric" placeholder="1564" />
          </div>
          <div>
            <label style={label} htmlFor="v3-uid">Usuario ID (opcional)</label>
            <input id="v3-uid" style={input} value={s.usuarioId} onChange={(e) => set('usuarioId', e.target.value)} />
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 12 }}>
          <p style={{ ...label, marginBottom: 10 }}>Solicitudes de recolección (Correos pide cédula y correo del solicitante)</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <input aria-label="Cédula para recolecciones" style={input} value={s.pickupCedula} onChange={(e) => set('pickupCedula', e.target.value)} placeholder="Cédula" />
            <input aria-label="Correo para recolecciones" style={input} value={s.pickupEmail} onChange={(e) => set('pickupEmail', e.target.value)} placeholder="correo@empresa.com" type="email" />
          </div>
        </div>

        {error && <p role="alert" style={{ color: '#f87171', fontSize: 12, margin: 0 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={save} disabled={saving}
            style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.45)', background: 'rgba(96,165,250,0.12)', color: '#93c5fd', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {saving ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : saved ? <><Check size={13} /> Guardado</> : <><Save size={13} /> Guardar API v3</>}
          </button>
          <button type="button" onClick={runTest} disabled={testing || !s.status.configured}
            style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: 'rgba(255,255,255,0.75)', fontWeight: 600, fontSize: 13, cursor: s.status.configured ? 'pointer' : 'default', opacity: s.status.configured ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            {testing ? <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plug size={13} />} Probar conexión
          </button>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, alignSelf: 'center' }}>{s.baseUrl}</span>
        </div>

        {test && (
          <div style={{ borderRadius: 10, padding: '12px 14px', border: `1px solid ${test.ok ? 'rgba(52,211,153,0.35)' : 'rgba(248,113,113,0.35)'}`, background: test.ok ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)' }}>
            <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 700, color: test.ok ? '#34d399' : '#f87171' }}>{test.diagnosis}</p>
            {test.results.map((r) => (
              <p key={r.step} style={{ margin: '2px 0', fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {r.ok ? <Check size={12} color="#34d399" /> : <XCircle size={12} color="#f87171" />}
                <strong style={{ minWidth: 80 }}>{r.step}</strong> {r.detail} <span style={{ opacity: 0.5 }}>{r.ms} ms</span>
              </p>
            ))}
          </div>
        )}

        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, margin: 0, lineHeight: 1.6 }}>
          Cada tienda elige v3 en Configuración › Envíos. Mientras v3 esté apagado, todo sigue por el Web Service SOAP de arriba.
        </p>
      </div>
    </div>
  );
}
