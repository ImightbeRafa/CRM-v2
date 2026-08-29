/**
 * Preview and local `next dev` can exercise Betsy v2 without writing
 * TenantFeatureFlag rows. Production (`VERCEL_ENV=production`) stays flag-gated.
 * Unit tests typically have neither VERCEL_ENV nor NODE_ENV=development.
 */
export function arePreviewFeaturesUnlocked(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false;
  if (process.env.VERCEL_ENV === 'preview') return true;
  if (process.env.VERCEL_ENV === 'development') return true;
  return process.env.NODE_ENV === 'development';
}
