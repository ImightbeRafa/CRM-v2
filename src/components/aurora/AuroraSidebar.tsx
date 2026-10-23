'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { staffDisplayName } from '@/lib/display-name'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ArrowUpRight } from 'lucide-react'
import { AURORA_NAV, getActiveAuroraHref } from './aurora-nav'
import { AuroraAvatar } from './shell/AuroraAvatar'
import { AuroraProfileMenu } from './shell/AuroraProfileMenu'
import { SidebarToggle } from './shell/SidebarToggle'
import { BusinessSwitcher } from './BusinessSwitcher'
import { BetsyLogo } from '@/components/brand/BetsyLogo'
import { useAuroraViewer } from './shell/useAuroraViewer'

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#8F7BFF]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-au-sidebar'

/** Collapsed-rail tooltip: CSS only (hover or keyboard focus); the link's aria-label carries the name. */
const RAIL_TIP =
  'pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[12px] font-medium text-white opacity-0 shadow-lg ring-1 ring-static-white/10 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none'

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

  return (
    <aside
      data-collapsed={collapsed ? 'true' : 'false'}
      className={`hidden h-full shrink-0 flex-col bg-au-sidebar text-white motion-safe:transition-[width] motion-safe:duration-200 md:flex ${
        collapsed ? 'w-[68px]' : 'w-[188px] lg:w-[212px]'
      }`}
    >
      {/* Brand: the official mark on the rail, the lockup when expanded (one mark per view). */}
      {collapsed ? (
        <div className="flex h-16 shrink-0 items-center justify-center">
          <Link href="/dashboard" aria-label="Betsy — Inicio" className={`rounded-lg p-1 ${FOCUS_RING}`}>
            <BetsyLogo mark size={24} />
          </Link>
        </div>
      ) : (
        <div className="mx-3 flex h-16 shrink-0 items-center gap-2 pl-1.5">
          <Link href="/dashboard" aria-label="Betsy — Inicio" className={`rounded-lg ${FOCUS_RING}`}>
            <BetsyLogo lockup size={17} />
          </Link>
          <span className="ml-auto">
            <SidebarToggle collapsed={collapsed} onToggle={toggle} />
          </span>
        </div>
      )}

      {/* Business header; a switcher when the user belongs to several businesses (Phase 2b). */}
      <BusinessSwitcher tenantName={tenantName} collapsed={collapsed} />

      {/* The rail does not scroll sideways, so its tooltips can leave the column. */}
      <nav
        className={`min-h-0 flex-1 ${collapsed ? 'overflow-visible px-2' : 'overflow-y-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'}`}
        aria-label="Navegación principal"
      >
        {AURORA_NAV.map((section, sectionIndex) => {
          const items = section.items.filter((i) => !i.adminOnly || isAdmin)
          if (items.length === 0) return null
          return (
            <div key={section.title} className={collapsed ? 'mb-3' : 'mb-5'}>
              {collapsed ? (
                sectionIndex > 0 ? <div className="mx-3 mb-3 h-px bg-static-white/10" aria-hidden /> : null
              ) : (
                <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
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
                        className={`group relative flex items-center rounded-[10px] text-[13px] font-medium transition-colors duration-150 motion-reduce:transition-none ${FOCUS_RING} ${
                          collapsed ? 'mx-auto h-10 w-10 justify-center' : 'h-9 gap-2.5 px-2.5'
                        } ${
                          active
                            ? 'bg-static-white/[0.09] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
                            : 'text-white/60 hover:bg-static-white/[0.05] hover:text-white'
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`absolute top-1/2 h-4 w-[3px] -translate-y-1/2 origin-center rounded-full bg-[#8F7BFF] transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
                            collapsed ? '-left-2' : '-left-1.5'
                          } ${active ? 'scale-y-100 opacity-100' : 'scale-y-50 opacity-0'}`}
                        />
                        <Icon
                          className={`shrink-0 transition-colors duration-150 motion-reduce:transition-none ${
                            collapsed ? 'h-[18px] w-[18px]' : 'h-4 w-4'
                          } ${active ? 'text-[#B3A6FF]' : 'text-white/45 group-hover:text-white'}`}
                          strokeWidth={active ? 2.2 : 1.9}
                          aria-hidden
                        />
                        {collapsed ? (
                          <span className={RAIL_TIP} aria-hidden>
                            {item.label}
                          </span>
                        ) : (
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        )}
                        {!collapsed && item.shortcut && (
                          <ArrowUpRight className="h-3 w-3 shrink-0 text-white/30 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                        )}
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
            <SidebarToggle collapsed={collapsed} onToggle={toggle} />
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
