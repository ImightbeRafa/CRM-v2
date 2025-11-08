'use client';

import dynamic from 'next/dynamic';

interface StatusBreakdownChartProps {
  data: Array<{
    status: string;
    count: number;
    percentage: number;
    color: string;
  }>;
  height?: number;
}

function StatusBreakdownChartSkeleton({ height = 300 }: { height?: number }) {
  return <div className="w-full bg-gray-200 animate-pulse rounded" style={{ height }} />;
}

const StatusBreakdownChartInner = dynamic(
  () => import('./StatusBreakdownChartInner'),
  {
    loading: () => <StatusBreakdownChartSkeleton />,
    ssr: false
  }
);

export default function StatusBreakdownChart(props: StatusBreakdownChartProps) {
  return <StatusBreakdownChartInner {...props} />;
}

