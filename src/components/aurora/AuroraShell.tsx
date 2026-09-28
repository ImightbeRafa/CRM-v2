'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePathname } from 'next/navigation'
import { AuroraSidebar } from './AuroraSidebar'
import { AuroraToaster } from './ui/AuroraToaster'
import { AuroraConfirmHost } from './ui/AuroraConfirmHost'
import { isAuroraFrameRoute, isFullBleedAuroraRoute } from './aurora-frame-routes'

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

type ShellContextValue =
  | null
  /** Persistent frame from the root layout: the first AuroraShell below it claims the layout options. */
  | { kind: 'frame'; claim: (id: string, fullBleed: boolean) => void; release: (id: string) => void }
  /** Inside a page-level shell: nested shells (e.g. Config panels) render only their children. */
  | { kind: 'page' }

const AuroraShellContext = createContext<ShellContextValue>(null)
const PAGE_CONTEXT: ShellContextValue = { kind: 'page' }

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** True when rendered under an Aurora shell or the persistent frame (sidebar already on screen). */
export function useInAuroraFrame(): boolean {
  return useContext(AuroraShellContext) !== null
}

function useAuroraShellMarker(active: boolean) {
  // Let global widgets (feedback FAB) know an Aurora shell is on screen, whenever it mounts.
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    root.dataset.auroraShell = '1'
    window.dispatchEvent(new Event('betsy:aurora-shell'))
    return () => {
      delete root.dataset.auroraShell
      window.dispatchEvent(new Event('betsy:aurora-shell'))
    }
  }, [active])
}

function ShellChrome({ fullBleed, children }: { fullBleed: boolean; children: ReactNode }) {
  return (
    <>
      {/* Height leaves room for global banners (AppTopBanners sets --app-top-offset) so the mobile bottom nav stays visible. */}
      <div data-aurora-shell className="flex h-[calc(100dvh-var(--app-top-offset,0px))] w-full overflow-hidden bg-[var(--aurora-canvas)]">
        <AuroraSidebar />
        <main
          className={`flex min-h-0 min-w-0 flex-1 flex-col ${
            fullBleed ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {children}
        </main>
      </div>
      <AuroraToaster />
      <AuroraConfirmHost />
    </>
  )
}

function ShellBody({ fullBleed, bottomNav, children }: { fullBleed: boolean; bottomNav?: ReactNode; children: ReactNode }) {
  return (
    <>
      {children}
      {bottomNav && !fullBleed ? (
        <div className="sticky bottom-0 z-30 mt-auto md:hidden">{bottomNav}</div>
      ) : (
        bottomNav
      )}
    </>
  )
}

/** Page-level shell under the persistent frame: claims `fullBleed`, renders the body only. */
function ClaimedShell({
  claim,
  release,
  fullBleed,
  bottomNav,
  children,
}: {
  claim: (id: string, fullBleed: boolean) => void
  release: (id: string) => void
  fullBleed: boolean
  bottomNav?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  useIsomorphicLayoutEffect(() => {
    claim(id, fullBleed)
  }, [claim, id, fullBleed])
  useIsomorphicLayoutEffect(() => () => release(id), [release, id])
  return (
    <AuroraShellContext.Provider value={PAGE_CONTEXT}>
      <ShellBody fullBleed={fullBleed} bottomNav={bottomNav}>
        {children}
      </ShellBody>
    </AuroraShellContext.Provider>
  )
}

/**
 * Shared Aurora chrome: dark sidebar + light content area. Sidebar is desktop-only.
 * Under the persistent `AuroraFrame` (root layout) the sidebar stays mounted across route
 * changes, so `loading.tsx` skeletons render inside the same chrome instead of replacing it.
 */
export function AuroraShell({ children, fullBleed = false, bottomNav }: AuroraShellProps) {
  const ctx = useContext(AuroraShellContext)
  useAuroraShellMarker(ctx === null)
  if (ctx?.kind === 'page') return <>{children}</>
  if (ctx?.kind === 'frame') {
    return (
      <ClaimedShell claim={ctx.claim} release={ctx.release} fullBleed={fullBleed} bottomNav={bottomNav}>
        {children}
      </ClaimedShell>
    )
  }

  return (
    <AuroraShellContext.Provider value={PAGE_CONTEXT}>
      <ShellChrome fullBleed={fullBleed}>
        <ShellBody fullBleed={fullBleed} bottomNav={bottomNav}>
          {children}
        </ShellBody>
      </ShellChrome>
    </AuroraShellContext.Provider>
  )
}

/**
 * Persistent Aurora chrome for app routes (mounted once in the root layout). Non-Aurora routes
 * (auth, logistics, public pages) render untouched. Pages keep rendering `<AuroraShell>`; the
 * first one below the frame only sets the layout options.
 */
export function AuroraFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const enabled = isAuroraFrameRoute(pathname)
  const routeDefault = isFullBleedAuroraRoute(pathname)
  const [claimed, setClaimed] = useState<{ id: string; fullBleed: boolean } | null>(null)

  const claim = useCallback((id: string, fullBleed: boolean) => {
    setClaimed((prev) => (prev?.id === id && prev.fullBleed === fullBleed ? prev : { id, fullBleed }))
  }, [])
  const release = useCallback((id: string) => {
    setClaimed((prev) => (prev?.id === id ? null : prev))
  }, [])
  const value = useMemo<ShellContextValue>(() => ({ kind: 'frame', claim, release }), [claim, release])

  useAuroraShellMarker(enabled)
  if (!enabled) return <>{children}</>

  const fullBleed = claimed ? claimed.fullBleed : routeDefault
  return (
    <AuroraShellContext.Provider value={value}>
      <ShellChrome fullBleed={fullBleed}>{children}</ShellChrome>
    </AuroraShellContext.Provider>
  )
}
