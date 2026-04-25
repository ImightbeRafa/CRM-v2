'use client';

import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { Calendar, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onDateChange: (start: string, end: string) => void;
}

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function buildMonthDays(month: Date): Date[] {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days: Date[] = [];

  for (let date = start; date <= end; date = addDays(date, 1)) {
    days.push(date);
  }

  return days;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onDateChange,
}: DateRangePickerProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => parseDateKey(startDate));
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [earliestDate, setEarliestDate] = useState<string | null>(null);
  const [loadingMax, setLoadingMax] = useState(false);

  const today = new Date();
  const todayKey = formatDateKey(today);
  const yesterdayKey = formatDateKey(subDays(today, 1));
  const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });
  const thisWeekStartKey = formatDateKey(thisWeekStart);
  const thisMonthStartKey = formatDateKey(startOfMonth(today));
  const lastWeekStart = startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 });
  const lastWeekStartKey = formatDateKey(lastWeekStart);
  const lastWeekEndKey = formatDateKey(subDays(thisWeekStart, 1));
  const lastMonth = subMonths(today, 1);
  const lastMonthStartKey = formatDateKey(startOfMonth(lastMonth));
  const lastMonthEndKey = formatDateKey(endOfMonth(lastMonth));
  const monthDays = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);

  const isSingleDay = startDate === endDate;
  const selectedLabel = isSingleDay
    ? format(parseDateKey(startDate), 'dd/MM/yyyy')
    : `${format(parseDateKey(startDate), 'dd/MM/yyyy')} - ${format(parseDateKey(endDate), 'dd/MM/yyyy')}`;

  const selectedStart = parseDateKey(startDate);
  const selectedEnd = parseDateKey(endDate);
  const selectedRangeStart = startDate <= endDate ? selectedStart : selectedEnd;
  const selectedRangeEnd = startDate <= endDate ? selectedEnd : selectedStart;
  const maxStart = earliestDate || '2000-01-01';

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await axios.get('/api/estadisticas/earliest-date');
        if (!cancelled && res.data?.earliestDate) {
          setEarliestDate(res.data.earliestDate);
        }
      } catch (err) {
        console.warn('[DateRangePicker] Failed to prefetch earliest date', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const applyRange = (start: string, end: string, closeCalendar = false) => {
    onDateChange(start, end);
    setPendingStart(null);
    if (closeCalendar) setCalendarOpen(false);
  };

  const handleMaxClick = async () => {
    if (earliestDate) {
      applyRange(earliestDate, todayKey);
      return;
    }

    try {
      setLoadingMax(true);
      const res = await axios.get('/api/estadisticas/earliest-date');
      const fetched: string | undefined = res.data?.earliestDate;
      const start = fetched || '2000-01-01';
      if (fetched) setEarliestDate(fetched);
      applyRange(start, todayKey);
    } catch (err) {
      console.error('[DateRangePicker] Failed to load earliest date', err);
      applyRange('2000-01-01', todayKey);
    } finally {
      setLoadingMax(false);
    }
  };

  const handleCalendarDateClick = (date: Date) => {
    const clickedKey = formatDateKey(date);

    if (!pendingStart) {
      setPendingStart(clickedKey);
      onDateChange(clickedKey, clickedKey);
      return;
    }

    const start = pendingStart <= clickedKey ? pendingStart : clickedKey;
    const end = pendingStart <= clickedKey ? clickedKey : pendingStart;
    applyRange(start, end, true);
  };

  const quickRanges = [
    { label: 'Hoy', active: startDate === todayKey && endDate === todayKey, onClick: () => applyRange(todayKey, todayKey) },
    { label: 'Esta semana', active: startDate === thisWeekStartKey && endDate === todayKey, onClick: () => applyRange(thisWeekStartKey, todayKey) },
    { label: 'Este mes', active: startDate === thisMonthStartKey && endDate === todayKey, onClick: () => applyRange(thisMonthStartKey, todayKey) },
    { label: 'Max', active: startDate === maxStart && endDate === todayKey, onClick: handleMaxClick, loading: loadingMax },
  ];

  const popoverQuickRanges = [
    { label: 'Ayer', start: yesterdayKey, end: yesterdayKey },
    { label: 'Esta semana', start: thisWeekStartKey, end: todayKey },
    { label: 'Semana pasada', start: lastWeekStartKey, end: lastWeekEndKey },
    { label: 'Mes pasado', start: lastMonthStartKey, end: lastMonthEndKey },
  ];

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center gap-2 text-foreground font-medium">
        <Calendar className="w-5 h-5" />
        <span>Rango de Fechas</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setCalendarOpen((open) => !open);
              setVisibleMonth(parseDateKey(startDate));
            }}
            className="inline-flex h-10 min-w-[230px] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <span>{selectedLabel}</span>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </button>

          {calendarOpen && (
            <div className="absolute left-0 top-12 z-50 w-[320px] rounded-lg border border-border bg-card p-3 shadow-xl">
              <div className="mb-3 grid grid-cols-2 gap-2">
                {popoverQuickRanges.map((range) => (
                  <button
                    key={range.label}
                    type="button"
                    onClick={() => applyRange(range.start, range.end, true)}
                    className="rounded-md border border-border px-2 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    {range.label}
                  </button>
                ))}
              </div>

              <div className="mb-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setVisibleMonth((month) => subMonths(month, 1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent"
                  aria-label="Mes anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-sm font-semibold capitalize text-foreground">
                  {format(visibleMonth, 'MMMM yyyy', { locale: es })}
                </div>
                <button
                  type="button"
                  onClick={() => setVisibleMonth((month) => subMonths(month, -1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border hover:bg-accent"
                  aria-label="Mes siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
                {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => (
                  <div key={`${day}-${index}`} className="py-1">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {monthDays.map((date) => {
                  const dateKey = formatDateKey(date);
                  const inCurrentMonth = date.getMonth() === visibleMonth.getMonth();
                  const isRangeEdge = isSameDay(date, selectedRangeStart) || isSameDay(date, selectedRangeEnd);
                  const inSelectedRange = isWithinInterval(date, { start: selectedRangeStart, end: selectedRangeEnd });
                  const isPending = pendingStart === dateKey;

                  return (
                    <button
                      key={dateKey}
                      type="button"
                      onClick={() => handleCalendarDateClick(date)}
                      className={`h-9 rounded-md text-sm transition-colors ${
                        isRangeEdge || isPending
                          ? 'bg-blue-600 font-semibold text-white'
                          : inSelectedRange
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200'
                            : inCurrentMonth
                              ? 'text-foreground hover:bg-accent'
                              : 'text-muted-foreground/40 hover:bg-accent'
                      }`}
                    >
                      {format(date, 'd')}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>{pendingStart ? 'Elige la fecha final del rango.' : 'Elige una fecha o inicia un rango.'}</span>
                <button
                  type="button"
                  onClick={() => {
                    setPendingStart(null);
                    setCalendarOpen(false);
                  }}
                  className="font-medium text-blue-600 hover:text-blue-700"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}
        </div>

        {quickRanges.map((range) => (
          <button
            key={range.label}
            type="button"
            onClick={range.onClick}
            disabled={range.loading}
            title={range.label === 'Max' ? 'Desde el inicio del negocio hasta hoy' : undefined}
            className={`inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              range.active
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-border bg-card text-foreground hover:bg-accent'
            }`}
          >
            {range.loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {range.label}
          </button>
        ))}
      </div>
    </div>
  );
}
