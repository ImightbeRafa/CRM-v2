'use client';

/**
 * Correos API v3 pieces for the guía dialog (Producción / Pedidos / Chats):
 * package box, per-order address check + branch picker + live quote,
 * tracking timeline and the pickup request panel.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  CheckCircle,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  Package,
  PackageCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import { Button } from '@/app/components/ui/button';

export type V3DeliveryType = 'Domicilio' | 'Sucursal' | 'Punto de correo';

export interface V3Package {
  pesoG: number;
  alto: number;
  largo: number;
  ancho: number;
}

export interface V3Branch {
  codigo: string;
  nombre: string;
  direccion: string | null;
  horario: string | null;
  correo: string | null;
  latitud: number;
  longitud: number;
}

export interface V3OrderState {
  barrio: string;
  branch: { codigo: string; nombre: string } | null;
  /** null = not checked yet / unknown */
  restricted: boolean | null;
  postalCode: string | null;
  quoteTotal: number | null;
  /** Ready for Correos v3 (branch picked for SUC, not restricted for DOM). */
  ready: boolean;
  problem: string | null;
}

export const EMPTY_V3_ORDER: V3OrderState = {
  barrio: '',
  branch: null,
  restricted: null,
  postalCode: null,
  quoteTotal: null,
  ready: false,
  problem: null,
};

export const crc = (n: number | null | undefined) =>
  n == null ? '—' : `₡${Math.round(n).toLocaleString('es-CR')}`;

const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'include', ...init });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error || `Error ${res.status}`), { status: res.status });
  return data;
}

// ─── Package (weight + size) ────────────────────────────────────────────────

export function PackageBox({ value, onChange }: { value: V3Package; onChange: (v: V3Package) => void }) {
  const field = (k: keyof V3Package, label: string, unit: string, max: number) => (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
      <span className="flex items-center rounded-md border bg-background focus-within:ring-1 focus-within:ring-primary">
        <input
          inputMode="numeric"
          aria-label={label}
          value={value[k] || ''}
          onChange={(e) => {
            const n = Math.min(max, Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0));
            onChange({ ...value, [k]: n });
          }}
          className="w-full min-w-0 bg-transparent px-2 py-1.5 text-xs outline-none"
          placeholder="0"
        />
        <span className="pr-2 text-[10px] text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
  return (
    <div className="rounded-lg border bg-card p-3" data-testid="v3-package">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
        <Package className="h-3.5 w-3.5 text-primary" /> Paquete
        <span className="font-normal text-muted-foreground">— Correos cobra por peso y tamaño</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field('pesoG', 'Peso', 'g', 30000)}
        {field('largo', 'Largo', 'cm', 300)}
        {field('ancho', 'Ancho', 'cm', 300)}
        {field('alto', 'Alto', 'cm', 300)}
      </div>
    </div>
  );
}

// ─── Branch picker ──────────────────────────────────────────────────────────

