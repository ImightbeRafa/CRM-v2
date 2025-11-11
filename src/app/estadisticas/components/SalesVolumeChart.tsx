'use client';

import { useState, useEffect } from 'react';
import SalesVolumeChartInner from './SalesVolumeChartInner';

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

export default function SalesVolumeChart(props: SalesVolumeChartProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <SalesVolumeChartSkeleton height={props.height} />;
  }

  return <SalesVolumeChartInner {...props} />;
}

