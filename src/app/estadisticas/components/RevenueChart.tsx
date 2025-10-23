'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

interface RevenueChartProps {
  data: Array<{
    date: string;
    revenue: number;
    orderCount: number;
  }>;
  height?: number;
}

export default function RevenueChart({ data, height = 300 }: RevenueChartProps) {
  // Format data for display
  const formattedData = data.map((item) => ({
    ...item,
    displayDate: format(new Date(item.date), 'dd/MM'),
  }));

  const formatCurrency = (value: number) => {
    return `₡${value.toLocaleString('es-CR', { maximumFractionDigits: 0 })}`;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={formattedData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis
          dataKey="displayDate"
          stroke="#6B7280"
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
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            fontSize: '14px',
          }}
          formatter={(value: any, name: string) => {
            if (name === 'revenue') {
              return [formatCurrency(value), 'Ingresos'];
            }
            return [value, 'Pedidos'];
          }}
          labelFormatter={(label) => `Fecha: ${label}`}
        />
        <Legend
          wrapperStyle={{ fontSize: '14px', paddingTop: '10px' }}
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
}

