import { NextRequest, NextResponse } from 'next/server';
import { guardFinanceApi } from '@/lib/finance-auth';
import { FINANCE_ORDER_CLASSIFIER_VERSION } from '@/lib/finance-order-classifier';
import {
  FINANCE_ORDERS_DEFAULT_LIMIT,
  FINANCE_ORDERS_MAX_LIMIT,
} from '@/lib/finance-orders';
import { FINANCE_TENANTS } from '@/lib/finance-tenants';
import { getCurrentWeekStartKey, getWeekEndKey } from '@/lib/logistics-workforce';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/finance/v1/meta
 * Describes endpoints, brands, and how numbers should be interpreted.
 */
export async function GET(req: NextRequest) {
  const guard = await guardFinanceApi(req);
  if (guard) return guard;

  const weekStart = getCurrentWeekStartKey();

  return NextResponse.json({
    name: 'Betsy Finance API',
    version: 'v1',
    currency: 'CRC',
    timezone: 'America/Costa_Rica',
    auth: {
      header: 'x-api-key',
      alternate: 'Authorization: Bearer <FINANCE_API_KEY>',
    },
    brands: FINANCE_TENANTS.map(({ slug, name, id }) => ({ slug, name, tenantId: id })),
    orderClassification: {
      classifierVersion: FINANCE_ORDER_CLASSIFIER_VERSION,
      deepsleepBusinesses: ['deepsleep', 'patchhouse', 'purasonrisa', 'unassigned'],
      bloomBusinesses: ['bloom'],
      channels: ['web', 'messages'],
      note:
        'DeepSleep tenant contains three businesses. business=unassigned means finance app should assign manually. Seller/WhatsApp session never selects business.',
    },
    defaultPeriod: {
      dateFrom: weekStart,
      dateTo: getWeekEndKey(weekStart),
      note: 'Current Costa Rica week (Mon–Sun) when dateFrom/dateTo omitted',
      maxRangeDays: 92,
    },
    endpoints: [
      {
        method: 'GET',
        path: '/api/finance/v1/costs',
        query: ['dateFrom', 'dateTo', 'brand'],
        description:
          'Per-brand logistics costs: package counts, envío, impuestos, manejo, tilopay. No order rows. Excludes payroll.',
      },
      {
        method: 'GET',
        path: '/api/finance/v1/facturacion',
        query: ['dateFrom', 'dateTo', 'brand'],
        description:
          'Per-brand revenue summary (orderCount, revenueCrc, AOV, activeClients) matching /estadisticas.',
      },
      {
        method: 'GET',
        path: '/api/finance/v1/payroll',
        query: ['dateFrom', 'dateTo'],
        description:
          'Per-employee weekly payroll (hours + totalCrc). Global logistics — not brand-specific.',
      },
      {
        method: 'GET',
        path: '/api/finance/v1/orders',
        query: [
          'brand (required: deepsleep|bloom)',
          'dateFrom',
          'dateTo',
          'updatedSince',
          'cursor',
          `limit (default ${FINANCE_ORDERS_DEFAULT_LIMIT}, max ${FINANCE_ORDERS_MAX_LIMIT})`,
          'needsManualAssignment',
        ],
        description:
          'Order rows with tenant/business/channel tags. Period mode (dateFrom/dateTo) or changes mode (updatedSince). Unassigned DeepSleep leftovers flagged for finance-app manual assignment. No customer PII.',
      },
      {
        method: 'GET',
        path: '/api/finance/v1/meta',
        query: [],
        description: 'This document.',
      },
    ],
    warnings: [
      'Costs cover delivered (Entregado) orders by completion date; facturación covers all saved orders by sale date — do not treat them as a pure same-basis margin.',
      'Payroll is a single shared logistics cost; do not double-count it into both DeepSleep and Bloom.',
      'Orders classifierVersion changes require re-bootstrap of stored finance periods.',
      'Hard-deleted CRM orders are not tombstoned — periodically re-pull recent periods.',
    ],
  });
}
