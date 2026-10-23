'use client';

import type { CSSProperties } from 'react';
import { Banknote, Bike, Mailbox, Package, Store, type LucideIcon } from 'lucide-react';
import { Chip, type ChipTone } from '@/components/ui/Chip';
import {
  COD_LABEL,
  resolveShippingMethod,
  type ShippingMethodInput,
  type ShippingMethodKind,
} from '@/lib/orders/shipping-method';

const METHOD: Record<ShippingMethodKind, { icon: LucideIcon; tone: ChipTone }> = {
  correos: { icon: Mailbox, tone: 'info' },
  mensajeria: { icon: Bike, tone: 'violet' },
  retiro: { icon: Store, tone: 'success' },
  unknown: { icon: Package, tone: 'neutral' },
};

/**
 * How the order ships, as chips: [Correos] [Contra entrega]. Built on the shared
 * Chip so it matches payment and status chips everywhere; `theme="dark"` for
 * the always-dark Logística pages.
 */
export default function ShippingMethodBadge({
  order,
  theme = 'light',
  size = 'sm',
  showCod = true,
  style,
}: {
  order: ShippingMethodInput;
  theme?: 'light' | 'dark';
  size?: 'xs' | 'sm';
  /** false where a payment column already says "Contra entrega". */
  showCod?: boolean;
  style?: CSSProperties;
}) {
  const info = resolveShippingMethod(order);
  const cod = showCod && info.cod;
  // COD with no known method: the COD chip alone says it all.
  const showMethod = !(info.kind === 'unknown' && cod);
  const surface = theme === 'dark' ? 'dark' : 'aurora';
  const chipSize = size === 'xs' ? 'sm' : 'md';
  const method = METHOD[info.kind];
  const title = [`Envío: ${info.methodLabel}`, info.courierName ? `(${info.courierName})` : '', cod ? `· ${COD_LABEL}` : '']
    .filter(Boolean)
    .join(' ');

  return (
    <span
      title={title}
      aria-label={cod ? info.label : info.methodLabel}
      data-shipping-method={info.kind}
      data-cod={cod ? 'true' : undefined}
      className="inline-flex max-w-full flex-wrap items-center gap-1"
      style={style}
    >
      {showMethod && (
        <Chip tone={method.tone} icon={method.icon} size={chipSize} surface={surface}>
          {info.methodLabel}
        </Chip>
      )}
      {cod && (
        <Chip tone="warning" icon={Banknote} size={chipSize} surface={surface}>
          {COD_LABEL}
        </Chip>
      )}
    </span>
  );
}
