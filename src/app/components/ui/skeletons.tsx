import React from 'react';
import { cn } from '@/lib/utils';

function ShimmerBlock({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-md bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-shimmer',
        className
      )}
    />
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Metric cards row */}
      <div className="flex gap-3 overflow-hidden md:grid md:grid-cols-4 md:gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="min-w-[75vw] md:min-w-0">
            <div className="bg-white rounded-lg border p-5 space-y-3">
              <ShimmerBlock className="h-3 w-24" />
              <ShimmerBlock className="h-8 w-16" />
            </div>
          </div>
        ))}
      </div>

      {/* Navigation cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border p-8 space-y-4">
            <ShimmerBlock className="h-14 w-14 rounded-xl" />
            <ShimmerBlock className="h-5 w-24" />
            <ShimmerBlock className="h-3 w-36" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 p-4 bg-slate-50 border-b">
        {Array.from({ length: columns }).map((_, i) => (
          <ShimmerBlock key={i} className="h-4 flex-1" />
        ))}
      </div>

      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex gap-4 p-4 border-b last:border-0">
          {Array.from({ length: columns }).map((_, colIdx) => (
            <ShimmerBlock
              key={colIdx}
              className="h-4 flex-1"
              style={{ maxWidth: colIdx === 0 ? '80px' : undefined } as React.CSSProperties}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function MobileOrderListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex justify-between">
            <div className="space-y-2 flex-1">
              <ShimmerBlock className="h-4 w-20" />
              <ShimmerBlock className="h-3 w-32" />
            </div>
            <div className="space-y-2 items-end flex flex-col">
              <ShimmerBlock className="h-5 w-16 rounded-full" />
              <ShimmerBlock className="h-4 w-14" />
            </div>
          </div>
          <ShimmerBlock className="h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="bg-white rounded-lg border p-6 space-y-5">
      <ShimmerBlock className="h-6 w-40" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <ShimmerBlock className="h-3 w-20" />
            <ShimmerBlock className="h-12 md:h-10 w-full" />
          </div>
        ))}
      </div>
      <ShimmerBlock className="h-12 md:h-10 w-full md:w-32 rounded-md" />
    </div>
  );
}

export function KanbanSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: columns }).map((_, colIdx) => (
        <div key={colIdx} className="flex-shrink-0 w-72 bg-slate-50 rounded-lg p-3 space-y-3">
          <ShimmerBlock className="h-5 w-24" />
          {Array.from({ length: 3 - colIdx % 2 }).map((_, cardIdx) => (
            <div key={cardIdx} className="bg-white rounded-lg border p-4 space-y-2">
              <ShimmerBlock className="h-4 w-28" />
              <ShimmerBlock className="h-3 w-20" />
              <ShimmerBlock className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
