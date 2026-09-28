'use client'

import { AuroraBell } from './AuroraBell'

/**
 * Right side of every Aurora page header: the notifications bell (real derived alerts).
 * There is deliberately no search field here: no cross-entity search backend exists, and a
 * navigation-only ⌘K palette would be a fake search.
 */
export function AuroraTopActions() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <AuroraBell />
    </div>
  )
}
