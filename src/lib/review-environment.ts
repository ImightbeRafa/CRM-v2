/**
 * Preview and local `next dev` synthesize Betsy v2 product flags so reviewers
 * can open Ventas/Producción/Estadísticas with real tenants. Writes still hit
 * the shared database — the amber banner is the warning.
 *
 * Production (`VERCEL_ENV=production`) never synthesizes flags. Ordinary
 * production stores stay on TenantFeatureFlag.enabled (first deploy: all off).
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
 * Product-flag unlock for Betsy v2 on Preview and local `next dev`.
 * Production always returns false, regardless of tenant.
 */
export function arePreviewFeaturesUnlockedForTenant(_tenantId?: string | null): boolean {
  return isNonProductionReviewEnv();
}
