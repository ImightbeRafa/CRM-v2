'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { useTheme } from 'next-themes';

interface RevenueChartProps {
  data: Array<{
    date: string;
    revenue: number;
    orderCount: number;
  }>;
  height?: number;
  currencySymbol?: string;
  locale?: string;
}

const RevenueChartInner = ({ data, height = 300, currencySymbol = '₡', locale = 'es-CR' }: RevenueChartProps) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (!data || data.length === 0) {
    return null;
  }

  const parseDateKeyForDisplay = (value: string): Date => {
    if (/^\d{4}-\d{2}$/.test(value)) {
      const [year, month] = value.split('-').map(Number);
      return new Date(year, month - 1, 1);
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }

    return new Date(value);
  };

  const formattedData = data.map((item) => ({
    ...item,
    displayDate: format(parseDateKeyForDisplay(item.date), item.date.length === 7 ? 'MM/yyyy' : 'dd/MM'),
  }));

  const formatCurrency = (value: number) => {
    return `${currencySymbol}${value.toLocaleString(locale, { maximumFractionDigits: 0 })}`;
  };

  const gridColor = isDark ? '#334155' : '#E5E7EB';
  const axisColor = isDark ? '#94A3B8' : '#6B7280';
  const tooltipBg = isDark ? '#1E293B' : '#FFFFFF';
  const tooltipBorder = isDark ? '#334155' : '#E5E7EB';
  const tooltipText = isDark ? '#E2E8F0' : '#1F2937';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={formattedData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis
          dataKey="displayDate"
          stroke={axisColor}
          style={{ fontSize: '12px' }}
        />
        <YAxis
          yAxisId="left"
          stroke="#10B981"
          style={{ fontSize: '12px' }}
          tickFormatter={formatCurrency}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke="#3B82F6"
          style={{ fontSize: '12px' }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: tooltipBg,
            border: `1px solid ${tooltipBorder}`,
            borderRadius: '8px',
            fontSize: '14px',
            color: tooltipText,
          }}
          formatter={(value: any, name: string) => {
            if (name === 'revenue') {
              return [formatCurrency(value), 'Ingresos'];
            }
            return [value, 'Pedidos'];
          }}
          labelFormatter={(label) => `Fecha: ${label}`}
          labelStyle={{ color: tooltipText }}
        />
        <Legend
          wrapperStyle={{ fontSize: '14px', paddingTop: '10px', color: axisColor }}
          formatter={(value) => {
            if (value === 'revenue') return 'Ingresos';
            if (value === 'orderCount') return 'Pedidos';
            return value;
          }}
        />
        <Line
          yAxisId="left"
          type="monotone"
          dataKey="revenue"
          stroke="#10B981"
          strokeWidth={2}
          dot={{ fill: '#10B981', r: 4 }}
          activeDot={{ r: 6 }}
          name="revenue"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="orderCount"
          stroke="#3B82F6"
          strokeWidth={2}
          dot={{ fill: '#3B82F6', r: 4 }}
          activeDot={{ r: 6 }}
          name="orderCount"
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default RevenueChartInner;
