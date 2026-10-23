/** Where the floating "Betsy" help button shows. Pure (tests import it without Next). */

/**
 * Public pages only, and not the homes (they carry their own mark per view, Lane H). Inside the app the sidebar already carries the Betsy mark (one mark per view,
 * HANDOFF.md) and "Ayuda" lives in the nav and the profile menu.
 */
export const HELP_PUBLIC_ROUTES = ['/privacy', '/terms', '/data-deletion', '/docs'] as const

const matches = (path: string, route: string) => path === route || path.startsWith(`${route}/`)

export function helpButtonPlacement(pathname: string | null): 'all' | null {
  if (!pathname) return null
  return HELP_PUBLIC_ROUTES.some((r) => matches(pathname, r)) ? 'all' : null
}
