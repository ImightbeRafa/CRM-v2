'use client';

import { Chip, type ChipTone } from '@/components/ui/Chip';

// Status names are tenant-defined; known ones get a tone, the rest stay neutral.
const STATUS_TONE: Record<string, ChipTone> = {
  pendiente: 'warning',
  'en proceso': 'info',
  completado: 'success',
  entregado: 'violet',
  enviado: 'violet',
  cancelado: 'danger',
  drive: 'warning',
  impreso: 'neutral',
  pendientediseño: 'brand',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Chip tone={STATUS_TONE[status.toLowerCase()] ?? 'neutral'} dot>
      {status}
    </Chip>
  );
}