function BranchPicker({
  province,
  canton,
  district,
  value,
  onPick,
}: {
  province: string;
  canton: string;
  district: string;
  value: { codigo: string } | null;
  onPick: (b: V3Branch) => void;
}) {
  const [branches, setBranches] = useState<V3Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!province || !canton) {
      setBranches(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    const q = new URLSearchParams({ province, canton, district });
    getJson(`/api/shipping/correos/branches?${q}`)
      .then((d) => alive && setBranches(d.branches || []))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [province, canton, district]);

  // One branch in the canton: pick it for the user. A pick that is not in this canton's list is replaced.
  useEffect(() => {
    if (!branches) return;
    if (value && !branches.some((b) => b.codigo === value.codigo)) {
      if (branches.length === 1) onPick(branches[0]);
      return;
    }
    if (branches.length === 1 && !value) onPick(branches[0]);
  }, [branches, value, onPick]);

  if (!province || !canton) return <p className="text-xs text-amber-600">Elegí provincia y cantón para ver las sucursales.</p>;
  if (loading) return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Buscando sucursales…</p>;
  if (error) return <p className="text-xs text-red-500">{error}</p>;
  if (!branches || branches.length === 0) {
    return <p className="text-xs text-amber-600">No hay sucursales de Correos en {canton}. Elegí otro cantón cercano o entrega a domicilio.</p>;
  }
  return (
    <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Sucursal de Correos">
      {branches.map((b) => {
        const active = value?.codigo === b.codigo;
        return (
          <button
            key={b.codigo}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(b)}
            className={`rounded-md border p-2 text-left transition-colors ${
              active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent/40'
            }`}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Building2 className="h-3 w-3 text-primary" /> {b.nombre}
            </div>
            {b.direccion && <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{b.direccion}</div>}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
              {b.horario && <span className="inline-flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{b.horario}</span>}
              {Number.isFinite(b.latitud) && b.latitud !== 0 && (
                <a
                  href={mapsUrl(b.latitud, b.longitud)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  Mapa <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Per-order v3 block (inside each verification row) ──────────────────────

export function V3OrderExtras({
  province,
  canton,
  district,
  deliveryType,
  pkg,
  value,
  onChange,
}: {
  province: string;
  canton: string;
  district: string;
  deliveryType: V3DeliveryType;
  pkg: V3Package;
  value: V3OrderState;
  onChange: (v: V3OrderState) => void;
}) {
  const toBranch = deliveryType !== 'Domicilio';
  const place = useDebounced(`${province}|${canton}|${district}|${value.barrio}`, 450);
  const pkgKey = useDebounced(`${pkg.pesoG}|${pkg.alto}|${pkg.largo}|${pkg.ancho}`, 600);
  const [checking, setChecking] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [hasBranchInDistrict, setHasBranchInDistrict] = useState<boolean | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const latest = useRef(value);
  latest.current = value;
  // Readiness always uses the current props, also from callbacks created on an earlier render.
  const props = useRef({ toBranch, province, canton, district, onChange });
  props.current = { toBranch, province, canton, district, onChange };

  const emit = (patch: Partial<V3OrderState>) => {
    const p = props.current;
    const next = { ...latest.current, ...patch };
    const ready = p.toBranch ? !!next.branch : next.restricted !== true && !!p.province && !!p.canton && !!p.district;
    const problem = p.toBranch
      ? next.branch ? null : 'Elegí la sucursal'
      : next.restricted ? 'Zona restringida: usá entrega en sucursal' : null;
    latest.current = { ...next, ready, problem };
    p.onChange(latest.current);
  };

  // A branch belongs to a canton: a new province / canton drops the old pick.
  const cantonKey = `${province}|${canton}`;
  const prevCanton = useRef(cantonKey);
  useEffect(() => {
    if (prevCanton.current !== cantonKey) {
      prevCanton.current = cantonKey;
      if (latest.current.branch) emit({ branch: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cantonKey]);

  // Address check (domicilio): postal code + restricted barrio.
  useEffect(() => {
    if (toBranch) {
      emit({ restricted: null });
      return;
    }
    if (!province || !canton || !district) {
      emit({ restricted: null, postalCode: null });
      return;
    }
    let alive = true;
    setChecking(true);
    getJson('/api/shipping/correos/check-address', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ province, canton, district, barrio: latest.current.barrio || undefined }),
    })
      .then((d) => {
        if (!alive) return;
        setProblems(d.problems || []);
        setHasBranchInDistrict(!!d.poseeSucursal);
        emit({ restricted: !!d.restricted, postalCode: d.codigoPostal || null });
      })
      .catch((e) => alive && setProblems([e.message]))
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced place key drives this
  }, [place, toBranch]);

  // Live quote for this destination + package.
  useEffect(() => {
    if (!province || !canton || !district) return;
    let alive = true;
    setQuoting(true);
    setQuoteError(null);
    getJson('/api/shipping/correos/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dest: { province, canton, district },
        pesoG: pkg.pesoG || undefined,
        dims: { alto: pkg.alto, largo: pkg.largo, ancho: pkg.ancho },
      }),
    })
      .then((d) => alive && emit({ quoteTotal: Number(d.quote?.total) || 0 }))
      .catch((e) => {
        if (!alive) return;
        setQuoteError(e.message);
        emit({ quoteTotal: null });
      })
      .finally(() => alive && setQuoting(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced keys drive this
  }, [place, pkgKey]);

  // Re-evaluate readiness when the delivery type flips.
  useEffect(() => {
    emit({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toBranch]);

  const pick = useMemo(() => (b: V3Branch) => emit({ branch: { codigo: b.codigo, nombre: b.nombre } }), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mt-2.5 space-y-2 border-t border-border/50 pt-2.5" data-testid="v3-order-extras">
      {!toBranch && (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase text-muted-foreground">Barrio (opcional)</span>
            <input
              value={value.barrio}
              onChange={(e) => emit({ barrio: e.target.value.slice(0, 120) })}
              placeholder="Para revisar zonas restringidas"
              className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {checking ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Revisando…</span>
            ) : value.restricted ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                <XCircle className="h-3 w-3" /> Zona restringida
              </span>
            ) : value.postalCode ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle className="h-3 w-3" /> CP {value.postalCode}
              </span>
            ) : null}
            {hasBranchInDistrict && !value.restricted && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                <Building2 className="h-3 w-3" /> Sucursal cerca
              </span>
            )}
          </div>
        </div>
      )}
      {!toBranch && problems.length > 0 && !checking && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" /> {problems[0]}
        </p>
      )}

      {toBranch && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase text-muted-foreground">Sucursal donde retira el cliente</div>
          <BranchPicker province={province} canton={canton} district={district} value={value.branch} onPick={pick} />
        </div>
      )}

      <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground"><Truck className="h-3.5 w-3.5" /> Costo Correos</span>
        <span className="font-semibold tabular-nums">
          {quoting ? <Loader2 className="h-3 w-3 animate-spin" /> : quoteError ? <span className="font-normal text-muted-foreground">{quoteError.length > 60 ? 'Sin cotización' : quoteError}</span> : crc(value.quoteTotal)}
        </span>
      </div>
    </div>
  );
}

// ─── Tracking timeline ──────────────────────────────────────────────────────

interface TrackEvent { at: string | null; code?: string | null; description: string; place: string | null; receivedBy?: string | null; lat: number | null; lng: number | null }
interface Tracking {
  guiaNumber: string;
  status?: string;
  statusLabel?: string;
  statusText?: string | null;
  origin?: string | null;
  deliveredAt?: string | null;
  deliveredTo?: string | null;
  events: TrackEvent[];
}

const STATUS_TONE: Record<string, string> = {
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  returned: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  at_branch: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  out_for_delivery: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  in_transit: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
};

export function statusTone(status: string | null | undefined) {
  return STATUS_TONE[status || ''] || 'bg-muted text-muted-foreground';
}

function fmtWhen(s: string | null) {
  if (!s) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}-06:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });
}

/** endpoint: store route by default; logistics passes /api/logistics/tracking?envioId= */
export function TrackingTimeline({ guiaNumber, endpoint }: { guiaNumber: string; endpoint?: string }) {
  const [data, setData] = useState<{ live: boolean; tracking: Tracking } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getJson(endpoint ? `${endpoint}${encodeURIComponent(guiaNumber)}` : `/api/shipping/correos/track?guia=${encodeURIComponent(guiaNumber)}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [guiaNumber, endpoint]);

  if (error) return <p className="text-xs text-red-500">{error}</p>;
  if (!data) return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Consultando a Correos…</p>;
  const t = data.tracking;
  const events = [...(t.events || [])].reverse();
  return (
    <div className="space-y-2.5" data-testid="v3-tracking">
      <div className="flex flex-wrap items-center gap-2">
        {t.statusLabel && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone(t.status)}`}>{t.statusLabel}</span>}
        {t.statusText && t.statusText !== t.statusLabel && <span className="text-[11px] text-muted-foreground">{t.statusText}</span>}
        {!data.live && <span className="text-[10px] text-amber-600">Correos no respondió: mostrando lo último guardado</span>}
      </div>
      {t.deliveredAt && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <PackageCheck className="h-3.5 w-3.5" /> Entregado {fmtWhen(t.deliveredAt)}{t.deliveredTo ? ` · recibió ${t.deliveredTo}` : ''}
        </p>
      )}
      {events.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aún sin movimientos en Correos.</p>
      ) : (
        <ol className="relative ml-1.5 space-y-2.5 border-l border-border pl-4">
          {events.map((ev, i) => (
            <li key={`${ev.at}-${i}`} className="relative">
              <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background ${i === 0 ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
              <div className="text-xs font-medium leading-snug">{ev.description}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
                <span>{fmtWhen(ev.at)}</span>
                {ev.place && (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="h-2.5 w-2.5" />
                    {ev.lat != null && ev.lng != null ? (
                      <a href={mapsUrl(ev.lat, ev.lng)} target="_blank" rel="noreferrer" className="text-primary hover:underline">{ev.place}</a>
                    ) : ev.place}
                  </span>
                )}
                {ev.receivedBy && <span>· {ev.receivedBy}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── Pickup request ─────────────────────────────────────────────────────────

export function PickupPanel({ guias, onDone, onCancel }: { guias: string[]; onDone: (msg: string) => void; onCancel: () => void }) {
  const [address, setAddress] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per attempt: a double click or a network blip can't ask twice; a definite refusal gets a new key.
  const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [key, setKey] = useState(newKey);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const d = await getJson('/api/shipping/correos/pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guias, address: address || undefined, contactName: contactName || undefined, phone: phone || undefined, idempotencyKey: key }),
      });
      if (d.duplicate && d.status !== 'sent') {
        setError(d.status === 'unknown'
          ? 'No sabemos si Correos recibió la solicitud. Revisá con Correos antes de pedirla otra vez.'
          : 'Esta solicitud ya se está enviando.');
        return;
      }
      onDone(d.duplicate ? 'Esa recolección ya estaba solicitada.' : `Recolección solicitada para ${d.guias?.length ?? guias.length} guía(s). Correos te contactará.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo solicitar');
      // Only a definite refusal (4xx) gets a fresh key; a 5xx / network error may have reached Correos.
      const status = (e as { status?: number })?.status;
      if (status && status >= 400 && status < 500) setKey(newKey());
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3" data-testid="v3-pickup">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Truck className="h-4 w-4 text-primary" /> Solicitar recolección a Correos
        <span className="ml-auto text-xs font-normal text-muted-foreground">{guias.length} guía(s)</span>
      </div>
      <p className="text-xs text-muted-foreground">Correos pasa a recoger los paquetes. Si dejás los campos vacíos se usan los datos del remitente.</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <input value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} placeholder="Dirección de recolección" className="rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none sm:col-span-3" />
        <input value={contactName} onChange={(e) => setContactName(e.target.value.slice(0, 200))} placeholder="Nombre de contacto" className="rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none sm:col-span-2" />
        <input value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 20))} placeholder="Teléfono" inputMode="tel" className="rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none" />
      </div>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={sending}>Cancelar</Button>
        <Button size="sm" onClick={send} disabled={sending || guias.length === 0} className="gap-1.5">
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Truck className="h-3.5 w-3.5" />} Confirmar recolección
        </Button>
      </div>
    </div>
  );
}
