'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface SalesVolumeChartProps {
  data: {
    EA: { count: number; revenue: number };
    RA: { count: number; revenue: number };
  };
  height?: number;
  currencySymbol?: string;
  locale?: string;
}

const SalesVolumeChartInner = ({ data, height = 300, currencySymbol = '₡', locale = 'es-CR' }: SalesVolumeChartProps) => {
  const chartData = [
    {
      name: 'Envíos (EA)',
      pedidos: data.EA.count,
      ingresos: data.EA.revenue,
    },
    {
      name: 'Retiros (RA)',
      pedidos: data.RA.count,
      ingresos: data.RA.revenue,
    },
  ];

  const formatCurrency = (value: number) => {
    return `${currencySymbol}${value.toLocaleString(locale, { maximumFractionDigits: 0 })}`;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis dataKey="name" stroke="#6B7280" style={{ fontSize: '12px' }} />
        <YAxis
          yAxisId="left"
          stroke="#3B82F6"
          style={{ fontSize: '12px' }}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          stroke="#10B981"
          style={{ fontSize: '12px' }}
          tickFormatter={formatCurrency}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            fontSize: '14px',
          }}
          formatter={(value: any, name: string) => {
            if (name === 'ingresos') {
              return [formatCurrency(value as number), 'Ingresos'];
            }
            return [value, 'Pedidos'];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: '14px', paddingTop: '10px' }}
          formatter={(value) => {
            if (value === 'pedidos') return 'Pedidos';
            if (value === 'ingresos') return 'Ingresos';
            return value;
          }}
        />
        <Bar
          yAxisId="left"
          dataKey="pedidos"
          fill="#3B82F6"
          radius={[8, 8, 0, 0]}
          name="pedidos"
        />
        <Bar
          yAxisId="right"
          dataKey="ingresos"
          fill="#10B981"
          radius={[8, 8, 0, 0]}
          name="ingresos"
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default SalesVolumeChartInner;
