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
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
}

function RevenueChartSkeleton({ height = 300 }: { height?: number }) {
  return <div className="w-full bg-muted animate-pulse rounded" style={{ height }} />;
}

const RevenueChartInner = dynamic(() => import('./RevenueChartInner'), {
  ssr: false,
  loading: () => <RevenueChartSkeleton />,
});

export default function RevenueChart(props: RevenueChartProps) {
  return <RevenueChartInner {...props} />;
}
