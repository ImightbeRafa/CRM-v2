/**
 * How an order reaches the customer, for badges on logistics / production cards:
 * "Correos", "Mensajería privada", "Retiro", each optionally "· Contra entrega".
 * Pure and client-safe.
 *
 * Sources, strongest first:
 *  - `orderType` 'RA' is a pickup order (sales form clears courier/address).
 *  - `lmCarrier` (lm_orders.carrier) is the logistics team's decision on the
 *    board / guide generation: 'correos' | 'mensajeria' | 'retiro'.
 *    'retiro' is also the default the contra-entrega route writes for every
 *    COD order, so it only counts for non-COD orders with nothing else to go on.
 *  - `courier` is free text from the sales form (tenant shipping method names,
 *    "Correos de CR", "correos_cr" after a guide, "manual" for manual guides).
 *  - Contra entrega: `contraEntrega` / `isContraEntrega` or a COD paymentStatus.
 * `delivery` is a status text, not a method, and is ignored.
 */

import { normalizeExternalPaymentStatus } from '@/lib/order-payment-status';

export type ShippingMethodKind = 'correos' | 'mensajeria' | 'retiro' | 'unknown';

export type ShippingMethodInput = {
  orderType?: string | null;
  courier?: string | null;
  lmCarrier?: string | null;
  contraEntrega?: boolean | null;
  isContraEntrega?: boolean | null;
  paymentStatus?: string | null;
  customFields?: unknown;
};

export type ShippingMethodInfo = {
  kind: ShippingMethodKind;
  /** "Correos" | "Mensajería privada" | "Retiro" | "Envío sin definir" */
  methodLabel: string;
  cod: boolean;
  /** Badge text, e.g. "Correos · Contra entrega". */
  label: string;
  /** Free-text courier name when it adds information (tooltip). */
  courierName: string | null;
};

export const SHIPPING_METHOD_LABELS: Record<ShippingMethodKind, string> = {
  correos: 'Correos',
  mensajeria: 'Mensajería privada',
  retiro: 'Retiro',
  unknown: 'Envío sin definir',
};

export const COD_LABEL = 'Contra entrega';

// Placeholder courier text that says nothing about the method.
const EMPTY_COURIERS = new Set([
  'manual', '-', '--', '.', 'n/a', 'na', 'no', 'ninguno', 'ninguna', 'pendiente', 'por definir',
  'sin definir', 'envio', 'envios', 'otro', 'otra', 'courier', 'domicilio', 'envio a domicilio',
]);

function fold(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function rawPaymentStatus(order: ShippingMethodInput): unknown {
  if (order.paymentStatus) return order.paymentStatus;
  let fields = order.customFields;
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch { return null; }
  }
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    const record = fields as Record<string, unknown>;
    return record.paymentStatus ?? record.payment_status;
  }
  return null;
}

function kindFromCourier(courier: string): ShippingMethodKind | null {
  const text = fold(courier);
  if (!text || EMPTY_COURIERS.has(text)) return null;
  if (/correos?\b|correos_cr/.test(text)) return 'correos';
  if (/\b(retiro|retira|recoge|pickup|pick up|en tienda|en local)\b/.test(text)) return 'retiro';
  return 'mensajeria';
}

export function isContraEntregaOrder(order: ShippingMethodInput): boolean {
  if (order.contraEntrega || order.isContraEntrega) return true;
  // Collected COD is still COD for shipping, so this ignores cePaymentConfirmed.
  return normalizeExternalPaymentStatus(rawPaymentStatus(order)) === 'contra_entrega';
}

export function resolveShippingMethod(order: ShippingMethodInput): ShippingMethodInfo {
  const orderType = String(order.orderType ?? '').trim().toUpperCase();
  const lmCarrier = fold(order.lmCarrier);
  const courier = String(order.courier ?? '').trim();
  const fromCourier = kindFromCourier(courier);
  const cod = isContraEntregaOrder(order);

  let kind: ShippingMethodKind;
  if (orderType === 'RA') kind = 'retiro';
  else if (lmCarrier === 'correos' || lmCarrier === 'mensajeria') kind = lmCarrier;
  else if (fromCourier) kind = fromCourier;
  else if (lmCarrier === 'retiro' && !cod) kind = 'retiro';
  else kind = 'unknown';

  const methodLabel = SHIPPING_METHOD_LABELS[kind];
  const label = cod
    ? (kind === 'unknown' ? COD_LABEL : `${methodLabel} · ${COD_LABEL}`)
    : methodLabel;
  const courierName = kind === 'mensajeria' && fromCourier === 'mensajeria' && fold(courier) !== 'mensajeria'
    ? courier
    : null;

  return { kind, methodLabel, cod, label, courierName };
}
