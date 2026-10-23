'use client';

import { Banknote, CheckCircle2, CircleDashed, Clock, type LucideIcon } from 'lucide-react';
import { Chip, type ChipTone } from '@/components/ui/Chip';
import {
  derivePaymentState,
  type PaymentStateKey,
  type PaymentStatusSource,
} from '@/lib/order-payment-status';

const PAYMENT: Record<PaymentStateKey, { tone: ChipTone; icon: LucideIcon }> = {
  pagado: { tone: 'success', icon: CheckCircle2 },
  contra_entrega: { tone: 'warning', icon: Banknote },
  pendiente_pago: { tone: 'warning', icon: Clock },
  sin_registrar: { tone: 'neutral', icon: CircleDashed },
};

export function PaymentStatusBadge({
  order,
  className = '',
}: {
  order: PaymentStatusSource;
  className?: string;
}) {
  const state = derivePaymentState(order);
  const look = PAYMENT[state.key];
  return (
    <Chip tone={look.tone} icon={look.icon} className={className}>
      {state.label}
    </Chip>
  );
}
