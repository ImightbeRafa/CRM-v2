'use client';

import { useState, useEffect } from 'react';
import StatusBreakdownChartInner from './StatusBreakdownChartInner';

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
  return <div className="w-full bg-muted animate-pulse rounded" style={{ height }} />;
}

export default function StatusBreakdownChart(props: StatusBreakdownChartProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <StatusBreakdownChartSkeleton height={props.height} />;
  }

  return <StatusBreakdownChartInner {...props} />;
}

