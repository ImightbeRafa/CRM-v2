import 'server-only';
import { prisma } from '@/lib/db';

/** The store's active Correos ShippingConfig.settings (sender, origin, correos_api …), or {}. */
export async function loadTenantCorreosSettings(tenantId: string): Promise<Record<string, any>> {
  const configs = await prisma.shippingConfig.findMany({
    where: { tenantId, isActive: true },
    select: { carrier: true, settings: true },
  });
  const match = configs.find((c) => c.carrier === 'correos_cr') ?? configs.find((c) => c.carrier.toLowerCase().includes('correos'));
  return (match?.settings as Record<string, any>) ?? {};
}

export function tenantOrigin(settings: Record<string, any>) {
  return settings.ws_sender_province && settings.ws_sender_canton && settings.ws_sender_district
    ? { province: String(settings.ws_sender_province), canton: String(settings.ws_sender_canton), district: String(settings.ws_sender_district) }
    : null;
}

/**
 * Guía numbers that Correos issued to THIS store (SecureDog DATA-74): a completed Correos guía of the store
 * (never a hand-typed "manual" one), and no other store holds the same number. Anything else is not the
 * store's to track, pick up or download — a manual guía could otherwise point at someone else's package.
 */
export async function tenantOwnsGuias(tenantId: string, guiaNumbers: string[]): Promise<string[]> {
  const list = [...new Set(guiaNumbers)].slice(0, 200);
  if (list.length === 0) return [];
  const rows = await prisma.shippingGuia.findMany({
    where: { OR: [{ guiaNumber: { in: list } }, { trackingNumber: { in: list } }] },
    select: { tenantId: true, carrier: true, status: true, guiaNumber: true, trackingNumber: true },
  });
  return ownedGuiaNumbers(tenantId, list, rows);
}

export interface GuiaOwnershipRow {
  tenantId: string;
  carrier: string;
  status: string;
  guiaNumber: string | null;
  trackingNumber: string | null;
}

/** Pure rule behind tenantOwnsGuias (unit-tested). */
export function ownedGuiaNumbers(tenantId: string, list: string[], rows: GuiaOwnershipRow[]): string[] {
  const mine = new Set<string>();
  const contested = new Set<string>();
  for (const r of rows) {
    const numbers = [r.guiaNumber, r.trackingNumber].filter((n): n is string => !!n && list.includes(n));
    for (const n of numbers) {
      const issued = r.status === 'completed' && /correos/i.test(r.carrier) && r.carrier !== 'manual';
      if (!issued) continue;
      // Only another store's Correos-issued guía contests a number; a hand-typed one never blocks the owner.
      if (r.tenantId !== tenantId) contested.add(n);
      else mine.add(n);
    }
  }
  return list.filter((g) => mine.has(g) && !contested.has(g));
}
