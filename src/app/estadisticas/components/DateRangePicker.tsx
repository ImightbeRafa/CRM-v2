'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import { Calendar, Loader2 } from 'lucide-react';
import { format, subDays, subMonths, startOfMonth, endOfMonth, startOfYear } from 'date-fns';

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onDateChange: (start: string, end: string) => void;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onDateChange,
}: DateRangePickerProps) {
  // Earliest date available for this tenant (first order / tenant creation).
  // Used by the "Max" quick range to show all-time stats.
  const [earliestDate, setEarliestDate] = useState<string | null>(null);
  const [loadingMax, setLoadingMax] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/api/estadisticas/earliest-date');
        if (!cancelled && res.data?.earliestDate) {
          setEarliestDate(res.data.earliestDate);
        }
      } catch (err) {
        // Non-fatal: the Max button will fetch on demand as a fallback.
        console.warn('[DateRangePicker] Failed to prefetch earliest date', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleMaxClick = async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    if (earliestDate) {
      onDateChange(earliestDate, today);
      return;
    }
    try {
      setLoadingMax(true);
      const res = await axios.get('/api/estadisticas/earliest-date');
      const fetched: string | undefined = res.data?.earliestDate;
      if (fetched) {
        setEarliestDate(fetched);
        onDateChange(fetched, today);
      } else {
        // Absolute fallback: use a very early date to cover all history.
        onDateChange('2000-01-01', today);
      }
    } catch (err) {
      console.error('[DateRangePicker] Failed to load earliest date', err);
      onDateChange('2000-01-01', today);
    } finally {
      setLoadingMax(false);
    }
  };

  const quickRanges: Array<{ label: string; onClick: () => void; loading?: boolean }> = [
    {
      label: 'Últimos 7 días',
      onClick: () => {
        const end = new Date();
        const start = subDays(end, 6);
        onDateChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      },
    },
    {
      label: 'Últimos 30 días',
      onClick: () => {
        const end = new Date();
        const start = subDays(end, 29);
        onDateChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      },
    },
    {
      label: 'Este mes',
      onClick: () => {
        const now = new Date();
        const start = startOfMonth(now);
        const end = endOfMonth(now);
        onDateChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      },
    },
    {
      label: 'Mes pasado',
      onClick: () => {
        const lastMonth = subMonths(new Date(), 1);
        const start = startOfMonth(lastMonth);
        const end = endOfMonth(lastMonth);
        onDateChange(format(start, 'yyyy-MM-dd'), format(end, 'yyyy-MM-dd'));
      },
    },
    {
      label: 'Este año',
      onClick: () => {
        const now = new Date();
        const start = startOfYear(now);
        onDateChange(format(start, 'yyyy-MM-dd'), format(now, 'yyyy-MM-dd'));
      },
    },
    {
      label: 'Max',
      onClick: handleMaxClick,
      loading: loadingMax,
    },
  ];

  return (
    <div className="bg-card rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center gap-2 text-foreground font-medium">
        <Calendar className="w-5 h-5" />
        <span>Rango de Fechas</span>
      </div>

      {/* Quick Range Buttons */}
      <div className="flex flex-wrap gap-2">
        {quickRanges.map((range) => {
          const isMax = range.label === 'Max';
          return (
            <button
              key={range.label}
              onClick={range.onClick}
              disabled={range.loading}
              title={
                isMax
                  ? earliestDate
                    ? `Desde ${earliestDate} hasta hoy (todo el historial)`
                    : 'Desde el inicio del negocio hasta hoy'
                  : undefined
              }
              className={
                isMax
                  ? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors border border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:bg-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed'
                  : 'px-3 py-1.5 text-sm bg-muted hover:bg-accent text-muted-foreground hover:text-accent-foreground rounded-md transition-colors'
              }
            >
              {range.loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {range.label}
            </button>
          );
        })}
      </div>

      {/* Custom Date Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Fecha Inicio
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onDateChange(e.target.value, endDate)}
            className="w-full border border-input bg-background text-foreground rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Fecha Fin
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onDateChange(startDate, e.target.value)}
            className="w-full border border-input bg-background text-foreground rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
    </div>
  );
}

