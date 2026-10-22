'use client';

import type { ReactNode } from 'react';
import { useTableCardLabels } from '@/app/hooks/useTableCardLabels';

/**
 * Wrapper for a `<table className="m-cards">`: on phones the rows render as
 * labelled cards (globals-mobile.css); on desktop it is a plain div.
 */
export function MobileCardTable({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useTableCardLabels<HTMLDivElement>();
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
