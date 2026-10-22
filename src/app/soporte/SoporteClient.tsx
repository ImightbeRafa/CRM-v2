'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronLeft, Loader2, Send } from 'lucide-react';
import { TurnstileWidget } from '@/components/aurora/auth/TurnstileWidget';
import {
  auroraBtnPrimary,
  auroraBtnSecondary,
  auroraInputClass,
  auroraLabelClass,
} from '@/components/aurora/ui/aurora-form';

type TicketRow = { id: string; ref: string; subject: string; statusLabel: string; createdAt: string; mine: boolean };
type Thread = {
  id: string;
  ref: string;
  subject: string;
  statusLabel: string;
  messages: { id: string; fromSupport: boolean; body: string; createdAt: string }[];
};

const CATEGORIES = [
  { id: 'question', label: 'Pregunta' },
  { id: 'bug', label: 'Algo no funciona' },
  { id: 'billing', label: 'Pagos y facturación' },
  { id: 'feature', label: 'Sugerencia' },
  { id: 'other', label: 'Otro' },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' });
}

function ContactForm() {
  const startedAt = useRef(Date.now());
  const [form, setForm] = useState({ name: '', email: '', subject: '', category: 'question', message: '', website: '' });
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string | null } | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.message.trim().length < 10) {
      setError('Contanos un poco más (mínimo 10 caracteres).');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/support/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          startedAt: startedAt.current,
          turnstileToken: token,
          pageUrl: window.location.pathname,
          locale: navigator.language,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; ticketNumber?: string | null; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error || 'No pudimos enviar tu mensaje. Intentá de nuevo.');
        setResetKey((k) => k + 1);
        return;
      }
      setDone({ ref: data.ticketNumber ?? null });
    } catch {
      setError('No pudimos enviar tu mensaje. Revisá tu conexión.');
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
        <CheckCircle2 className="mb-2 h-6 w-6" aria-hidden />
        <p className="text-[15px] font-semibold">¡Listo! Recibimos tu mensaje.</p>
        <p className="text-[13px]">
          {done.ref ? <>Tu número de caso es <strong>{done.ref}</strong>. </> : null}
          Te respondemos por correo lo antes posible.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm" noValidate>
      <h2 className="text-[16px] font-semibold">Escribinos</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={auroraLabelClass}>Nombre</span>
          <input className={auroraInputClass} value={form.name} onChange={set('name')} maxLength={120} required autoComplete="name" />
        </label>
        <label className="block">
          <span className={auroraLabelClass}>Correo</span>
          <input className={auroraInputClass} type="email" value={form.email} onChange={set('email')} maxLength={254} required autoComplete="email" />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_200px]">
        <label className="block">
          <span className={auroraLabelClass}>Asunto</span>
          <input className={auroraInputClass} value={form.subject} onChange={set('subject')} maxLength={200} required />
        </label>
        <label className="block">
          <span className={auroraLabelClass}>Tema</span>
          <select className={auroraInputClass} value={form.category} onChange={set('category')}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={auroraLabelClass}>Mensaje</span>
        <textarea className={`${auroraInputClass} min-h-[140px]`} value={form.message} onChange={set('message')} maxLength={5000} required />
      </label>
      {/* Honeypot: hidden from people, bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Sitio web
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
        </label>
      </div>
      <TurnstileWidget onToken={setToken} resetKey={resetKey} />
      {error && <p className="text-[13px] text-red-600" role="alert">{error}</p>}
      <button type="submit" className={auroraBtnPrimary} disabled={sending}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
        Enviar
      </button>
    </form>
  );
}

function MyTickets() {
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/support/tickets', { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) {
      setTickets(null);
      return;
    }
    const data = (await res.json()) as { tickets: TicketRow[] };
    setTickets(data.tickets);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(id: string) {
    setError(null);
    const res = await fetch(`/api/support/tickets/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!res.ok) {
      setError('No encontramos ese caso.');
      return;
    }
    setThread(((await res.json()) as { ticket: Thread }).ticket);
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!thread || !reply.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/support/tickets/${encodeURIComponent(thread.id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: reply }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setError('No se pudo enviar tu respuesta.');
      return;
    }
    setReply('');
    await open(thread.id);
  }

  // Not signed in (401) or support off: no "Mis tickets" block at all.
  if (tickets === null) return null;

  if (thread) {
    return (
      <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
        <button type="button" className="mb-3 inline-flex items-center gap-1 text-[13px] text-slate-500 hover:text-slate-800" onClick={() => { setThread(null); void load(); }}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Mis tickets
        </button>
        <h2 className="text-[16px] font-semibold">{thread.subject}</h2>
        <p className="mb-4 text-[12px] text-slate-500">{thread.ref} · {thread.statusLabel}</p>
        <ol className="mb-4 space-y-3">
          {thread.messages.map((m) => (
            <li key={m.id} className={`rounded-xl p-3 text-[13px] ${m.fromSupport ? 'bg-indigo-50 text-indigo-950' : 'bg-slate-50 text-slate-800'}`}>
              <p className="mb-1 text-[11px] font-medium text-slate-500">{m.fromSupport ? 'Soporte Betsy' : 'Vos'} · {formatDate(m.createdAt)}</p>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ol>
        <form onSubmit={sendReply} className="space-y-2">
          <textarea className={`${auroraInputClass} min-h-[90px]`} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} placeholder="Escribí tu respuesta" />
          {error && <p className="text-[13px] text-red-600" role="alert">{error}</p>}
          <button type="submit" className={auroraBtnSecondary} disabled={busy || !reply.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Responder
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-[16px] font-semibold">Mis tickets</h2>
      {error && <p className="mb-2 text-[13px] text-red-600" role="alert">{error}</p>}
      {tickets.length === 0 ? (
        <p className="text-[13px] text-slate-500">Todavía no tenés casos abiertos.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {tickets.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => void open(t.id)} className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium">{t.subject}</span>
                  <span className="block text-[12px] text-slate-500">{t.ref} · {formatDate(t.createdAt)}{t.mine ? '' : ' · de tu equipo'}</span>
                </span>
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{t.statusLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SoporteClient({ ticketsEnabled }: { ticketsEnabled: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <ContactForm />
      {ticketsEnabled && <MyTickets />}
    </div>
  );
}
