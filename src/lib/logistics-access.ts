/**
 * Logistics (/logistics) is Rafael's DeepSleep ops surface inside Betsy —
 * not a multi-tenant product feature. Access = logistics admin flag AND
 * active membership in the DeepSleep tenant.
 */

export const DEEPSLEEP_TENANT_ID = 'cmhsibjue0004js04gie724nx' as const
export const DEEPSLEEP_TENANT_SLUG = 'deepsleep' as const

export function isDeepSleepTenantId(tenantId: string | null | undefined): boolean {
  return tenantId === DEEPSLEEP_TENANT_ID
}

export function canAccessLogistics(input: {
  isLogisticsAdmin?: boolean | null
  membershipTenantIds?: Array<string | null | undefined> | null
}): boolean {
  if (!input.isLogisticsAdmin) return false
  const ids = input.membershipTenantIds ?? []
  return ids.some((id) => isDeepSleepTenantId(id ?? null))
}
