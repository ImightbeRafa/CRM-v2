/**
 * Order.clientId reconciliation package. Read-only by default.
 *
 * Dry run:
 *   npx tsx scripts/betsy-v2-client-backfill.ts --tenant=<exact-id>
 *
 * Apply (only after separate human approval and additive SQL execution):
 *   BETSY_V2_BACKFILL_APPROVED_TENANT=<exact-id> npx tsx scripts/betsy-v2-client-backfill.ts --tenant=<exact-id> --apply
 */
import { prisma } from '../src/lib/db';
import { ORDER_LIFECYCLE_V2_FLAG } from '../src/lib/feature-flags';
import { normalizeClientEmail, normalizeClientPhone } from '../src/lib/order-lifecycle';

const tenantArg = process.argv.find(arg => arg.startsWith('--tenant='));
const tenantId = tenantArg?.slice('--tenant='.length).trim();
const apply = process.argv.includes('--apply');

if (!tenantId) throw new Error('Exact --tenant=<id> is required; all-tenant execution is prohibited');
if (apply && process.env.BETSY_V2_BACKFILL_APPROVED_TENANT !== tenantId) {
  throw new Error('Apply blocked: BETSY_V2_BACKFILL_APPROVED_TENANT must equal the exact tenant ID');
}

const [tenant, clients, orders] = await Promise.all([
  prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } }),
  prisma.client.findMany({ where: { tenantId, isActive: true }, select: { id: true, phone: true, email: true } }),
  prisma.order.findMany({
    where: { tenantId, clientId: null },
    select: { id: true, orderId: true, phone: true, email: true },
    orderBy: { timestamp: 'asc' },
  }),
]);
if (!tenant) throw new Error('Tenant not found');

const phoneMap = new Map<string, string[]>();
const emailMap = new Map<string, string[]>();
for (const client of clients) {
  const phone = normalizeClientPhone(client.phone);
  const email = normalizeClientEmail(client.email);
  if (phone) phoneMap.set(phone, [...(phoneMap.get(phone) || []), client.id]);
  if (email) emailMap.set(email, [...(emailMap.get(email) || []), client.id]);
}

const links: Array<{ orderId: string; clientId: string }> = [];
const conflicts: Array<{ orderId: string; reason: string; candidateClientIds: string[] }> = [];
for (const order of orders) {
  const phone = normalizeClientPhone(order.phone);
  const email = normalizeClientEmail(order.email);
  const phoneIds = phone ? phoneMap.get(phone) || [] : [];
  const emailIds = email ? emailMap.get(email) || [] : [];
  let selected: string | null = null;
  let reason: string | null = null;
  if (phoneIds.length > 1) reason = 'multiple_phone_matches';
  else if (phoneIds.length === 1) {
    selected = phoneIds[0];
    if (emailIds.length > 0 && !emailIds.includes(selected)) reason = 'phone_email_disagree';
  } else if (emailIds.length > 1) reason = 'multiple_email_matches';
  else if (emailIds.length === 1) {
    const emailClient = clients.find(client => client.id === emailIds[0]);
    const emailClientPhone = normalizeClientPhone(emailClient?.phone);
    if (phone && emailClientPhone && phone !== emailClientPhone) reason = 'email_phone_disagree';
    else selected = emailIds[0];
  }

  if (reason) conflicts.push({ orderId: order.id, reason, candidateClientIds: [...new Set([...phoneIds, ...emailIds])] });
  else if (selected) links.push({ orderId: order.id, clientId: selected });
}

const report = {
  mode: apply ? 'APPLY' : 'DRY_RUN',
  tenant: { id: tenant.id, name: tenant.name },
  clients: clients.length,
  unlinkedOrders: orders.length,
  proposedLinks: links.length,
  conflicts: conflicts.length,
  unmatched: orders.length - links.length - conflicts.length,
  conflictReasons: conflicts.reduce<Record<string, number>>((counts, item) => {
    counts[item.reason] = (counts[item.reason] || 0) + 1;
    return counts;
  }, {}),
};
console.log(JSON.stringify(report, null, 2));

if (apply) {
  await prisma.$transaction(async tx => {
    for (const client of clients) {
      await tx.client.updateMany({
        where: { id: client.id, tenantId },
        data: { normalizedPhone: normalizeClientPhone(client.phone), normalizedEmail: normalizeClientEmail(client.email) },
      });
    }
    for (const link of links) {
      await tx.order.updateMany({
        where: { id: link.orderId, tenantId, clientId: null },
        data: { clientId: link.clientId },
      });
    }
    for (const conflict of conflicts) {
      const order = orders.find(item => item.id === conflict.orderId)!;
      const exists = await tx.clientIdentityConflict.findFirst({ where: { tenantId, orderId: conflict.orderId, status: 'open' } });
      if (!exists) {
        await tx.clientIdentityConflict.create({
          data: {
            tenantId,
            orderId: conflict.orderId,
            normalizedPhone: normalizeClientPhone(order.phone),
            normalizedEmail: normalizeClientEmail(order.email),
            candidateClientIds: conflict.candidateClientIds,
            reason: conflict.reason,
          },
        });
      }
    }

    const completedAt = new Date().toISOString();
    const existingFlag = await tx.tenantFeatureFlag.findFirst({
      where: { tenantId, scope: tenantId, key: ORDER_LIFECYCLE_V2_FLAG },
      select: { id: true, config: true },
    });
    const config = {
      ...(existingFlag?.config && typeof existingFlag.config === 'object' && !Array.isArray(existingFlag.config)
        ? existingFlag.config as Record<string, unknown>
        : {}),
      clientBackfillCompletedAt: completedAt,
    };
    if (existingFlag) {
      await tx.tenantFeatureFlag.update({ where: { id: existingFlag.id }, data: { config } });
    } else {
      await tx.tenantFeatureFlag.create({
        data: {
          tenantId,
          scope: tenantId,
          key: ORDER_LIFECYCLE_V2_FLAG,
          enabled: false,
          config,
        },
      });
    }
  });
  console.log(JSON.stringify({ applied: true, linked: links.length, queuedConflicts: conflicts.length, clientBackfillCompletedAt: true }));
}

await prisma.$disconnect();
