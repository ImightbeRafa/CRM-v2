'use client';

import { Chip } from '@/components/ui/Chip';
import { statusTone } from '@/lib/orders/status-tone';

// Status names are tenant-defined; known ones get a tone, the rest stay neutral.
export function StatusBadge({ status, surface = 'aurora' }: { status: string; surface?: 'aurora' | 'dark' }) {
  return (
    <Chip tone={statusTone(status)} surface={surface} dot>
      {status}
    </Chip>
  );
}
