'use client';

import dynamic from 'next/dynamic';

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

function RevenueChartSkeleton({ height = 300 }: { height?: number }) {
  return <div className="w-full bg-gray-200 animate-pulse rounded" style={{ height }} />;
}

const RevenueChartInner = dynamic(
  () => import('./RevenueChartInner'),
  {
    loading: () => <RevenueChartSkeleton />,
    ssr: false
  }
);

export default function RevenueChart(props: RevenueChartProps) {
  return <RevenueChartInner {...props} />;
}

