'use client'

import Link from 'next/link'
import { staffDisplayName } from '@/lib/display-name'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ArrowUpRight } from 'lucide-react'
import { AURORA_NAV, getActiveAuroraHref } from './aurora-nav'
import { avatarInitials } from '@/lib/aurora-avatar'
import { AuroraAvatar } from './shell/AuroraAvatar'
import { AuroraProfileMenu } from './shell/AuroraProfileMenu'
import { useAuroraViewer } from './shell/useAuroraViewer'

const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-[#8F7BFF]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-au-sidebar'

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MASTER: 'Master',
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

  return (
    <aside className="hidden h-full w-[176px] shrink-0 flex-col bg-au-sidebar text-white md:flex lg:w-[200px]">
      {/* Same left inset as the tenant block below (mx-3 + 1px border + px-2.5). */}
      <div className="mx-3 flex h-16 shrink-0 items-center gap-2 px-[calc(0.625rem+1px)]">
        <Link
          href="/dashboard"
          className={`rounded-md text-[22px] font-bold leading-none tracking-tight text-[#8F7BFF] ${FOCUS_RING}`}
        >
          Betsy
        </Link>
        <span className="rounded-md bg-static-white/10 px-1.5 py-1 text-[9px] font-semibold uppercase leading-none tracking-wide text-white/70">
          CRM
        </span>
      </div>

      <div className="mx-3 mb-5 flex items-center gap-2.5 rounded-xl border border-static-white/10 bg-static-white/[0.04] px-2.5 py-2 motion-safe:transition-colors motion-safe:duration-200 hover:bg-static-white/[0.07]">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] text-[11px] font-bold">
          {avatarInitials(tenantName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">{tenantName}</span>
        </span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3" aria-label="Navegación principal">
        {AURORA_NAV.map((section) => {
          const items = section.items.filter((i) => !i.adminOnly || isAdmin)
          if (items.length === 0) return null
          return (
            <div key={section.title} className="mb-5">
              <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
                {section.title}
              </p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = !item.shortcut && item.href === activeHref
                  const Icon = item.icon
                  return (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors duration-150 motion-reduce:transition-none ${FOCUS_RING} ${
                          active
                            ? 'bg-static-white/10 text-white'
                            : 'text-white/60 hover:bg-static-white/[0.06] hover:text-white'
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 origin-center rounded-full bg-[#8F7BFF] transition-[opacity,transform] duration-200 motion-reduce:transition-none ${
                            active
                              ? 'scale-y-100 opacity-100 shadow-[0_0_10px_rgba(143,123,255,0.5)]'
                              : 'scale-y-50 opacity-0'
                          }`}
                        />
                        <Icon
                          className={`h-4 w-4 shrink-0 transition-[color,transform] duration-150 motion-reduce:transition-none motion-safe:group-hover:translate-x-0.5 ${
                            active ? 'text-[#B3A6FF]' : 'text-white/45 group-hover:text-white'
                          }`}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.shortcut && <ArrowUpRight className="h-3 w-3 shrink-0 text-white/35" aria-hidden />}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className="border-t border-static-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 motion-safe:transition-colors motion-safe:duration-200 hover:bg-static-white/[0.05]">
          <AuroraAvatar name={userName} image={image} className="h-8 w-8 text-[11px]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold leading-tight">{userName}</span>
            {roleLabel && <span className="block truncate text-[10px] leading-tight text-white/50">{roleLabel}</span>}
          </span>
          <AuroraProfileMenu />
        </div>
      </div>
    </aside>
  )
}
