/**
 * Hard allowlist for the external finance API.
 * Only DeepSleep + Bloom — never accept arbitrary client tenantIds.
 */

export const FINANCE_TENANTS = [
  {
    id: 'cmhsibjue0004js04gie724nx',
    slug: 'deepsleep',
    name: 'DeepSleep',
  },
  {
    id: 'cmm4pv8fl0000jr045en1nik9',
    slug: 'bloom',
    name: 'Bloom',
  },
] as const;

export type FinanceTenantSlug = (typeof FINANCE_TENANTS)[number]['slug'];
export type FinanceTenantId = (typeof FINANCE_TENANTS)[number]['id'];

const BY_ID = new Map(FINANCE_TENANTS.map((t) => [t.id, t]));
const BY_SLUG = new Map(FINANCE_TENANTS.map((t) => [t.slug, t]));

export function getFinanceTenantById(tenantId: string) {
  return BY_ID.get(tenantId as FinanceTenantId) ?? null;
}

export function getFinanceTenantBySlug(slug: string) {
  return BY_SLUG.get(slug as FinanceTenantSlug) ?? null;
}

export function isFinanceTenantId(tenantId: string): boolean {
  return BY_ID.has(tenantId as FinanceTenantId);
}

export function resolveFinanceTenants(brand?: string | null) {
  if (!brand) return [...FINANCE_TENANTS];
  const normalized = brand.trim().toLowerCase();
  if (!normalized || normalized === 'all') return [...FINANCE_TENANTS];
  const tenant = getFinanceTenantBySlug(normalized);
  return tenant ? [tenant] : null;
}
