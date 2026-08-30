/**
 * Preview and local `next dev` can show a shared-DB warning and, for one
 * opted-in tenant, exercise Betsy v2 without writing TenantFeatureFlag rows.
 *
 * Production (`VERCEL_ENV=production`) never unlocks product flags. Unlocking
 * v2 for a tenant requires an exact match to `BETSY_V2_TEST_TENANT_ID` and
 * fails closed when that env is unset. Ordinary store owners on a Vercel
 * Preview therefore keep production flag state.
 */

function isNonProductionReviewEnv(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  if (process.env.VERCEL_ENV === 'preview') return true;
  if (process.env.VERCEL_ENV === 'development') return true;
  return process.env.NODE_ENV === 'development';
}

/** Banner only. Never gates product flags. */
export function shouldShowPreviewDataWarning(): boolean {
  return isNonProductionReviewEnv();
}

/**
 * Product-flag unlock for Betsy v2. Production always returns false.
 * Fail closed: missing tenant id or missing `BETSY_V2_TEST_TENANT_ID` stays locked.
 */
export function arePreviewFeaturesUnlockedForTenant(tenantId: string | null | undefined): boolean {
  if (!isNonProductionReviewEnv()) return false;
  const allowed = process.env.BETSY_V2_TEST_TENANT_ID;
  if (!allowed || !tenantId) return false;
  return tenantId === allowed;
}
