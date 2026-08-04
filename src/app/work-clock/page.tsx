'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Clock, LogIn, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { formatWorkforceDateTime } from '@/lib/workforce-datetime';

type ScheduleShift = {
  id: string;
  workDate: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  expectedPaidMinutes: number;
  lunchMinutes: number;
  isOff: boolean;
  notes: string;
};

type LookupData = {
  employee: { id: string; displayName: string };
  currentWeekStart: string;
  nextWeekEnd: string;
  schedule: ScheduleShift[];
  openEntry: { id: string; clockInAt: string } | null;
  verifiedCode: string;
};

const glass = {
  background: 'rgba(255,255,255,0.06)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 14,
} as const;

const WEEK_DAYS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];
const pad = (value: number) => String(value).padStart(2, '0');

function toDateKeyLocal(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDaysKey(key: string, days: number) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return toDateKeyLocal(date);
}

function formatDate(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' });
}

function formatDateTime(value: string) {
  return formatWorkforceDateTime(value);
}

function minutesToHours(minutes: number) {
  return Math.round((minutes / 60) * 100) / 100;
}

export default function WorkClockPage() {
  const [code, setCode] = useState('');
  const [data, setData] = useState<LookupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [punching, setPunching] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const normalizedCode = code.replace(/[^a-z0-9]/gi, '').toUpperCase();

  const weeks = useMemo(() => {
    if (!data) return [];
    const currentDates = Array.from({ length: 7 }, (_, index) => addDaysKey(data.currentWeekStart, index));
    const nextStart = addDaysKey(data.currentWeekStart, 7);
    const nextDates = Array.from({ length: 7 }, (_, index) => addDaysKey(nextStart, index));
    return [
      { label: 'Current week', dates: currentDates },
      { label: 'Next week', dates: nextDates },
    ];
  }, [data]);

  async function lookup(nextCode = normalizedCode) {
    if (!nextCode) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/work-clock/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: nextCode }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Invalid employee code');
      setData({ ...payload, verifiedCode: nextCode });
    } catch (error) {
      setData(null);
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo validar el codigo' });
    } finally {
      setLoading(false);
    }
  }

  async function punch() {
    if (!data || punching) return;
    setPunching(true);
    setMessage(null);
    try {
      const action = data.openEntry ? 'clock_out' : 'clock_in';
      const response = await fetch('/api/work-clock/punch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: data.verifiedCode,
          action,
          expectedEntryId: data.openEntry?.id ?? null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status === 409 && Object.prototype.hasOwnProperty.call(payload, 'openEntry')) {
          setData((current) => current ? { ...current, openEntry: payload.openEntry } : current);
        }
        throw new Error(payload?.error || 'No se pudo registrar');
      }
      setData((current) => current ? { ...current, openEntry: payload.openEntry ?? null } : current);
      const replayed = payload?.replayed === true;
      setMessage({
        type: 'success',
        text: action === 'clock_in'
          ? replayed ? 'La entrada ya estaba registrada.' : 'Entrada registrada.'
          : replayed ? 'La salida ya estaba registrada.' : 'Salida registrada.',
      });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo registrar' });
    } finally {
      setPunching(false);
    }
  }

  return (
    <main style={{
      minHeight: '100vh',
      background: '#0D0D0D',
      color: '#F2F2F2',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      padding: 20,
    }}>
      <div style={{ maxWidth: 980, margin: '0 auto', paddingTop: 38 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg,#6c3fff,#3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Clock size={22} color="white" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 25, fontWeight: 900 }}>Worker Clock</h1>
            <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.38)', fontSize: 13 }}>Horario y registro de entrada/salida</p>
          </div>
        </div>

        <section style={{ ...glass, padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,1fr) auto', gap: 10, alignItems: 'end' }}>
            <label style={{ display: 'grid', gap: 7 }}>
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Employee code</span>
              <input
                value={code}
                onChange={(event) => {
                  const nextCode = event.target.value.toUpperCase();
                  setCode(nextCode);
                  const nextNormalized = nextCode.replace(/[^a-z0-9]/gi, '').toUpperCase();
                  if (data && nextNormalized !== data.verifiedCode) {
                    setData(null);
                    setMessage(null);
                  }
                }}
                onKeyDown={(event) => { if (event.key === 'Enter') lookup(); }}
                placeholder="Enter code"
                autoComplete="off"
                disabled={punching}
                style={{ padding: '13px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(0,0,0,0.28)', color: '#F2F2F2', fontSize: 20, fontWeight: 900, letterSpacing: 1, outline: 'none' }}
              />
            </label>
            <button onClick={() => lookup()} disabled={loading || punching || !normalizedCode}
              style={{ padding: '13px 16px', borderRadius: 10, border: '1px solid rgba(139,135,255,0.35)', background: 'rgba(139,135,255,0.12)', color: '#8b87ff', cursor: 'pointer', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 8 }}>
              {loading ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <ShieldCheck size={15} />}
              Check
            </button>
          </div>
        </section>

        {message && (
          <div style={{ ...glass, padding: '12px 14px', marginBottom: 18, borderColor: message.type === 'error' ? 'rgba(248,113,113,0.35)' : 'rgba(52,211,153,0.35)', color: message.type === 'error' ? '#f87171' : '#34d399', fontWeight: 800, fontSize: 13 }}>
            {message.text}
          </div>
        )}

        {data && (
          <div style={{ display: 'grid', gap: 18 }}>
            <section style={{ ...glass, padding: 20, display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, alignItems: 'center' }}>
              <div>
                <p style={{ margin: '0 0 5px', color: 'rgba(255,255,255,0.42)', fontSize: 11, textTransform: 'uppercase', fontWeight: 900 }}>Employee</p>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>{data.employee.displayName}</h2>
                <p style={{ margin: '6px 0 0', color: data.openEntry ? '#34d399' : 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: 800 }}>
                  {data.openEntry ? `Clocked in at ${formatDateTime(data.openEntry.clockInAt)}` : 'Not clocked in'}
                </p>
              </div>
              <button onClick={punch} disabled={punching}
                style={{ padding: '14px 18px', borderRadius: 10, border: `1px solid ${data.openEntry ? 'rgba(248,113,113,0.35)' : 'rgba(52,211,153,0.35)'}`, background: data.openEntry ? 'rgba(248,113,113,0.1)' : 'rgba(52,211,153,0.1)', color: data.openEntry ? '#f87171' : '#34d399', cursor: 'pointer', fontSize: 15, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 9 }}>
                {data.openEntry ? <LogOut size={18} /> : <LogIn size={18} />}
                {punching ? 'Saving...' : data.openEntry ? 'Clock out' : 'Clock in'}
              </button>
            </section>

            {weeks.map((week) => (
              <section key={week.label} style={{ ...glass, padding: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <CalendarDays size={16} color="#60a5fa" />
                  <p style={{ margin: 0, fontSize: 16, fontWeight: 900 }}>{week.label}</p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(132px,1fr))', gap: 10 }}>
                  {week.dates.map((date, index) => {
                    const shift = data.schedule.find((item) => item.workDate === date);
                    const isOff = !shift || shift.isOff || shift.expectedPaidMinutes <= 0;
                    return (
                      <div key={date} style={{ minHeight: 132, padding: 12, borderRadius: 10, border: `1px solid ${isOff ? 'rgba(255,255,255,0.08)' : 'rgba(52,211,153,0.18)'}`, background: isOff ? 'rgba(255,255,255,0.025)' : 'rgba(52,211,153,0.055)' }}>
                        <p style={{ margin: '0 0 4px', color: '#F2F2F2', fontWeight: 900 }}>{WEEK_DAYS[index]}</p>
                        <p style={{ margin: '0 0 12px', color: 'rgba(255,255,255,0.38)', fontSize: 12 }}>{formatDate(date)}</p>
                        {isOff ? (
                          <p style={{ margin: 0, color: 'rgba(255,255,255,0.32)', fontWeight: 800 }}>Libre</p>
                        ) : (
                          <>
                            <p style={{ margin: '0 0 5px', color: '#34d399', fontWeight: 900 }}>{shift.shiftStart} - {shift.shiftEnd}</p>
                            <p style={{ margin: '0 0 6px', color: 'rgba(255,255,255,0.48)', fontSize: 12 }}>{minutesToHours(shift.expectedPaidMinutes)}h expected</p>
                            {shift.notes && <p style={{ margin: 0, color: 'rgba(255,255,255,0.44)', fontSize: 11 }}>{shift.notes}</p>}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #0D0D0D; }
        input { color-scheme: dark; }
        input::placeholder { color: rgba(255,255,255,0.24); }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </main>
  );
}
