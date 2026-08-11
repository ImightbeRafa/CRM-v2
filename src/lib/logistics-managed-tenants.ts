/**
 * CRM tenant IDs that logistics operators are allowed to manage.
 * Keep in sync across logistics API routes.
 */
export const MANAGED_TENANT_IDS: string[] = [
  'cmh32z0ol0000k004hvx9tg3p',
  'cmhsibjue0004js04gie724nx',
  'cmhutd1th0000jp04oqibtz54',
  'cmigornmw0000lb04kl75262e',
  'cmjdabz4d0000il04dyc5qmcc',
  'cmln5u7k70000ld042qify2og',
  'cmh44aerw0006vijg0640vfl0',
  'cmm4pv8fl0000jr045en1nik9',
];

const MANAGED_SET = new Set<string>(MANAGED_TENANT_IDS);

export function isManagedTenantId(tenantId: string | null | undefined): boolean {
  return typeof tenantId === 'string' && MANAGED_SET.has(tenantId);
}

/**
 * Resolve a logistics tenant filter.
 * - No requested id → all managed tenants
 * - Requested id must be in the managed allowlist (reject otherwise)
 */
export function resolveManagedTenantFilter(
  requestedTenantId: string | null | undefined,
): { ok: true; tenantId: string | { in: string[] } } | { ok: false } {
  if (!requestedTenantId) {
    return { ok: true, tenantId: { in: MANAGED_TENANT_IDS } };
  }
  if (!isManagedTenantId(requestedTenantId)) {
    return { ok: false };
  }
  return { ok: true, tenantId: requestedTenantId };
}

export function filterToManagedTenantIds(ids: string[]): string[] {
  return ids.filter((id) => isManagedTenantId(id));
}
