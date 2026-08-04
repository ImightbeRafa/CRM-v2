'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CalendarDays,
  Clock,
  Copy,
  Download,
  Eye,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import {
  costaRicaDateTimeLocalToIso,
  costaRicaDateTimeLocalToUtc,
  formatWorkforceDateTime,
  toCostaRicaDateTimeLocal,
} from '@/lib/workforce-datetime';

type Tab = 'employees' | 'schedule' | 'schedule-edit' | 'time' | 'payroll' | 'coverage';

type Employee = {
  id: string;
  displayName: string;
  active: boolean;
  hourlyRateCrc: number;
  codeLastGeneratedAt: string | null;
  legacyStaffName: string | null;
};

type Shift = {
  id?: string;
  employeeId: string;
  employeeName?: string;
  workDate: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  expectedPaidMinutes: number;
  lunchMinutes: number;
  isOff: boolean;
  notes: string;
};

type TimeEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  clockInAt: string;
  clockOutAt: string | null;
  hourlyRateCrc: number;
  paidMinutes: number | null;
  source: string;
  correctionNote: string | null;
  voidedAt: string | null;
  status: 'open' | 'completed' | 'voided';
};

type PayrollEntry = Omit<TimeEntry, 'paidMinutes'> & {
  paidMinutes: number;
  payCrc: number;
};

type PayrollEmployee = {
  employeeId: string;
  employeeName: string;
  paidMinutes: number;
  hours: number;
  totalCrc: number;
  entries: PayrollEntry[];
};

const glass = {
  background: 'rgba(255,255,255,0.05)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 14,
} as const;

const glassHi = {
  background: 'rgba(255,255,255,0.08)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 14,
} as const;

const WEEK_DAYS = [
  { key: 0, label: 'Lunes', short: 'Lun' },
  { key: 1, label: 'Martes', short: 'Mar' },
  { key: 2, label: 'Miercoles', short: 'Mie' },
  { key: 3, label: 'Jueves', short: 'Jue' },
  { key: 4, label: 'Viernes', short: 'Vie' },
  { key: 5, label: 'Sabado', short: 'Sab' },
  { key: 6, label: 'Domingo', short: 'Dom' },
];

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: 'employees', label: 'Employees', icon: Users },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'schedule-edit', label: 'Edit Schedule', icon: Save },
  { id: 'time', label: 'Time Clock', icon: Clock },
  { id: 'payroll', label: 'Payroll', icon: Download },
  { id: 'coverage', label: 'Coverage', icon: Eye },
];

const fmtMoney = (value: number) => `CRC ${Math.round(value || 0).toLocaleString('es-CR')}`;
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

function getWeekStartKey(key = toDateKeyLocal(new Date())) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return toDateKeyLocal(date);
}

function getWeekDates(weekStart: string) {
  return WEEK_DAYS.map((day) => addDaysKey(weekStart, day.key));
}

function formatShortDate(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('es-CR', { day: '2-digit', month: 'short' });
}

function formatDateTime(value: string | null | undefined) {
  return formatWorkforceDateTime(value);
}

function toDateTimeInput(value: string | null | undefined) {
  return toCostaRicaDateTimeLocal(value);
}

function minutesToHours(minutes: number) {
  return Math.round((minutes / 60) * 100) / 100;
}

function calculateShiftMinutes(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  return Math.max(0, endMinutes - startMinutes);
}

