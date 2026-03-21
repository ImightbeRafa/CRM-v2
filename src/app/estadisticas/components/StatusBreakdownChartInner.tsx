'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { useTheme } from 'next-themes';

interface StatusBreakdownChartProps {
  data: Array<{
    status: string;
    count: number;
    percentage: number;
    color: string;
  }>;
  height?: number;
}

const StatusBreakdownChartInner = ({ data, height = 300 }: StatusBreakdownChartProps) => {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (!data || data.length === 0) {
    return null;
  }

  const tooltipBg = isDark ? '#1E293B' : '#FFFFFF';
  const tooltipBorder = isDark ? '#334155' : '#E5E7EB';
  const tooltipText = isDark ? '#E2E8F0' : '#1F2937';
  const legendColor = isDark ? '#94A3B8' : '#374151';

  const RADIAN = Math.PI / 180;

  const renderCustomizedLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
  }: any) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (percent < 0.05) return null;

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        style={{ fontSize: '12px', fontWeight: 'bold' }}
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={renderCustomizedLabel}
          outerRadius={100}
          innerRadius={60}
          fill="#8884d8"
          dataKey="count"
          paddingAngle={2}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: tooltipBg,
            border: `1px solid ${tooltipBorder}`,
            borderRadius: '8px',
            fontSize: '14px',
            color: tooltipText,
          }}
          labelStyle={{ color: tooltipText }}
          formatter={(value: any, name: string, props: any) => {
            return [
              `${value} pedidos (${props.payload.percentage.toFixed(1)}%)`,
              props.payload.status,
            ];
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(value, entry: any) => {
            const item = data.find((d) => d.status === entry.payload.status);
            return `${entry.payload.status} (${item?.count || 0})`;
          }}
          wrapperStyle={{ fontSize: '12px', color: legendColor }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
};

export default StatusBreakdownChartInner;
