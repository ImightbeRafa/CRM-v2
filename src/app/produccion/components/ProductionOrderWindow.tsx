'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/app/components/ui/button';
import { Loader2 } from 'lucide-react';

export const PRODUCTION_WINDOW_PAGE_SIZE = 40;

interface ProductionOrderWindowProps<T> {
  items: T[];
  getItemKey: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  resetKey: string;
  hasMoreRemote?: boolean;
  loadingMore?: boolean;
  onLoadMoreRemote?: () => void;
  empty: React.ReactNode;
  className?: string;
}

export function ProductionOrderWindow<T>({
  items,
  getItemKey,
  renderItem,
  resetKey,
  hasMoreRemote = false,
  loadingMore = false,
  onLoadMoreRemote,
  empty,
  className,
}: ProductionOrderWindowProps<T>) {
  const [visibleCount, setVisibleCount] = useState(PRODUCTION_WINDOW_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleCount(PRODUCTION_WINDOW_PAGE_SIZE);
  }, [resetKey]);

  useEffect(() => {
    if (visibleCount > items.length && items.length > 0) {
      setVisibleCount(items.length);
    }
  }, [items.length, visibleCount]);

  const visibleItems = items.slice(0, visibleCount);
  const hasMoreLocal = visibleCount < items.length;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMoreLocal) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleCount((current) => Math.min(current + PRODUCTION_WINDOW_PAGE_SIZE, items.length));
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMoreLocal, items.length]);

  if (items.length === 0) return <>{empty}</>;

  return (
    <div className="space-y-3">
      <div className={className}>
        {visibleItems.map((item) => (
          <div
            key={getItemKey(item)}
            style={{ contentVisibility: 'auto', containIntrinsicSize: '0 420px' }}
          >
            {renderItem(item)}
          </div>
        ))}
      </div>
      {(hasMoreLocal || hasMoreRemote) && (
        <div ref={sentinelRef} className="flex justify-center pt-2">
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore && !hasMoreLocal}
            onClick={() => {
              if (hasMoreLocal) {
                setVisibleCount((current) => Math.min(current + PRODUCTION_WINDOW_PAGE_SIZE, items.length));
                return;
              }
              onLoadMoreRemote?.();
            }}
          >
            {loadingMore && !hasMoreLocal ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {hasMoreLocal
              ? `Mostrar más (${items.length - visibleCount} en esta vista)`
              : 'Cargar más pedidos'}
          </Button>
        </div>
      )}
    </div>
  );
}