function timeToMinutes(value: string | null) {
  if (!value) return 0;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function formatTimeRange(shift: Shift) {
  if (shift.isOff || !shift.shiftStart || !shift.shiftEnd || shift.expectedPaidMinutes <= 0) return 'Off';
  return `${shift.shiftStart} - ${shift.shiftEnd}`;
}

function shiftKey(employeeId: string, workDate: string) {
  return `${employeeId}:${workDate}`;
}

function defaultShift(employeeId: string, workDate: string): Shift {
  return {
    employeeId,
    workDate,
    shiftStart: '09:00',
    shiftEnd: '17:00',
    expectedPaidMinutes: 0,
    lunchMinutes: 0,
    isOff: true,
    notes: '',
  };
}

function buildCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function downloadCsv(filename: string, csv: string) {
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

export default function WorkforcePage() {
  const [tab, setTab] = useState<Tab>('employees');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [newName, setNewName] = useState('');
  const [newRate, setNewRate] = useState('1250');
  const [generatedCode, setGeneratedCode] = useState<{ employeeName: string; code: string } | null>(null);
  const [employeeActionId, setEmployeeActionId] = useState<string | null>(null);

  const todayWeekStart = useMemo(() => getWeekStartKey(), []);
  const [scheduleWeekStart, setScheduleWeekStart] = useState(todayWeekStart);
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, Shift>>({});
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [quickEmployeeId, setQuickEmployeeId] = useState('all');
  const [quickStart, setQuickStart] = useState('09:00');
  const [quickEnd, setQuickEnd] = useState('17:00');
  const [quickDays, setQuickDays] = useState<Record<number, boolean>>({
    0: true,
    1: true,
    2: true,
    3: true,
    4: true,
    5: false,
    6: false,
  });

  const [timeWeekStart, setTimeWeekStart] = useState(todayWeekStart);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [timeLoading, setTimeLoading] = useState(false);
  const [timeSaving, setTimeSaving] = useState(false);
  const timeEntriesRequestId = useRef(0);
  const [editingEntry, setEditingEntry] = useState<{
    id: string;
    clockInAt: string;
    clockOutAt: string;
    correctionNote: string;
    mode: 'edit' | 'restore';
  } | null>(null);

  const [payrollWeekStart, setPayrollWeekStart] = useState(todayWeekStart);
  const [payroll, setPayroll] = useState<{
    totals: { paidMinutes: number; hours: number; totalCrc: number };
    employees: PayrollEmployee[];
    openEntries: Array<{ id: string; employeeName: string; clockInAt: string }>;
  } | null>(null);
  const [payrollLoading, setPayrollLoading] = useState(false);

  const [coverageWeekStart, setCoverageWeekStart] = useState(todayWeekStart);
  const [coverageShifts, setCoverageShifts] = useState<Shift[]>([]);
  const [coverageEntries, setCoverageEntries] = useState<TimeEntry[]>([]);
  const [coverageLoading, setCoverageLoading] = useState(false);

  const activeEmployees = employees.filter((employee) => employee.active);
  const scheduleWeekDates = useMemo(() => getWeekDates(scheduleWeekStart), [scheduleWeekStart]);
  const scheduleSummary = activeEmployees.reduce((summary, employee) => {
    for (const date of scheduleWeekDates) {
      const shift = scheduleDraft[shiftKey(employee.id, date)] || defaultShift(employee.id, date);
      const expectedMinutes = shift.isOff ? 0 : calculateShiftMinutes(shift.shiftStart, shift.shiftEnd);
      if (expectedMinutes > 0) {
        summary.scheduledShifts += 1;
        summary.scheduledMinutes += expectedMinutes;
      } else {
        summary.emptyDays += 1;
      }
    }
    return summary;
  }, { scheduledShifts: 0, scheduledMinutes: 0, emptyDays: 0 });
  const timeWeekEnd = addDaysKey(timeWeekStart, 6);
  const payrollWeekEnd = addDaysKey(payrollWeekStart, 6);
  const coverageWeekDates = useMemo(() => getWeekDates(coverageWeekStart), [coverageWeekStart]);

  const loadEmployees = useCallback(async () => {
    setEmployeesLoading(true);
    try {
      const response = await fetch('/api/logistics/workforce/employees');
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load employees');
      setEmployees(data.employees || []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudieron cargar empleados' });
    } finally {
      setEmployeesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    try {
      const weekEnd = addDaysKey(scheduleWeekStart, 6);
      const response = await fetch(`/api/logistics/workforce/schedule?dateFrom=${scheduleWeekStart}&dateTo=${weekEnd}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load schedule');
      if (Array.isArray(data.employees)) setEmployees(data.employees);

      const nextDraft: Record<string, Shift> = {};
      const visibleEmployees = (data.employees || []).filter((employee: Employee) => employee.active);
      for (const employee of visibleEmployees) {
        for (const workDate of scheduleWeekDates) {
          nextDraft[shiftKey(employee.id, workDate)] = defaultShift(employee.id, workDate);
        }
      }
      for (const shift of data.shifts || []) {
        nextDraft[shiftKey(shift.employeeId, shift.workDate)] = {
          employeeId: shift.employeeId,
          workDate: shift.workDate,
          shiftStart: shift.shiftStart || '09:00',
          shiftEnd: shift.shiftEnd || '17:00',
          expectedPaidMinutes: Number(shift.expectedPaidMinutes) || 0,
          lunchMinutes: Number(shift.lunchMinutes) || 0,
          isOff: Boolean(shift.isOff),
          notes: shift.notes || '',
        };
      }
      setScheduleDraft(nextDraft);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo cargar horario' });
    } finally {
      setScheduleLoading(false);
    }
  }, [scheduleWeekDates, scheduleWeekStart]);

  useEffect(() => {
    if (tab === 'schedule' || tab === 'schedule-edit') loadSchedule();
  }, [tab, loadSchedule]);

  const loadTimeEntries = useCallback(async () => {
    const requestId = ++timeEntriesRequestId.current;
    setTimeLoading(true);
    try {
      const response = await fetch(`/api/logistics/workforce/time-entries?dateFrom=${timeWeekStart}&dateTo=${timeWeekEnd}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load time entries');
      if (requestId !== timeEntriesRequestId.current) return;
      setTimeEntries(data.entries || []);
    } catch (error) {
      if (requestId !== timeEntriesRequestId.current) return;
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo cargar entradas' });
    } finally {
      if (requestId === timeEntriesRequestId.current) setTimeLoading(false);
    }
  }, [timeWeekEnd, timeWeekStart]);

  useEffect(() => {
    if (tab === 'time') loadTimeEntries();
  }, [tab, loadTimeEntries]);

  const loadPayroll = useCallback(async () => {
    setPayrollLoading(true);
    try {
      const response = await fetch(`/api/logistics/workforce/payroll?dateFrom=${payrollWeekStart}&dateTo=${payrollWeekEnd}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to load payroll');
      setPayroll(data);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo cargar planilla' });
    } finally {
      setPayrollLoading(false);
    }
  }, [payrollWeekEnd, payrollWeekStart]);

  useEffect(() => {
    if (tab === 'payroll') loadPayroll();
  }, [tab, loadPayroll]);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const coverageWeekEnd = addDaysKey(coverageWeekStart, 6);
      const [scheduleResponse, entriesResponse] = await Promise.all([
        fetch(`/api/logistics/workforce/schedule?dateFrom=${coverageWeekStart}&dateTo=${coverageWeekEnd}`),
        fetch(`/api/logistics/workforce/time-entries?dateFrom=${coverageWeekStart}&dateTo=${coverageWeekEnd}`),
      ]);
      const scheduleData = await scheduleResponse.json();
      const entriesData = await entriesResponse.json();
      if (!scheduleResponse.ok) throw new Error(scheduleData?.error || 'Failed to load schedule');
      if (!entriesResponse.ok) throw new Error(entriesData?.error || 'Failed to load time entries');
      setCoverageShifts(scheduleData.shifts || []);
      setCoverageEntries((entriesData.entries || []).filter((entry: TimeEntry) => entry.clockOutAt && !entry.voidedAt));
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo cargar cobertura' });
    } finally {
      setCoverageLoading(false);
    }
  }, [coverageWeekStart]);

  useEffect(() => {
    if (tab === 'coverage') loadCoverage();
  }, [tab, loadCoverage]);

  async function createEmployee() {
    const hourlyRateCrc = Number(newRate);
    if (!newName.trim() || !Number.isFinite(hourlyRateCrc) || hourlyRateCrc <= 0) return;
    const response = await fetch('/api/logistics/workforce/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: newName.trim(), hourlyRateCrc }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage({ type: 'error', text: data?.error || 'No se pudo crear empleado' });
      return;
    }
    setNewName('');
    setNewRate('1250');
    setMessage({ type: 'success', text: 'Empleado creado. Genera un codigo cuando este listo para usar el reloj.' });
    await loadEmployees();
  }

  async function updateEmployee(employee: Employee, patch: Partial<Employee> & { regenerateCode?: boolean }) {
    if (employeeActionId) return;
    setEmployeeActionId(employee.id);
    try {
      const response = await fetch('/api/logistics/workforce/employees', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: employee.id,
          displayName: patch.displayName,
          active: patch.active,
          hourlyRateCrc: patch.hourlyRateCrc,
          regenerateCode: patch.regenerateCode,
          expectedCodeLastGeneratedAt: patch.regenerateCode
            ? employee.codeLastGeneratedAt
            : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage({ type: 'error', text: data?.error || 'No se pudo actualizar empleado' });
        if (response.status === 409) await loadEmployees();
        return;
      }
      if (data.code) setGeneratedCode({ employeeName: data.employee.displayName, code: data.code });
      setMessage({ type: 'success', text: patch.regenerateCode ? 'Codigo generado. Copialo ahora; no se vuelve a mostrar.' : 'Empleado actualizado.' });
      await loadEmployees();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo actualizar empleado' });
    } finally {
      setEmployeeActionId(null);
    }
  }

  function updateDraft(employeeId: string, workDate: string, patch: Partial<Shift>) {
    setScheduleDraft((prev) => {
      const current = prev[shiftKey(employeeId, workDate)] || defaultShift(employeeId, workDate);
      const next = { ...current, ...patch };
      if (patch.isOff === true) {
        next.expectedPaidMinutes = 0;
        next.lunchMinutes = 0;
      }
      if (patch.isOff === false && current.isOff) {
        next.expectedPaidMinutes = calculateShiftMinutes(next.shiftStart, next.shiftEnd) || 480;
        next.lunchMinutes = 0;
      }
      if ((patch.shiftStart !== undefined || patch.shiftEnd !== undefined) && !next.isOff) {
        next.expectedPaidMinutes = calculateShiftMinutes(next.shiftStart, next.shiftEnd);
        next.lunchMinutes = 0;
      }
      next.lunchMinutes = 0;
      return { ...prev, [shiftKey(employeeId, workDate)]: next };
    });
  }

  function applyQuickShift() {
    const selectedDays = WEEK_DAYS.filter((day) => quickDays[day.key]);
    if (selectedDays.length === 0) {
      setMessage({ type: 'error', text: 'Selecciona al menos un dia.' });
      return;
    }
    const expectedPaidMinutes = calculateShiftMinutes(quickStart, quickEnd);
    if (expectedPaidMinutes <= 0) {
      setMessage({ type: 'error', text: 'La hora final debe ser despues de la hora inicial.' });
      return;
    }

    const targetEmployees = quickEmployeeId === 'all'
      ? activeEmployees
      : activeEmployees.filter((employee) => employee.id === quickEmployeeId);

    if (targetEmployees.length === 0) {
      setMessage({ type: 'error', text: 'Selecciona al menos un empleado activo.' });
      return;
    }

    setScheduleDraft((prev) => {
      const next = { ...prev };
      for (const employee of targetEmployees) {
        for (const day of selectedDays) {
          const workDate = scheduleWeekDates[day.key];
          const key = shiftKey(employee.id, workDate);
          next[key] = {
            ...(next[key] || defaultShift(employee.id, workDate)),
            employeeId: employee.id,
            workDate,
            shiftStart: quickStart,
            shiftEnd: quickEnd,
            expectedPaidMinutes,
            lunchMinutes: 0,
            isOff: false,
          };
        }
      }
      return next;
    });
    setMessage({ type: 'success', text: 'Turnos aplicados al borrador. Guarda la semana para publicar los cambios.' });
  }

  async function saveSchedule() {
    setScheduleSaving(true);
    try {
      const weekEnd = addDaysKey(scheduleWeekStart, 6);
      const entries = activeEmployees.flatMap((employee) =>
        scheduleWeekDates.map((workDate) => {
          const shift = scheduleDraft[shiftKey(employee.id, workDate)] || defaultShift(employee.id, workDate);
          return {
            ...shift,
            lunchMinutes: 0,
            expectedPaidMinutes: shift.isOff ? 0 : calculateShiftMinutes(shift.shiftStart, shift.shiftEnd),
          };
        })
      );
      const response = await fetch('/api/logistics/workforce/schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateFrom: scheduleWeekStart,
          dateTo: weekEnd,
          employeeIds: activeEmployees.map((employee) => employee.id),
          entries,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Failed to save schedule');
      setMessage({ type: 'success', text: `Horario guardado (${data.saved || entries.length} turnos).` });
      await loadSchedule();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo guardar horario' });
    } finally {
      setScheduleSaving(false);
    }
  }

  async function saveTimeCorrection(voided = false, restored = false) {
    if (!editingEntry || timeSaving) return;

    const correctionNote = editingEntry.correctionNote.trim();
    if (!correctionNote) {
      setMessage({ type: 'error', text: 'La nota de correccion es obligatoria.' });
      return;
    }

    if (voided && !window.confirm('¿Anular esta entrada? Dejará de contar como una jornada abierta o pagada.')) {
      return;
    }

    let body: Record<string, unknown> = {
      id: editingEntry.id,
      correctionNote,
      voided,
      restored,
    };

    if (!voided && !restored) {
      const clockInAt = costaRicaDateTimeLocalToIso(editingEntry.clockInAt);
      if (!clockInAt) {
        setMessage({ type: 'error', text: 'Hora de entrada invalida.' });
        return;
      }

      const clockOutRaw = editingEntry.clockOutAt.trim();
      let clockOutAt: string | null = null;
      if (clockOutRaw) {
        clockOutAt = costaRicaDateTimeLocalToIso(clockOutRaw);
        if (!clockOutAt) {
          setMessage({ type: 'error', text: 'Hora de salida invalida.' });
          return;
        }
        if (new Date(clockOutAt) <= new Date(clockInAt)) {
          setMessage({ type: 'error', text: 'La salida debe ser despues de la entrada.' });
          return;
        }
      }

      body = { ...body, clockInAt, clockOutAt };
    }

    setTimeSaving(true);
    try {
      const response = await fetch('/api/logistics/workforce/time-entries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage({ type: 'error', text: data?.error || 'No se pudo corregir entrada' });
        return;
      }
      setEditingEntry(null);
      setMessage({
        type: 'success',
        text: voided ? 'Entrada anulada.' : restored ? 'Entrada restaurada.' : 'Entrada corregida.',
      });
      await loadTimeEntries();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo corregir entrada' });
    } finally {
      setTimeSaving(false);
    }
  }

  function exportPayroll() {
    if (!payroll) return;
    const rows = [
      ['Employee', 'Clock In', 'Clock Out', 'Minutes', 'Hours', 'Rate CRC', 'Pay CRC'],
      ...payroll.employees.flatMap((employee) =>
        employee.entries.map((entry) => [
          employee.employeeName,
          formatDateTime(entry.clockInAt),
          formatDateTime(entry.clockOutAt),
          String(entry.paidMinutes),
          String(minutesToHours(entry.paidMinutes)),
          String(entry.hourlyRateCrc),
          String(entry.payCrc),
        ])
      ),
    ];
    downloadCsv(`workforce_payroll_${payrollWeekStart}.csv`, buildCsv(rows));
  }

  const coverageSlots = useMemo(() => {
    const slots: string[] = [];
    for (let minute = 8 * 60; minute < 20 * 60; minute += 30) {
      slots.push(`${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`);
    }
    return slots;
  }, []);

  function getScheduledNames(workDate: string, slot: string) {
    const slotStart = timeToMinutes(slot);
    const slotEnd = slotStart + 30;
    return coverageShifts
      .filter((shift) => {
        if (shift.workDate !== workDate || shift.isOff || !shift.shiftStart || !shift.shiftEnd) return false;
        return timeToMinutes(shift.shiftStart) < slotEnd && timeToMinutes(shift.shiftEnd) > slotStart;
      })
      .map((shift) => shift.employeeName || employees.find((employee) => employee.id === shift.employeeId)?.displayName || 'Empleado');
  }

  function getActualNames(workDate: string, slot: string) {
    const slotStart = costaRicaDateTimeLocalToUtc(`${workDate}T${slot}`);
    if (!slotStart) return [];
    const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
    return coverageEntries
      .filter((entry) => {
        if (!entry.clockOutAt) return false;
        const clockIn = new Date(entry.clockInAt);
        const clockOut = new Date(entry.clockOutAt);
        return clockIn < slotEnd && clockOut > slotStart;
      })
      .map((entry) => entry.employeeName);
  }

  return (
    <div style={{ maxWidth: 1440, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ color: '#F2F2F2', fontSize: 26, fontWeight: 800, margin: '0 0 4px' }}>Workforce</h1>
          <p style={{ color: 'rgba(255,255,255,0.36)', fontSize: 13, margin: 0 }}>
            Horarios, reloj de entrada/salida, cobertura y pagos por hora real trabajada.
          </p>
        </div>
        <a href="/work-clock" target="_blank" rel="noreferrer"
          style={{ ...glass, padding: '9px 14px', color: '#8b87ff', textDecoration: 'none', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Clock size={14} /> Worker Clock
        </a>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.08)', overflowX: 'auto' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 16px', borderRadius: '8px 8px 0 0', border: 'none', borderBottom: tab === id ? '2px solid #8b87ff' : '2px solid transparent', background: tab === id ? 'rgba(139,135,255,0.09)' : 'transparent', color: tab === id ? '#F2F2F2' : 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: tab === id ? 800 : 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {message && (
        <div style={{ ...glass, padding: '11px 14px', marginBottom: 18, borderColor: message.type === 'error' ? 'rgba(248,113,113,0.35)' : 'rgba(52,211,153,0.35)', color: message.type === 'error' ? '#f87171' : '#34d399', fontSize: 13, fontWeight: 700 }}>
          {message.text}
        </div>
      )}

      {generatedCode && (
        <div style={{ ...glassHi, padding: 16, marginBottom: 18, borderColor: 'rgba(251,191,36,0.35)' }}>
          <p style={{ color: '#fbbf24', fontSize: 12, fontWeight: 900, margin: '0 0 8px', textTransform: 'uppercase' }}>Codigo visible una sola vez</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <p style={{ color: '#F2F2F2', margin: 0, fontWeight: 800 }}>{generatedCode.employeeName}</p>
            <code style={{ padding: '7px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.35)', color: '#fbbf24', fontSize: 20, fontWeight: 900, letterSpacing: 1 }}>{generatedCode.code}</code>
            <button onClick={() => navigator.clipboard?.writeText(generatedCode.code)}
              style={{ padding: '7px 11px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
              <Copy size={13} /> Copy
            </button>
          </div>
        </div>
      )}

      {tab === 'employees' && (
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ ...glassHi, padding: 18 }}>
            <p style={{ color: '#F2F2F2', fontWeight: 900, margin: '0 0 14px', fontSize: 16 }}>Create employee</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 180px auto', gap: 10, alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Name</span>
                <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Employee name"
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.26)', color: '#F2F2F2', outline: 'none' }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Hourly rate</span>
                <input type="number" value={newRate} onChange={(event) => setNewRate(event.target.value)}
                  style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.26)', color: '#F2F2F2', outline: 'none' }} />
              </label>
              <button onClick={createEmployee}
                style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.35)', background: 'rgba(139,135,255,0.1)', color: '#8b87ff', cursor: 'pointer', fontWeight: 900, display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center' }}>
                <UserPlus size={14} /> Create
              </button>
            </div>
          </div>

          <div style={{ ...glass, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Employee', 'Hourly Rate', 'Status', 'Code', 'Actions'].map((header) => (
                    <th key={header} style={{ textAlign: 'left', padding: '11px 14px', color: 'rgba(255,255,255,0.38)', fontSize: 11, textTransform: 'uppercase' }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {employeesLoading ? (
                  <tr><td colSpan={5} style={{ padding: 26, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>Loading employees...</td></tr>
                ) : employees.map((employee) => (
                  <EmployeeRow
                    key={employee.id}
                    employee={employee}
                    onUpdate={updateEmployee}
                    busy={employeeActionId === employee.id}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'schedule' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <WeekToolbar weekStart={scheduleWeekStart} onWeekStartChange={setScheduleWeekStart} onRefresh={loadSchedule} loading={scheduleLoading} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(140px,1fr))', gap: 12 }}>
            <Metric label="Active Employees" value={String(activeEmployees.length)} color="#8b87ff" />
            <Metric
              label="Scheduled Shifts"
              value={String(scheduleSummary.scheduledShifts)}
              color="#34d399"
            />
            <Metric
              label="Scheduled Hours"
              value={String(minutesToHours(scheduleSummary.scheduledMinutes))}
              color="#60a5fa"
            />
            <Metric
              label="Empty Days"
              value={String(scheduleSummary.emptyDays)}
              color="#fbbf24"
            />
          </div>

          <div style={{ ...glass, overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 1040, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ width: 150, textAlign: 'left', padding: '11px 12px', color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase' }}>Employee</th>
                  {scheduleWeekDates.map((date, index) => (
                    <th key={date} style={{ textAlign: 'left', padding: '11px 12px', color: 'rgba(255,255,255,0.44)' }}>
                      <p style={{ margin: '0 0 2px', color: '#F2F2F2', fontWeight: 900 }}>{WEEK_DAYS[index].short}</p>
                      <p style={{ margin: 0, color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{formatShortDate(date)}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleLoading ? (
                  <tr><td colSpan={8} style={{ padding: 28, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>Loading schedule...</td></tr>
                ) : activeEmployees.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 28, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>Create an active employee before scheduling.</td></tr>
                ) : activeEmployees.map((employee) => (
                  <tr key={employee.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: 12, color: '#F2F2F2', fontWeight: 900 }}>{employee.displayName}</td>
                    {scheduleWeekDates.map((date) => {
                      const shift = scheduleDraft[shiftKey(employee.id, date)] || defaultShift(employee.id, date);
                      return (
                        <td key={date} style={{ padding: 9, verticalAlign: 'top' }}>
                          <ReadOnlyScheduleCell shift={shift} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'schedule-edit' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <WeekToolbar
            weekStart={scheduleWeekStart}
            onWeekStartChange={setScheduleWeekStart}
            onRefresh={loadSchedule}
            loading={scheduleLoading}
            action={<button onClick={saveSchedule} disabled={scheduleSaving || activeEmployees.length === 0}
              style={{ padding: '8px 13px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.35)', background: 'rgba(52,211,153,0.08)', color: '#34d399', cursor: 'pointer', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Save size={13} /> {scheduleSaving ? 'Saving...' : 'Save week'}
            </button>}
          />

          <div style={{ ...glassHi, padding: 16, display: 'grid', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) 120px 120px auto', gap: 10, alignItems: 'end' }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: 'rgba(255,255,255,0.44)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Apply to</span>
                <select value={quickEmployeeId} onChange={(event) => setQuickEmployeeId(event.target.value)}
                  style={{ padding: '9px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.28)', color: '#F2F2F2', outline: 'none' }}>
                  <option value="all">All active employees</option>
                  {activeEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>{employee.displayName}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: 'rgba(255,255,255,0.44)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>Start</span>
                <input type="time" value={quickStart} onChange={(event) => setQuickStart(event.target.value)}
                  style={{ padding: '9px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.28)', color: '#F2F2F2', outline: 'none' }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ color: 'rgba(255,255,255,0.44)', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>End</span>
                <input type="time" value={quickEnd} onChange={(event) => setQuickEnd(event.target.value)}
                  style={{ padding: '9px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.28)', color: '#F2F2F2', outline: 'none' }} />
              </label>
              <button onClick={applyQuickShift}
                style={{ padding: '9px 13px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.35)', background: 'rgba(139,135,255,0.1)', color: '#8b87ff', cursor: 'pointer', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center' }}>
                <CalendarDays size={13} /> Apply
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {WEEK_DAYS.map((day) => (
                <button key={day.key} onClick={() => setQuickDays((prev) => ({ ...prev, [day.key]: !prev[day.key] }))}
                  style={{ padding: '7px 10px', minWidth: 52, borderRadius: 8, border: `1px solid ${quickDays[day.key] ? 'rgba(52,211,153,0.35)' : 'rgba(255,255,255,0.12)'}`, background: quickDays[day.key] ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.035)', color: quickDays[day.key] ? '#34d399' : 'rgba(255,255,255,0.48)', cursor: 'pointer', fontWeight: 900 }}>
                  {day.short}
                </button>
              ))}
              <span style={{ alignSelf: 'center', color: 'rgba(255,255,255,0.36)', fontSize: 12, fontWeight: 800 }}>
                Expected {minutesToHours(calculateShiftMinutes(quickStart, quickEnd))}h per selected day
              </span>
            </div>
          </div>

          <div style={{ ...glass, overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 1120, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ width: 150, textAlign: 'left', padding: '11px 12px', color: 'rgba(255,255,255,0.38)', textTransform: 'uppercase' }}>Employee</th>
                  {scheduleWeekDates.map((date, index) => (
                    <th key={date} style={{ textAlign: 'left', padding: '11px 12px', color: 'rgba(255,255,255,0.44)' }}>
                      <p style={{ margin: '0 0 2px', color: '#F2F2F2', fontWeight: 900 }}>{WEEK_DAYS[index].short}</p>
                      <p style={{ margin: 0, color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>{formatShortDate(date)}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scheduleLoading ? (
                  <tr><td colSpan={8} style={{ padding: 28, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>Loading schedule...</td></tr>
                ) : activeEmployees.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 28, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>Create an active employee before scheduling.</td></tr>
                ) : activeEmployees.map((employee) => (
                  <tr key={employee.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: 12, color: '#F2F2F2', fontWeight: 900 }}>{employee.displayName}</td>
                    {scheduleWeekDates.map((date) => {
                      const shift = scheduleDraft[shiftKey(employee.id, date)] || defaultShift(employee.id, date);
                      return (
                        <td key={date} style={{ padding: 10, verticalAlign: 'top' }}>
                          <ScheduleCell
                            shift={shift}
                            onChange={(patch) => updateDraft(employee.id, date, patch)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'time' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <WeekToolbar weekStart={timeWeekStart} onWeekStartChange={setTimeWeekStart} onRefresh={loadTimeEntries} loading={timeLoading} />
          <div style={{ display: 'grid', gridTemplateColumns: editingEntry ? '1fr 360px' : '1fr', gap: 16, alignItems: 'start' }}>
            <div style={{ ...glass, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    {['Employee', 'Clock In', 'Clock Out', 'Hours', 'Status', 'Actions'].map((header) => (
                      <th key={header} style={{ textAlign: 'left', padding: '11px 13px', color: 'rgba(255,255,255,0.38)', fontSize: 11, textTransform: 'uppercase' }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timeEntries.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 28, color: 'rgba(255,255,255,0.35)', textAlign: 'center' }}>No time entries in this week.</td></tr>
                  ) : timeEntries.map((entry) => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: entry.status === 'voided' ? 0.6 : 1 }}>
                      <td style={{ padding: '10px 13px', color: '#F2F2F2', fontWeight: 800 }}>{entry.employeeName}</td>
                      <td style={{ padding: '10px 13px', color: 'rgba(255,255,255,0.62)' }}>{formatDateTime(entry.clockInAt)}</td>
                      <td style={{ padding: '10px 13px', color: entry.status === 'open' ? '#fbbf24' : 'rgba(255,255,255,0.62)' }}>
                        {entry.status === 'voided' ? '—' : entry.clockOutAt ? formatDateTime(entry.clockOutAt) : 'Open'}
                      </td>
                      <td style={{ padding: '10px 13px', color: '#34d399', fontWeight: 900 }}>{entry.paidMinutes == null ? '-' : minutesToHours(entry.paidMinutes)}</td>
                      <td style={{ padding: '10px 13px' }}>
                        <span style={{ padding: '3px 8px', borderRadius: 6, background: entry.status === 'voided' ? 'rgba(248,113,113,0.12)' : entry.status === 'completed' ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)', color: entry.status === 'voided' ? '#f87171' : entry.status === 'completed' ? '#34d399' : '#fbbf24', fontWeight: 800, fontSize: 11 }}>
                          {entry.status === 'voided' ? 'Voided' : entry.status === 'completed' ? 'Closed' : 'Open'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 13px' }}>
                        <button onClick={() => setEditingEntry({ id: entry.id, clockInAt: toDateTimeInput(entry.clockInAt), clockOutAt: toDateTimeInput(entry.clockOutAt), correctionNote: '', mode: entry.status === 'voided' ? 'restore' : 'edit' })}
                          style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.25)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', cursor: 'pointer', fontWeight: 800 }}>
                          {entry.status === 'voided' ? 'Restore' : 'Edit'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {editingEntry && (
              <div style={{ ...glassHi, padding: 16 }}>
                <p style={{ color: '#F2F2F2', fontWeight: 900, margin: '0 0 12px' }}>
                  {editingEntry.mode === 'restore' ? 'Restore voided entry' : 'Correct time entry'}
                </p>
                <div style={{ display: 'grid', gap: 10 }}>
                  {editingEntry.mode === 'edit' && (
                    <>
                      <label style={{ display: 'grid', gap: 5 }}>
                        <span style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Clock in</span>
                        <input type="datetime-local" value={editingEntry.clockInAt} onChange={(event) => setEditingEntry({ ...editingEntry, clockInAt: event.target.value })}
                          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.28)', color: '#F2F2F2' }} />
                      </label>
                      <label style={{ display: 'grid', gap: 5 }}>
                        <span style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Clock out</span>
                        <input type="datetime-local" value={editingEntry.clockOutAt} onChange={(event) => setEditingEntry({ ...editingEntry, clockOutAt: event.target.value })}
                          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.28)', color: '#F2F2F2' }} />
                      </label>
                    </>
                  )}
                  <label style={{ display: 'grid', gap: 5 }}>
                    <span style={{ color: 'rgba(255,255,255,0.42)', fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>Correction note</span>
                    <textarea value={editingEntry.correctionNote} onChange={(event) => setEditingEntry({ ...editingEntry, correctionNote: event.target.value })} rows={3}
                      style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.28)', color: '#F2F2F2', resize: 'vertical' }} />
                  </label>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
                    <button onClick={() => setEditingEntry(null)} disabled={timeSaving} style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer' }}>Cancel</button>
                    {editingEntry.mode === 'edit' && (
                      <button onClick={() => saveTimeCorrection(true)} disabled={timeSaving} style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.08)', color: '#f87171', cursor: timeSaving ? 'wait' : 'pointer', display: 'flex', gap: 6, alignItems: 'center', fontWeight: 900 }}><Trash2 size={13} /> Void</button>
                    )}
                    <button onClick={() => editingEntry.mode === 'restore' ? saveTimeCorrection(false, true) : saveTimeCorrection(false)} disabled={timeSaving} style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.08)', color: '#34d399', cursor: timeSaving ? 'wait' : 'pointer', display: 'flex', gap: 6, alignItems: 'center', fontWeight: 900 }}><Save size={13} /> {timeSaving ? 'Saving...' : editingEntry.mode === 'restore' ? 'Restore' : 'Save'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'payroll' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <WeekToolbar
            weekStart={payrollWeekStart}
            onWeekStartChange={setPayrollWeekStart}
            onRefresh={loadPayroll}
            loading={payrollLoading}
            action={<button onClick={exportPayroll} disabled={!payroll}
              style={{ padding: '8px 13px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.35)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', cursor: 'pointer', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Download size={13} /> Export CSV
            </button>}
          />

          {payroll?.openEntries?.length ? (
            <div style={{ ...glass, padding: 14, borderColor: 'rgba(251,191,36,0.35)', color: '#fbbf24', fontSize: 13, fontWeight: 800 }}>
              {payroll.openEntries.length} open shift(s) are excluded from payroll until admin closes or voids them.
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(180px,1fr))', gap: 14 }}>
            <Metric label="Paid Hours" value={payroll ? String(payroll.totals.hours) : '-'} color="#60a5fa" />
            <Metric label="Paid Minutes" value={payroll ? String(payroll.totals.paidMinutes) : '-'} color="#8b87ff" />
            <Metric label="Total Pay" value={payroll ? fmtMoney(payroll.totals.totalCrc) : '-'} color="#34d399" />
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            {payroll?.employees?.length ? payroll.employees.map((employee) => (
              <div key={employee.employeeId} style={{ ...glassHi, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 12 }}>
                  <div>
                    <p style={{ color: '#F2F2F2', fontSize: 17, fontWeight: 900, margin: 0 }}>{employee.employeeName}</p>
                    <p style={{ color: 'rgba(255,255,255,0.36)', fontSize: 12, margin: '4px 0 0' }}>{employee.paidMinutes} minutes / {employee.hours} hours</p>
                  </div>
                  <p style={{ color: '#34d399', fontSize: 22, fontWeight: 900, margin: 0 }}>{fmtMoney(employee.totalCrc)}</p>
                </div>
                <div style={{ display: 'grid', gap: 7 }}>
                  {employee.entries.map((entry) => (
                    <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px 110px 110px', gap: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.62)', fontSize: 12, alignItems: 'center' }}>
                      <span>{formatDateTime(entry.clockInAt)}</span>
                      <span>{formatDateTime(entry.clockOutAt)}</span>
                      <strong style={{ color: '#60a5fa' }}>{minutesToHours(entry.paidMinutes)}h</strong>
                      <span>{fmtMoney(entry.hourlyRateCrc)}/h</span>
                      <strong style={{ color: '#34d399' }}>{fmtMoney(entry.payCrc)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )) : (
              <div style={{ ...glass, padding: 34, textAlign: 'center', color: 'rgba(255,255,255,0.35)' }}>No closed time entries for this payroll week.</div>
            )}
          </div>
        </div>
      )}

      {tab === 'coverage' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <WeekToolbar weekStart={coverageWeekStart} onWeekStartChange={setCoverageWeekStart} onRefresh={loadCoverage} loading={coverageLoading} />
          <div style={{ ...glass, overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 1000, borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={{ padding: 10, color: 'rgba(255,255,255,0.38)', textAlign: 'left', width: 82 }}>Time</th>
                  {coverageWeekDates.map((date, index) => (
                    <th key={date} style={{ padding: 10, color: '#F2F2F2', textAlign: 'left' }}>{WEEK_DAYS[index].short} {formatShortDate(date)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverageSlots.map((slot) => (
                  <tr key={slot} style={{ borderBottom: '1px solid rgba(255,255,255,0.045)' }}>
                    <td style={{ padding: 9, color: 'rgba(255,255,255,0.42)', fontWeight: 900 }}>{slot}</td>
                    {coverageWeekDates.map((date) => {
                      const scheduled = getScheduledNames(date, slot);
                      const actual = getActualNames(date, slot);
                      const empty = scheduled.length === 0;
                      return (
                        <td key={`${date}-${slot}`} style={{ padding: 7, verticalAlign: 'top' }}>
                          <div style={{ minHeight: 52, borderRadius: 8, border: `1px solid ${empty ? 'rgba(248,113,113,0.28)' : 'rgba(52,211,153,0.16)'}`, background: empty ? 'rgba(248,113,113,0.06)' : 'rgba(52,211,153,0.045)', padding: 8 }}>
                            <p style={{ color: empty ? '#f87171' : '#34d399', fontWeight: 900, margin: '0 0 4px', fontSize: 11 }}>{empty ? 'No scheduled' : scheduled.join(', ')}</p>
                            <p style={{ color: actual.length ? '#60a5fa' : 'rgba(255,255,255,0.28)', margin: 0, fontSize: 10.5 }}>{actual.length ? `Actual: ${actual.join(', ')}` : 'Actual: none'}</p>
                          </div>
                        </td>
                      );
                    })}
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

function EmployeeRow({ employee, onUpdate, busy }: {
  employee: Employee;
  onUpdate: (employee: Employee, patch: Partial<Employee> & { regenerateCode?: boolean }) => Promise<void>;
  busy: boolean;
}) {
  const [name, setName] = useState(employee.displayName);
  const [rate, setRate] = useState(String(employee.hourlyRateCrc));

  useEffect(() => {
    setName(employee.displayName);
    setRate(String(employee.hourlyRateCrc));
  }, [employee]);

  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <td style={{ padding: '10px 14px' }}>
        <input value={name} onChange={(event) => setName(event.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.22)', color: '#F2F2F2', fontWeight: 800, outline: 'none' }} />
        {employee.legacyStaffName && <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.28)', fontSize: 11 }}>Legacy: {employee.legacyStaffName}</p>}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <input type="number" value={rate} onChange={(event) => setRate(event.target.value)}
          style={{ width: 130, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.22)', color: '#34d399', fontWeight: 900, outline: 'none' }} />
      </td>
      <td style={{ padding: '10px 14px' }}>
        <button onClick={() => onUpdate(employee, { active: !employee.active })} disabled={busy}
          style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${employee.active ? 'rgba(52,211,153,0.28)' : 'rgba(248,113,113,0.28)'}`, background: employee.active ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.08)', color: employee.active ? '#34d399' : '#f87171', cursor: 'pointer', fontWeight: 900 }}>
          {employee.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td style={{ padding: '10px 14px', color: 'rgba(255,255,255,0.42)' }}>
        {employee.codeLastGeneratedAt ? formatDateTime(employee.codeLastGeneratedAt) : 'Not generated'}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => onUpdate(employee, { displayName: name, hourlyRateCrc: Number(rate) })} disabled={busy}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.25)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', cursor: 'pointer', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Save size={12} /> Save
          </button>
          <button onClick={() => onUpdate(employee, { regenerateCode: true })} disabled={busy}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.28)', background: 'rgba(251,191,36,0.08)', color: '#fbbf24', cursor: 'pointer', fontWeight: 900, display: 'flex', alignItems: 'center', gap: 5 }}>
            <ShieldCheck size={12} /> {busy ? 'Saving...' : 'Code'}
          </button>
        </div>
      </td>
    </tr>
  );
}

function WeekToolbar({ weekStart, onWeekStartChange, onRefresh, loading, action }: {
  weekStart: string;
  onWeekStartChange: (value: string) => void;
  onRefresh: () => void;
  loading: boolean;
  action?: ReactNode;
}) {
  const weekEnd = addDaysKey(weekStart, 6);
  return (
    <div style={{ ...glass, padding: 12, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => onWeekStartChange(addDaysKey(weekStart, -7))}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: 'rgba(255,255,255,0.58)', cursor: 'pointer', fontWeight: 800 }}>Prev</button>
        <button onClick={() => onWeekStartChange(getWeekStartKey())}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.25)', background: 'rgba(96,165,250,0.08)', color: '#60a5fa', cursor: 'pointer', fontWeight: 800 }}>Current</button>
        <button onClick={() => onWeekStartChange(addDaysKey(weekStart, 7))}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(139,135,255,0.25)', background: 'rgba(139,135,255,0.08)', color: '#8b87ff', cursor: 'pointer', fontWeight: 800 }}>Next</button>
        <input type="date" value={weekStart} onChange={(event) => onWeekStartChange(getWeekStartKey(event.target.value))}
          style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.26)', color: '#F2F2F2', outline: 'none' }} />
        <span style={{ color: 'rgba(255,255,255,0.42)', fontSize: 13, fontWeight: 800 }}>
          {formatShortDate(weekStart)} - {formatShortDate(weekEnd)}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={onRefresh} disabled={loading}
          style={{ padding: '8px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.58)', cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'center', fontWeight: 800 }}>
          <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} /> Refresh
        </button>
        {action}
      </div>
    </div>
  );
}

function ReadOnlyScheduleCell({ shift }: { shift: Shift }) {
  const expectedMinutes = shift.isOff ? 0 : calculateShiftMinutes(shift.shiftStart, shift.shiftEnd);
  const isScheduled = expectedMinutes > 0;
  return (
    <div style={{
      minHeight: 78,
      borderRadius: 8,
      border: `1px solid ${isScheduled ? 'rgba(52,211,153,0.18)' : 'rgba(255,255,255,0.08)'}`,
      background: isScheduled ? 'rgba(52,211,153,0.055)' : 'rgba(255,255,255,0.025)',
      padding: 10,
      display: 'grid',
      alignContent: 'center',
      gap: 5,
    }}>
      <p style={{ margin: 0, color: isScheduled ? '#F2F2F2' : 'rgba(255,255,255,0.32)', fontWeight: 900, fontSize: 13 }}>
        {formatTimeRange({ ...shift, expectedPaidMinutes: expectedMinutes })}
      </p>
      {isScheduled ? (
        <p style={{ margin: 0, color: '#60a5fa', fontWeight: 900, fontSize: 11 }}>
          {minutesToHours(expectedMinutes)}h expected
        </p>
      ) : (
        <p style={{ margin: 0, color: 'rgba(255,255,255,0.24)', fontWeight: 800, fontSize: 11 }}>Off</p>
      )}
      {shift.notes ? (
        <p style={{ margin: 0, color: 'rgba(255,255,255,0.44)', fontSize: 11, lineHeight: 1.35 }}>{shift.notes}</p>
      ) : null}
    </div>
  );
}

function ScheduleCell({ shift, onChange }: { shift: Shift; onChange: (patch: Partial<Shift>) => void }) {
  const expectedMinutes = shift.isOff ? 0 : calculateShiftMinutes(shift.shiftStart, shift.shiftEnd);
  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 132 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: shift.isOff ? 'rgba(255,255,255,0.42)' : '#34d399', fontSize: 11, fontWeight: 900 }}>
        <input
          type="checkbox"
          checked={!shift.isOff}
          onChange={(event) => onChange({ isOff: !event.target.checked })}
        />
        Scheduled
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <label style={{ display: 'grid', gap: 3 }}>
          <span style={{ color: 'rgba(255,255,255,0.34)', fontSize: 10, fontWeight: 800 }}>Start</span>
          <input type="time" value={shift.shiftStart || ''} disabled={shift.isOff} onChange={(event) => onChange({ shiftStart: event.target.value })}
          style={{ width: '100%', padding: '6px 5px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: shift.isOff ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.26)', color: shift.isOff ? 'rgba(255,255,255,0.26)' : '#F2F2F2' }} />
        </label>
        <label style={{ display: 'grid', gap: 3 }}>
          <span style={{ color: 'rgba(255,255,255,0.34)', fontSize: 10, fontWeight: 800 }}>End</span>
          <input type="time" value={shift.shiftEnd || ''} disabled={shift.isOff} onChange={(event) => onChange({ shiftEnd: event.target.value })}
          style={{ width: '100%', padding: '6px 5px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.1)', background: shift.isOff ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.26)', color: shift.isOff ? 'rgba(255,255,255,0.26)' : '#F2F2F2' }} />
        </label>
      </div>
      <div style={{ minHeight: 28, borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)', padding: '6px 7px', color: shift.isOff ? 'rgba(255,255,255,0.28)' : expectedMinutes > 0 ? '#60a5fa' : '#fbbf24', fontWeight: 900, fontSize: 11 }}>
        {shift.isOff ? 'Off day' : expectedMinutes > 0 ? `${minutesToHours(expectedMinutes)}h expected` : 'Fix time range'}
      </div>
      <input value={shift.notes} disabled={shift.isOff} onChange={(event) => onChange({ notes: event.target.value })} placeholder="Note"
        style={{ width: '100%', padding: '6px 7px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)', color: 'rgba(255,255,255,0.65)', outline: 'none' }} />
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ ...glassHi, padding: 18 }}>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: '0 0 8px', textTransform: 'uppercase', fontWeight: 800 }}>{label}</p>
      <p style={{ color, fontSize: 25, fontWeight: 900, margin: 0 }}>{value}</p>
    </div>
  );
}
