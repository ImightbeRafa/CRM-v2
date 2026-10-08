/**
 * Preview and local `next dev` synthesize Betsy v2 product flags so reviewers
 * can open Ventas/Producción/Estadísticas with real tenants. Writes still hit
 * the shared database — the amber banner is the warning.
 *
 * Production never synthesizes flags. Ordinary production stores stay on
 * TenantFeatureFlag.enabled (first deploy: all off).
 *
 * `APP_ENV` (normalized with trim().toLowerCase()) replaces the old Vercel
 * `VERCEL_ENV`: 'preview' or 'development' → non-production; 'production' or
 * any other non-empty value → production (fail closed on an unknown value).
 * Unset/empty falls back to `NODE_ENV === 'development'` (local `next dev`
 * only — the container image always sets NODE_ENV=production, so an unset
 * APP_ENV on Cloudflare/Railway is production).
 */

function isNonProductionReviewEnv(): boolean {
  const appEnv = (process.env.APP_ENV || '').trim().toLowerCase();
  if (appEnv === 'production') return false;
  if (appEnv === 'preview' || appEnv === 'development') return true;
  if (appEnv) return false; // unknown value: fail closed
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
