/**
 * Static path redirects into `/config?tab=<canonical>` (imported by next.config.js).
 * Plain JS on purpose: next.config.js cannot import TypeScript.
 *
 * Rules:
 * - All 307 (permanent: false).
 * - Next forwards the request query to the destination; on a key clash the destination wins,
 *   so `tab` always stays canonical and OAuth/Tilopay params survive.
 * - `/config/social` and `/config/ai-assistant` are intentionally absent: both stay real pages.
 * - Query-only aliases (`?tab=hub`, `?tab=cuentas`…) are handled by the server `/config` page,
 *   never here (a `has`-based redirect would loop).
 * - Anything else under `/config/<x>` is caught by `src/app/config/[...slug]/page.tsx`.
 */
export const CONFIG_PATH_REDIRECTS = [
  // Must precede the `:rest+` rule below.
  {
    source: '/config/agentes/conocimiento',
    destination: '/config?tab=agentes&seccion=conocimiento',
    permanent: false,
  },
  { source: '/config/agentes/:rest+', destination: '/config?tab=agentes', permanent: false },
  { source: '/config/agentes', destination: '/config?tab=agentes', permanent: false },
  { source: '/config/integrations', destination: '/config?tab=integrations', permanent: false },
  { source: '/canales', destination: '/config?tab=social', permanent: false },
  { source: '/agentes', destination: '/config?tab=agentes', permanent: false },
]

/**
 * Non-config Aurora path aliases (same rules: 307, query preserved by Next).
 * Kept apart from CONFIG_PATH_REDIRECTS, whose destinations must all be canonical `/config?tab=`.
 */
export const AURORA_ALIAS_REDIRECTS = [
  { source: '/inicio', destination: '/dashboard', permanent: false },
]
