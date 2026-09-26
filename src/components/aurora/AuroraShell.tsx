'use client'

import type { ReactNode } from 'react'
import { AuroraSidebar } from './AuroraSidebar'

type AuroraShellProps = {
  children: ReactNode
  /**
   * `false` (default): main area scrolls (dashboard-style pages).
   * `true`: main area is a non-scrolling flex column; child owns scrolling (Chats).
   */
  fullBleed?: boolean
  /** Pinned below the content on narrow viewports (mobile bottom nav). Opt-in per page. */
  bottomNav?: ReactNode
}

/** Shared Aurora chrome: dark sidebar + light content area. Sidebar is desktop-only. */
export function AuroraShell({ children, fullBleed = false, bottomNav }: AuroraShellProps) {
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-[#F7F8FA]">
      <AuroraSidebar />
      <main
        className={`flex min-h-0 min-w-0 flex-1 flex-col ${
          fullBleed ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        {children}
        {bottomNav}
      </main>
    </div>
  )
}
