export type LogisticsCarrier = 'mensajeria' | 'correos' | 'retiro';

const GREEN_DELIVERY_VARIANTS = new Set([
  'green delivery',
  'green delivey',
  'green delyvery',
  'greendelivery',
]);

export function normalizeCourierText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Infer logistics carrier from CRM order fields.
 * Returns null when uncertain — never guesses unknown free-text couriers.
 */
export function inferLogisticsCarrier(input: {
  orderType?: string | null;
  courier?: string | null;
  hasCorreosGuia?: boolean;
}): LogisticsCarrier | null {
  if (input.hasCorreosGuia) return 'correos';

  const orderType = String(input.orderType || '').toUpperCase();
  const courier = normalizeCourierText(input.courier);

  if (orderType === 'RA') {
    if (!courier || courier === 'null' || courier === '-') return 'retiro';
    // Non-blank courier on RA is ambiguous — leave unassigned
    return null;
  }

  if (orderType === 'EA') {
    if (!courier || courier === 'null' || courier === '-') return null;
    if (courier.includes('correos') || courier === 'ccr' || courier.startsWith('ccr ')) {
      return 'correos';
    }
    if (courier.includes('mensajeria') || GREEN_DELIVERY_VARIANTS.has(courier)) {
      return 'mensajeria';
    }
    return null;
  }

  return null;
}

export function mapCrmStatusToLogisticsStatus(
  status: string | null | undefined,
  delivery?: string | null,
): string {
  const raw = String(status || delivery || '').trim();
  const normalized = normalizeCourierText(raw);

  switch (normalized) {
    case 'pendiente':
    case 'pending':
      return 'Pendiente';
    case 'en proceso':
    case 'processing':
      return 'En Proceso';
    case 'enviado':
    case 'shipped':
    case 'en transito':
      return 'En Tránsito';
    case 'impreso':
      return 'Impreso';
    case 'entregado':
      return 'Entregado';
    case 'devuelto':
    case 'cancelled':
    case 'canceled':
      return 'Devuelto';
    case 'completado':
    case 'completed':
      return 'Pendiente';
    default:
      return 'Pendiente';
  }
}
