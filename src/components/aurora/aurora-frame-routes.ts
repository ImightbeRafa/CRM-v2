/**
 * Routes that render inside the persistent Aurora frame (sidebar stays mounted between them).
 * Everything else (auth, onboarding, logistics, landing, legal) keeps its own chrome.
 */
const FRAME_PREFIXES = [
  '/dashboard',
  '/chats',
  '/ventas',
  '/produccion',
  '/estadisticas',
  '/config',
  '/help',
  '/exports',
  '/backups',
  '/super-admin',
] as const

/** Full-screen classic pages under a frame prefix (no Aurora shell of their own). */
const FRAME_EXCLUDED_PREFIXES = ['/config/agentes/conocimiento', '/config/ai-assistant'] as const

/** Pages whose shell scrolls the main area itself (not `fullBleed`). */
const SCROLLING_PREFIXES = ['/dashboard', '/estadisticas', '/config/agentes'] as const

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isAuroraFrameRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  if (FRAME_EXCLUDED_PREFIXES.some((p) => matches(pathname, p))) return false
  return FRAME_PREFIXES.some((p) => matches(pathname, p))
}

/** Initial `fullBleed` before the page's own shell mounts (keeps SSR and loading close to the page). */
export function isFullBleedAuroraRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return !SCROLLING_PREFIXES.some((p) => matches(pathname, p))
}
