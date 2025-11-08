'use client';

import dynamic from 'next/dynamic';

interface SalesVolumeChartProps {
  data: {
    EA: { count: number; revenue: number };
    RA: { count: number; revenue: number };
  };
  height?: number;
  currencySymbol?: string;
  locale?: string;
}

function SalesVolumeChartSkeleton({ height = 300 }: { height?: number }) {
  return <div className="w-full bg-gray-200 animate-pulse rounded" style={{ height }} />;
}

const SalesVolumeChartInner = dynamic(
  () => import('./SalesVolumeChartInner'),
  {
    loading: () => <SalesVolumeChartSkeleton />,
    ssr: false
  }
);

export default function SalesVolumeChart(props: SalesVolumeChartProps) {
  return <SalesVolumeChartInner {...props} />;
}

