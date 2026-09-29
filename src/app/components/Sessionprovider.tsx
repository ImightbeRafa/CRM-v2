'use client'
import { useEffect, useRef } from "react"
import { SessionProvider as Provider, useSession } from "next-auth/react"
import { clearBusinessScopedBrowserState } from "@/lib/business-switch-client"

type Props = {
  children: React.ReactNode
}

function tenantOf(data: unknown): string | null {
  const id = (data as { user?: { tenantId?: unknown } } | null)?.user?.tenantId
  return typeof id === "string" && id ? id : null
}

/**
 * Business switch in ANOTHER tab of this browser (they share the session cookie) must not leave
 * this tab showing business A while its requests now run as B (SecureDog M1). When the session's
 * business differs from the one this tab loaded with — via the next-auth broadcast, on focus, or on
 * a back/forward restore — business-scoped browser state is cleared and the tab reloads.
 */
function BusinessChangeWatcher() {
  const { data, status } = useSession()
  const loadedWith = useRef<string | null>(null)
  const tenantId = tenantOf(data)

  useEffect(() => {
    if (status !== "authenticated" || !tenantId) return
    if (loadedWith.current === null) {
      loadedWith.current = tenantId
      return
    }
    if (loadedWith.current !== tenantId) {
      clearBusinessScopedBrowserState()
      window.location.replace("/dashboard")
    }
  }, [status, tenantId])

  useEffect(() => {
    // A plain GET of the session (never `update()`, which is the explicit switch path).
    const check = async () => {
      if (!loadedWith.current || document.visibilityState !== "visible") return
      try {
        const res = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
        const current = tenantOf(await res.json().catch(() => null))
        if (current && current !== loadedWith.current) {
          clearBusinessScopedBrowserState()
          window.location.replace("/dashboard")
        }
      } catch {
        /* offline: next check */
      }
    }
    const onVisible = () => void check()
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) void check()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("pageshow", onShow)
    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("pageshow", onShow)
    }
  }, [])

  return null
}

export default function SessionProvider({ children }: Props) {
  return (
    <Provider refetchOnWindowFocus={false} refetchInterval={0}>
      <BusinessChangeWatcher />
      {children}
    </Provider>
  )
}
