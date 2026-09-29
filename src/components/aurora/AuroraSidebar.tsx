'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { staffDisplayName } from '@/lib/display-name'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ArrowUpRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { AURORA_NAV, getActiveAuroraHref } from './aurora-nav'
import { AuroraAvatar } from './shell/AuroraAvatar'
import { AuroraProfileMenu } from './shell/AuroraProfileMenu'
import { BusinessSwitcher } from './BusinessSwitcher'
import { useAuroraViewer } from './shell/useAuroraViewer'

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#8F7BFF]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-au-sidebar'

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MASTER: 'Master',
}

/** Collapsed (icon rail) preference: Chats defaults to icons so the conversation gets the room. */
export const SIDEBAR_PREF_KEY = 'betsy.sidebar.collapsed.v1'
type SidebarPref = { chats?: boolean; other?: boolean }

export function sidebarScope(pathname: string | null): 'chats' | 'other' {
  return pathname === '/chats' || pathname?.startsWith('/chats/') ? 'chats' : 'other'
}
export function defaultCollapsed(scope: 'chats' | 'other'): boolean {
  return scope === 'chats'
}

function readPref(): SidebarPref {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PREF_KEY)
    const parsed = raw ? (JSON.parse(raw) as SidebarPref) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function AuroraSidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { image } = useAuroraViewer()
  const user = session?.user
  const tenantName = user?.currentTenant?.name?.trim() || 'Mi espacio'
  const membershipRole = user?.currentTenant?.role
  const isMaster = user?.role === 'MASTER'
  const isAdmin = isMaster || membershipRole === 'OWNER' || membershipRole === 'ADMIN'
  const roleKey = isMaster ? 'MASTER' : membershipRole ? String(membershipRole) : ''
  const roleLabel = ROLE_LABELS[roleKey] ?? (roleKey ? roleKey.charAt(0) + roleKey.slice(1).toLowerCase() : '')
  const userName = staffDisplayName(user?.name) || user?.email?.split('@')[0] || 'Usuario'
  const activeHref = getActiveAuroraHref(pathname)

  // Server render uses the route default (no layout jump on /chats); a saved choice wins after mount.
  const scope = sidebarScope(pathname)
  const [collapsed, setCollapsed] = useState(() => defaultCollapsed(scope))
  useEffect(() => {
    const pref = readPref()
    setCollapsed(pref[scope] ?? defaultCollapsed(scope))
  }, [scope])
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(SIDEBAR_PREF_KEY, JSON.stringify({ ...readPref(), [scope]: next }))
      } catch {
        // ignore (private mode)
      }
      return next
    })
  }, [scope])

  const ToggleIcon = collapsed ? ChevronsRight : ChevronsLeft
  const toggleButton = (
    <button
      type="button"
      onClick={toggle}
      aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}
      title={collapsed ? 'Expandir menú' : 'Contraer menú'}
      aria-expanded={!collapsed}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-static-white/10 hover:text-white ${FOCUS_RING}`}
      data-testid="sidebar-toggle"
    >
      <ToggleIcon className="h-4 w-4" aria-hidden />
    </button>
  )

  return (
    <aside
      data-collapsed={collapsed ? 'true' : 'false'}
      className={`hidden h-full shrink-0 flex-col bg-au-sidebar text-white motion-safe:transition-[width] motion-safe:duration-200 md:flex ${
        collapsed ? 'w-[68px]' : 'w-[176px] lg:w-[200px]'
      }`}
    >
      {collapsed ? (
        <div className="flex h-16 shrink-0 flex-col items-center justify-center gap-1">
          <Link
            href="/dashboard"
            aria-label="Betsy — Inicio"
            className={`rounded-md text-[20px] font-bold leading-none tracking-tight text-[#8F7BFF] ${FOCUS_RING}`}
          >
            B
          </Link>
        </div>
      ) : (
        /* Same left inset as the tenant block below (mx-3 + 1px border + px-2.5). */
        <div className="mx-3 flex h-16 shrink-0 items-center gap-2 px-[calc(0.625rem+1px)]">
          <Link
            href="/dashboard"
            className={`rounded-md text-[22px] font-bold leading-none tracking-tight text-[#8F7BFF] ${FOCUS_RING}`}
          >
            Betsy
          </Link>
          <span className="ml-auto">{toggleButton}</span>
        </div>
      )}

      {/* Business header; a switcher when the user belongs to several businesses (Phase 2b). */}
      <BusinessSwitcher tenantName={tenantName} collapsed={collapsed} />

      <nav className={`min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${collapsed ? 'px-2' : 'px-3'}`} aria-label="Navegación principal">
        {AURORA_NAV.map((section, sectionIndex) => {
          const items = section.items.filter((i) => !i.adminOnly || isAdmin)
          if (items.length === 0) return null
          return (
            <div key={section.title} className={collapsed ? 'mb-3' : 'mb-5'}>
              {collapsed ? (
                sectionIndex > 0 ? <div className="mx-3 mb-3 h-px bg-static-white/10" aria-hidden /> : null
              ) : (
                <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/55">
                  {section.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = !item.shortcut && item.href === activeHref
                  const Icon = item.icon
                  return (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        aria-label={collapsed ? item.label : undefined}
                        title={collapsed ? item.label : undefined}
                        className={`group relative flex items-center rounded-lg text-[13px] font-medium transition-colors duration-150 motion-reduce:transition-none ${FOCUS_RING} ${
                          collapsed ? 'h-10 justify-center' : 'gap-2.5 px-2.5 py-2'
                        } ${
                          active
                            ? 'bg-static-white/10 text-white'
                            : 'text-white/60 hover:bg-static-white/[0.06] hover:text-white'
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`absolute top-1/2 h-5 w-[3px] -translate-y-1/2 origin-center rounded-full bg-[#8F7BFF] transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
                            collapsed ? '-left-2' : '-left-1.5'
                          } ${
                            active
                              ? 'scale-y-100 opacity-100 shadow-[0_0_10px_rgba(143,123,255,0.5)]'
                              : 'scale-y-50 opacity-0'
                          }`}
                        />
                        <Icon
                          className={`shrink-0 transition-[color,transform] duration-150 motion-reduce:transition-none ${
                            collapsed ? 'h-[18px] w-[18px]' : 'h-4 w-4 motion-safe:group-hover:translate-x-0.5'
                          } ${active ? 'text-[#B3A6FF]' : 'text-white/45 group-hover:text-white'}`}
                          aria-hidden
                        />
                        {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                        {!collapsed && item.shortcut && <ArrowUpRight className="h-3 w-3 shrink-0 text-white/35" aria-hidden />}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className={`border-t border-static-white/10 ${collapsed ? 'flex flex-col items-center gap-2 px-2 py-3' : 'p-3'}`}>
        {collapsed ? (
          <>
            {toggleButton}
            <div title={userName}>
              <AuroraAvatar name={userName} image={image} className="h-8 w-8 text-[11px]" />
            </div>
            <AuroraProfileMenu />
          </>
        ) : (
          <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 motion-safe:transition-colors motion-safe:duration-200 hover:bg-static-white/[0.05]">
            <AuroraAvatar name={userName} image={image} className="h-8 w-8 text-[11px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold leading-tight">{userName}</span>
              {roleLabel && <span className="block truncate text-[10px] leading-tight text-white/50">{roleLabel}</span>}
            </span>
            <AuroraProfileMenu />
          </div>
        )}
      </div>
    </aside>
  )
}
