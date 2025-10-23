'use client';

import { useState } from 'react';
import { Calendar } from 'lucide-react';
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
  const quickRanges = [
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
  ];

  return (
    <div className="bg-white rounded-lg border p-4 space-y-4">
      <div className="flex items-center gap-2 text-gray-700 font-medium">
        <Calendar className="w-5 h-5" />
        <span>Rango de Fechas</span>
      </div>

      {/* Quick Range Buttons */}
      <div className="flex flex-wrap gap-2">
        {quickRanges.map((range) => (
          <button
            key={range.label}
            onClick={range.onClick}
            className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            {range.label}
          </button>
        ))}
      </div>

      {/* Custom Date Inputs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">
            Fecha Inicio
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onDateChange(e.target.value, endDate)}
            className="w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">
            Fecha Fin
          </label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onDateChange(startDate, e.target.value)}
            className="w-full border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
    </div>
  );
}

