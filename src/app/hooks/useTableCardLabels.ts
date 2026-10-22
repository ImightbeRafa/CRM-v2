'use client';

import { useEffect, useRef } from 'react';
import { applyTableCardLabels } from '@/lib/mobile-table-labels';

/**
 * Attach to the element that wraps a `<table className="m-cards">`: keeps each
 * cell's `data-label` in sync with the header so globals-mobile.css can show
 * rows as labelled cards on phones. Watches only this subtree.
 */
export function useTableCardLabels<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let frame = 0;
    const apply = () => {
      frame = 0;
      root.querySelectorAll('table.m-cards').forEach((table) => applyTableCardLabels(table as HTMLTableElement));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}
