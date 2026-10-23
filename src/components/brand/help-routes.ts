/** Where the floating "Betsy" help button shows. Pure (tests import it without Next). */

/** Public pages: shown on every size. */
export const HELP_PUBLIC_ROUTES = ['/home', '/home-preview', '/privacy', '/terms', '/data-deletion', '/docs'] as const
/**
 * App shell: desktop only (phones have the bottom nav), and never where a composer, a chat
 * sandbox or a dense table owns the bottom-right corner (inbox, agents, orders, stats…).
 */
export const HELP_SHELL_ROUTES = ['/dashboard', '/tareas', '/help', '/config'] as const
export const HELP_HIDDEN_ROUTES = ['/config/agentes'] as const

const matches = (path: string, route: string) => path === route || path.startsWith(`${route}/`)

export function helpButtonPlacement(pathname: string | null): 'all' | 'desktop' | null {
  if (!pathname) return null
  if (HELP_HIDDEN_ROUTES.some((r) => matches(pathname, r))) return null
  if (HELP_PUBLIC_ROUTES.some((r) => matches(pathname, r))) return 'all'
  if (HELP_SHELL_ROUTES.some((r) => matches(pathname, r))) return 'desktop'
  return null
}
