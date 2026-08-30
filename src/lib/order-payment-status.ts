export const PAYMENT_STATE_KEYS = ['pagado', 'contra_entrega', 'pendiente_pago', 'sin_registrar'] as const;

export type PaymentStateKey = (typeof PAYMENT_STATE_KEYS)[number];

export type ManualPaymentChoice = 'pagado' | 'contra_entrega' | 'pendiente_pago';

export interface PaymentState {
  key: PaymentStateKey;
  label: string;
  collected: boolean;
}

export interface PaymentStatusSource {
  status?: string | null;
  contraEntrega?: boolean | null;
  cePaymentConfirmed?: boolean | null;
  customFields?: unknown;
}

const PAID_TOKENS = new Set(['paid', 'pagado', 'pagada', 'completed', 'complete', 'success', 'succeeded', 'confirmed', 'confirmado']);
const WAITING_TOKENS = new Set(['waiting', 'pending', 'pendiente', 'unpaid', 'unpaid_pending', 'awaiting', 'pendiente_pago', 'pendiente de pago']);
const COD_TOKENS = new Set(['cod', 'cod_pending', 'contra_entrega', 'contraentrega', 'cash_on_delivery', 'ce']);
const CANCELLED_TOKENS = new Set(['cancelado', 'cancelled', 'canceled', 'anulado', 'rechazado', 'devuelto']);

export const PAYMENT_STATE_LABELS: Record<PaymentStateKey, string> = {
  pagado: 'Pagado',
  contra_entrega: 'Contra entrega',
  pendiente_pago: 'Pendiente de pago',
  sin_registrar: 'Sin registrar',
};

function readCustomFields(customFields: unknown): Record<string, unknown> {
  if (!customFields) return {};
  if (typeof customFields === 'string') {
    try {
      const parsed = JSON.parse(customFields);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  if (typeof customFields === 'object') {
    return customFields as Record<string, unknown>;
  }
  return {};
}

function normalizeToken(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .trim();
}

export function normalizeExternalPaymentStatus(raw: unknown): ManualPaymentChoice | null {
  const token = normalizeToken(raw).replace(/\s+/g, '_');
  if (!token) return null;
  if (PAID_TOKENS.has(token) || PAID_TOKENS.has(token.replace(/_/g, ' '))) return 'pagado';
  if (COD_TOKENS.has(token) || COD_TOKENS.has(token.replace(/_/g, ''))) return 'contra_entrega';
  if (WAITING_TOKENS.has(token) || WAITING_TOKENS.has(token.replace(/_/g, ' '))) return 'pendiente_pago';
  return null;
}

function fulfillmentIsCancelled(status: string | null | undefined): boolean {
  return CANCELLED_TOKENS.has(normalizeToken(status));
}

function fulfillmentIsPending(status: string | null | undefined): boolean {
  const token = normalizeToken(status);
  return !token || token === 'pendiente';
}

export function derivePaymentState(order: PaymentStatusSource): PaymentState {
  const fields = readCustomFields(order.customFields);
  const explicit = normalizeExternalPaymentStatus(fields.paymentStatus ?? fields.payment_status);

  if (order.contraEntrega) {
    if (order.cePaymentConfirmed || explicit === 'pagado') {
      return { key: 'pagado', label: PAYMENT_STATE_LABELS.pagado, collected: true };
    }
    return { key: 'contra_entrega', label: PAYMENT_STATE_LABELS.contra_entrega, collected: false };
  }

  if (explicit === 'pagado') {
    return { key: 'pagado', label: PAYMENT_STATE_LABELS.pagado, collected: true };
  }
  if (explicit === 'contra_entrega') {
    return { key: 'contra_entrega', label: PAYMENT_STATE_LABELS.contra_entrega, collected: false };
  }
  if (explicit === 'pendiente_pago') {
    return { key: 'pendiente_pago', label: PAYMENT_STATE_LABELS.pendiente_pago, collected: false };
  }

  if (fulfillmentIsCancelled(order.status)) {
    return { key: 'sin_registrar', label: PAYMENT_STATE_LABELS.sin_registrar, collected: false };
  }
  if (fulfillmentIsPending(order.status)) {
    return { key: 'pendiente_pago', label: PAYMENT_STATE_LABELS.pendiente_pago, collected: false };
  }

  return { key: 'pagado', label: PAYMENT_STATE_LABELS.pagado, collected: true };
}

export function isCollectedRevenue(order: PaymentStatusSource): boolean {
  return derivePaymentState(order).collected;
}

export function paymentChoiceToOrderFields(choice: ManualPaymentChoice): {
  contraEntrega: boolean;
  paymentStatus: 'paid' | 'waiting' | 'cod';
} {
  switch (choice) {
    case 'pagado':
      return { contraEntrega: false, paymentStatus: 'paid' };
    case 'contra_entrega':
      return { contraEntrega: true, paymentStatus: 'cod' };
    case 'pendiente_pago':
      return { contraEntrega: false, paymentStatus: 'waiting' };
    default: {
      const exhaustive: never = choice;
      return exhaustive;
    }
  }
}

export const CUSTOMER_ACTIVITY_STATUS_LABELS = {
  muy_activo: 'Muy activo',
  activo: 'Activo',
  moderado: 'Moderado',
  inactivo: 'Inactivo',
  sin_pedidos: 'Sin pedidos',
} as const;

export type CustomerActivityStatusKey = keyof typeof CUSTOMER_ACTIVITY_STATUS_LABELS;

export function customerActivityStatus(daysSinceLastOrder: number | null): string {
  if (daysSinceLastOrder === null) return CUSTOMER_ACTIVITY_STATUS_LABELS.sin_pedidos;
  if (daysSinceLastOrder <= 7) return CUSTOMER_ACTIVITY_STATUS_LABELS.muy_activo;
  if (daysSinceLastOrder <= 30) return CUSTOMER_ACTIVITY_STATUS_LABELS.activo;
  if (daysSinceLastOrder <= 90) return CUSTOMER_ACTIVITY_STATUS_LABELS.moderado;
  return CUSTOMER_ACTIVITY_STATUS_LABELS.inactivo;
}
