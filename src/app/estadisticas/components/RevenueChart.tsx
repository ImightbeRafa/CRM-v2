'use client';

import { useState, useEffect } from 'react';
import RevenueChartInner from './RevenueChartInner';

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

export default function RevenueChart(props: RevenueChartProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <RevenueChartSkeleton height={props.height} />;
  }

  return <RevenueChartInner {...props} />;
}

