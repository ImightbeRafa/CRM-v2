export type InviteMembershipAction = 'create' | 'reactivate' | 'conflict';

export function selectActiveTenantId(
  defaultTenantId: string | null | undefined,
  activeTenantIds: string[],
): string | null {
  if (defaultTenantId && activeTenantIds.includes(defaultTenantId)) {
    return defaultTenantId;
  }
  return activeTenantIds[0] ?? null;
}

export function resolveDefaultTenantAfterRemoval(
  currentDefaultTenantId: string | null | undefined,
  removedTenantId: string,
  remainingActiveTenantIds: string[],
): string | null {
  if (
    currentDefaultTenantId &&
    currentDefaultTenantId !== removedTenantId &&
    remainingActiveTenantIds.includes(currentDefaultTenantId)
  ) {
    return currentDefaultTenantId;
  }
  return remainingActiveTenantIds[0] ?? null;
}

export function inviteMembershipAction(
  existing: { isActive: boolean } | null,
): InviteMembershipAction {
  if (!existing) return 'create';
  if (existing.isActive) return 'conflict';
  return 'reactivate';
}

export function buildOwnedTenantSlug(email: string, now = Date.now()): string {
  const emailPrefix = email.split('@')[0] || 'org';
  const slugBase = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'org';
  return `${slugBase}-${now}`;
}
