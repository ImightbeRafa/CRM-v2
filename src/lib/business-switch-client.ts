/**
 * Browser state that belongs to ONE business and must not survive a business switch (Phase 2b):
 * unfinished order drafts (customer name / phone / address) and the session-cached form fields.
 * Per-viewer conveniences (rail tab, sidebar collapsed, emoji recents) are kept.
 */
export const BUSINESS_SCOPED_LOCAL_PREFIXES = ['betsy_autosave'] as const

export function clearBusinessScopedBrowserState(storage?: { local?: Storage; session?: Storage }): number {
  let removed = 0
  try {
    const local = storage?.local ?? window.localStorage
    const keys: string[] = []
    for (let i = 0; i < local.length; i++) {
      const k = local.key(i)
      if (k && BUSINESS_SCOPED_LOCAL_PREFIXES.some((p) => k === p || k.startsWith(`${p}:`))) keys.push(k)
    }
    for (const k of keys) {
      local.removeItem(k)
      removed++
    }
  } catch {
    /* private mode */
  }
  try {
    ;(storage?.session ?? window.sessionStorage).clear()
  } catch {
    /* private mode */
  }
  return removed
}
