import type { ChipTone } from '@/components/ui/Chip';

/**
 * Chip tone for an order status, CRM (Pendiente, Enviado…) or logistics
 * (Guía Creada, En Tránsito…). Tenant-defined names fall back to neutral.
 */
const TONES: Record<string, ChipTone> = {
  pendiente: 'warning',
  urgente: 'danger',
  'en proceso': 'brand',
  'pendiente diseño': 'brand',
  'pendientediseño': 'brand',
  drive: 'warning',
  'guía creada': 'info',
  'guia creada': 'info',
  impreso: 'info',
  enviado: 'violet',
  'en tránsito': 'violet',
  'en transito': 'violet',
  completado: 'success',
  entregado: 'success',
  retirado: 'success',
  devuelto: 'danger',
  cancelado: 'danger',
};

export function statusTone(status: string | null | undefined): ChipTone {
  return TONES[String(status ?? '').trim().toLowerCase()] ?? 'neutral';
}
