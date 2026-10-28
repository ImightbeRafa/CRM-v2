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

/** True when this guía number belongs to one of the store's guías (tracking / pickup ownership). */
export async function tenantOwnsGuias(tenantId: string, guiaNumbers: string[]): Promise<string[]> {
  const list = [...new Set(guiaNumbers)].slice(0, 200);
  if (list.length === 0) return [];
  const rows = await prisma.shippingGuia.findMany({
    where: { tenantId, OR: [{ guiaNumber: { in: list } }, { trackingNumber: { in: list } }] },
    select: { guiaNumber: true, trackingNumber: true },
  });
  const owned = new Set<string>();
  for (const r of rows) {
    if (r.guiaNumber) owned.add(r.guiaNumber);
    if (r.trackingNumber) owned.add(r.trackingNumber);
  }
  return list.filter((g) => owned.has(g));
}
