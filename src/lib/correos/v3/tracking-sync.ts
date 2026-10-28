import 'server-only';
import { prisma } from '@/lib/db';
import { getCorreosV3ForRead } from './select';
import { SHIPMENT_STATUS_LM, type CorreosShipmentStatus } from './mappers';
import { dueForTracking, enrollRecentGuias, markCheckFailed, saveTracking } from './store';

/**
 * Tracking sync (cron every 5 min, /api/cron/correos-tracking).
 *
 * - Off unless CORREOS_TRACKING_SYNC=1 and Correos v3 is on (production env only).
 * - Enrolls recent completed Correos guías, then checks the ones that are due
 *   (backoff per status in mappers.nextCheckDelayMs, stops on delivered/returned).
 * - On a status change it writes an lm_order_events row; moving lm_orders.status
 *   is a second switch (CORREOS_TRACKING_LM_STATUS=1). Order (CRM) status is never touched here.
 */

export interface TrackingSyncSummary {
  skipped?: string;
  enrolled: number;
  checked: number;
  changed: number;
  failed: number;
}

async function mapLimit<T>(items: T[], n: number, fn: (t: T) => Promise<void>, deadline: number) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length && Date.now() < deadline) {
        const item = items[i++];
        await fn(item);
      }
    }),
  );
}

export async function runCorreosTrackingSync(opts: { limit?: number; concurrency?: number; budgetMs?: number; env?: NodeJS.Dict<string> } = {}): Promise<TrackingSyncSummary> {
  const env = opts.env ?? process.env;
  const summary: TrackingSyncSummary = { enrolled: 0, checked: 0, changed: 0, failed: 0 };
  if (env.CORREOS_TRACKING_SYNC !== '1') return { ...summary, skipped: 'CORREOS_TRACKING_SYNC is off' };
  // 8 s, no retries: a hanging Correos can't hold the 5-minute cron list (SecureDog INFRA-31).
  const v3 = await getCorreosV3ForRead({ timeoutMs: 8_000, readRetries: 0 }).catch(() => null);
  if (!v3) return { ...summary, skipped: 'Correos v3 is off' };
  if (v3.environment !== 'prod') return { ...summary, skipped: 'Correos v3 is on the test environment' };

  // Short budget: this runs in the sequential 5-min list before the channel-silence alarm (SecureDog INFRA-30).
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  summary.enrolled = await enrollRecentGuias();
  const due = await dueForTracking(opts.limit ?? 25);
  const moveLm = env.CORREOS_TRACKING_LM_STATUS === '1';

  await mapLimit(
    due,
    opts.concurrency ?? 3,
    async (row) => {
      try {
        const t = await v3.track(row.guia_number);
        summary.checked++;
        const saved = await saveTracking(row.crm_tenant_id, t);
        const prev: CorreosShipmentStatus | null = saved?.previous ?? row.last_status;
        if (prev !== t.status && t.status !== 'unknown') {
          summary.changed++;
          const crmOrderId = row.crm_order_id ?? (await findCrmOrderId(row.crm_tenant_id, row.shipping_guia_id));
          if (crmOrderId) await onStatusChange(crmOrderId, row.guia_number, prev, t.status, t.statusText, moveLm);
        }
      } catch {
        summary.failed++;
        await markCheckFailed(row.guia_number);
      }
    },
    deadline,
  );
  return summary;
}

async function findCrmOrderId(tenantId: string, shippingGuiaId: string | null): Promise<string | null> {
  if (!shippingGuiaId) return null;
  const g = await prisma.shippingGuia.findFirst({ where: { id: shippingGuiaId, tenantId }, select: { orderId: true } });
  if (!g) return null;
  const o = await prisma.order.findFirst({ where: { tenantId, orderId: g.orderId }, select: { id: true } });
  return o?.id ?? null;
}

async function onStatusChange(crmOrderId: string, guia: string, from: CorreosShipmentStatus | null, to: CorreosShipmentStatus, text: string | null, moveLm: boolean) {
  try {
    await prisma.$executeRaw`
      INSERT INTO lm_order_events (crm_order_id, event_type, payload)
      VALUES (${crmOrderId}, 'correos_status', ${JSON.stringify({ guiaNumber: guia, from, to, text, source: 'correos-v3-sync' })}::jsonb)
    `;
  } catch {
    // audit trail is best effort
  }
  const lm = SHIPMENT_STATUS_LM[to];
  if (moveLm && lm) {
    try {
      await prisma.$executeRaw`
        UPDATE lm_orders SET status = ${lm}, updated_at = NOW()
        WHERE crm_order_id = ${crmOrderId} AND carrier = 'correos'
      `;
    } catch {
      // lm_orders may not have this order yet
    }
  }
}
