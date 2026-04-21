import type { Prisma } from '@prisma/client';

type OrderStatusClient = {
  order: {
    updateMany(args: Prisma.OrderUpdateManyArgs): Promise<Prisma.BatchPayload>;
  };
};

const LOGISTICS_TO_CRM_STATUS: Record<string, string> = {
  pendiente: 'Pendiente',
  'en proceso': 'En Proceso',
  'guia creada': 'Enviado',
  impreso: 'Enviado',
  'en transito': 'Enviado',
  entregado: 'Entregado',
  devuelto: 'Devuelto',
};

const AUTO_SYNC_CRM_STATUSES = new Set(['Entregado', 'Devuelto']);

function normalizeStatus(status: string): string {
  return status
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function mapLogisticsStatusToCrmStatus(lmStatus: string | null | undefined) {
  if (!lmStatus) return null;
  return LOGISTICS_TO_CRM_STATUS[normalizeStatus(lmStatus)] ?? null;
}

export function shouldAutoSyncLogisticsStatus(lmStatus: string | null | undefined) {
  const crmStatus = mapLogisticsStatusToCrmStatus(lmStatus);
  return crmStatus ? AUTO_SYNC_CRM_STATUSES.has(crmStatus) : false;
}

export async function syncLogisticsStatusToCrmOrders(
  db: OrderStatusClient,
  orderIds: string[],
  lmStatus: string | null | undefined,
  options: { allowNonTerminal?: boolean } = {},
) {
  const crmStatus = mapLogisticsStatusToCrmStatus(lmStatus);
  const uniqueOrderIds = [...new Set(orderIds.filter(Boolean))];

  if (!crmStatus || uniqueOrderIds.length === 0) {
    return { synced: false, crmStatus, count: 0 };
  }

  if (!options.allowNonTerminal && !AUTO_SYNC_CRM_STATUSES.has(crmStatus)) {
    return { synced: false, crmStatus, count: 0 };
  }

  const result = await db.order.updateMany({
    where: { id: { in: uniqueOrderIds } },
    data: { status: crmStatus },
  });

  return { synced: true, crmStatus, count: result.count };
}
