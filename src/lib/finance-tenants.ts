/**
 * Hard allowlist for the external finance API.
 * Only listed CRM tenants — never accept arbitrary client tenantIds.
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
  {
    id: 'cmln5u7k70000ld042qify2og',
    slug: 'deepclean',
    name: 'DeepClean',
  },
  {
    id: 'cmsrgct420000vipcp3xyqb0m',
    slug: 'forge',
    name: 'Forge',
  },
] as const;

export type FinanceTenantSlug = (typeof FINANCE_TENANTS)[number]['slug'];
export type FinanceTenantId = (typeof FINANCE_TENANTS)[number]['id'];

/** Pipe-separated slugs for route docs and error messages. */
export const FINANCE_BRAND_SLUGS = FINANCE_TENANTS.map((t) => t.slug).join('|');

/** Comma-separated slugs for human-readable errors. */
export const FINANCE_BRAND_LIST = FINANCE_TENANTS.map((t) => t.slug).join(', ');

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

/**
 * Adsadder / Bitácora reads `brand=all` two ways:
 * 1. `brands[]` with `slug`
 * 2. extra top-level keys (`deepsleep`, `bloom`, `deepclean`, `forge`)
 * Keep both so a missing key is treated as "Pendiente de Betsy", not ₡0.
 */
export function keyedBySlug<T extends { slug: string }>(rows: readonly T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const row of rows) {
    out[row.slug] = row;
  }
  return out;
}
