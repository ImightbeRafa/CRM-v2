'use client';

import { Badge } from '@/app/components/ui/badge';
import {
  derivePaymentState,
  type PaymentStatusSource,
} from '@/lib/order-payment-status';

const BADGE_CLASS: Record<string, string> = {
  pagado: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  contra_entrega: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20',
  pendiente_pago: 'bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20',
  sin_registrar: 'bg-muted text-muted-foreground',
};

export function PaymentStatusBadge({
  order,
  className = '',
}: {
  order: PaymentStatusSource;
  className?: string;
}) {
  const state = derivePaymentState(order);
  return (
    <Badge variant="outline" className={`${BADGE_CLASS[state.key]} ${className}`.trim()}>
      {state.label}
    </Badge>
  );
}
