'use client'

import { createContext, useContext, type ReactNode } from 'react'
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

/** True inside an AuroraShell: nested shells (e.g. Config panels) render only their children. */
const AuroraShellContext = createContext(false)

/** Shared Aurora chrome: dark sidebar + light content area. Sidebar is desktop-only. */
export function AuroraShell({ children, fullBleed = false, bottomNav }: AuroraShellProps) {
  const nested = useContext(AuroraShellContext)
  if (nested) return <>{children}</>

  return (
    <AuroraShellContext.Provider value={true}>
      <div className="flex h-[100dvh] w-full overflow-hidden bg-[#F7F8FA]">
        <AuroraSidebar />
        <main
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${
            fullBleed ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {children}
          {bottomNav && !fullBleed ? (
            <div className="sticky bottom-0 z-30 mt-auto md:hidden">{bottomNav}</div>
          ) : (
            bottomNav
          )}
        </main>
      </div>
    </AuroraShellContext.Provider>
  )
}
