/**
 * CRM tenant IDs that logistics operators are allowed to manage.
 * Keep display names/colors in this file — logistics UI and APIs read from here.
 */
export const MANAGED_TENANTS = [
  { id: 'cmh32z0ol0000k004hvx9tg3p', defaultName: 'WhatASheet CR', defaultColor: '#6c63ff' },
  { id: 'cmhsibjue0004js04gie724nx', defaultName: 'DeepSleep', defaultColor: '#3b82f6' },
  { id: 'cmhutd1th0000jp04oqibtz54', defaultName: 'WAS CR', defaultColor: '#22c55e' },
  { id: 'cmigornmw0000lb04kl75262e', defaultName: 'Kroma Lab', defaultColor: '#f59e0b' },
  { id: 'cmjdabz4d0000il04dyc5qmcc', defaultName: 'SimplePatch', defaultColor: '#ef4444' },
  { id: 'cmln5u7k70000ld042qify2og', defaultName: 'DeepCLean', defaultColor: '#a855f7' },
  { id: 'cmh44aerw0006vijg0640vfl0', defaultName: 'PeterTesting', defaultColor: '#06b6d4' },
  { id: 'cmm4pv8fl0000jr045en1nik9', defaultName: 'Bloom', defaultColor: '#ec4899' },
  { id: 'cmsrgct420000vipcp3xyqb0m', defaultName: 'Forge', defaultColor: '#f97316' },
] as const;

export type ManagedTenantId = (typeof MANAGED_TENANTS)[number]['id'];

export const MANAGED_TENANT_IDS: string[] = MANAGED_TENANTS.map((t) => t.id);

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
