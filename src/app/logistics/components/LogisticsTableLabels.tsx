'use client';

import { useEffect } from 'react';
import { applyTableCardLabels } from '@/lib/mobile-table-labels';

/**
 * Keeps `data-label` on every logistics table cell up to date, so the phone CSS
 * (logistics-styles.ts) can show each row as a labelled card. Watches the main
 * area for rows that load or change; never touches desktop rendering.
 */
export function LogisticsTableLabels() {
    useEffect(() => {
        const root = document.querySelector('.lm-main');
        if (!root) return;
        let frame = 0;
        const apply = () => {
            frame = 0;
            root.querySelectorAll('table').forEach((table) => applyTableCardLabels(table as HTMLTableElement));
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(apply);
        };
        apply();
        // childList only: our own attribute writes do not re-trigger the observer.
        const observer = new MutationObserver(schedule);
        observer.observe(root, { childList: true, subtree: true, characterData: true });
        return () => {
            observer.disconnect();
            if (frame) cancelAnimationFrame(frame);
        };
    }, []);
    return null;
}
