'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { ArrowUpRight, ChevronsUpDown, LogOut } from 'lucide-react'
import { AURORA_NAV, getActiveAuroraHref } from './aurora-nav'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MASTER: 'Master',
}

export function AuroraSidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const user = session?.user
  const tenantName = user?.currentTenant?.name?.trim() || 'Mi espacio'
  const membershipRole = user?.currentTenant?.role
  const isMaster = user?.role === 'MASTER'
  const isAdmin = isMaster || membershipRole === 'OWNER' || membershipRole === 'ADMIN'
  const roleKey = isMaster ? 'MASTER' : membershipRole ? String(membershipRole) : ''
  const roleLabel = ROLE_LABELS[roleKey] ?? (roleKey ? roleKey.charAt(0) + roleKey.slice(1).toLowerCase() : '')
  const userName = user?.name?.trim() || user?.email?.split('@')[0] || 'Usuario'
  const activeHref = getActiveAuroraHref(pathname)

  return (
    <aside className="hidden h-full w-[176px] shrink-0 flex-col bg-[#0E0D17] text-white md:flex lg:w-[200px]">
      <div className="flex items-center gap-2 px-4 pb-4 pt-5">
        <Link href="/dashboard" className="text-[22px] font-bold tracking-tight text-[#8F7BFF]">
          Betsy
        </Link>
        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/70">
          CRM
        </span>
      </div>

      <div className="mx-3 mb-4 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] text-[11px] font-bold">
          {initials(tenantName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">{tenantName}</span>
          {roleLabel && (
            <span className="block truncate text-[10px] leading-tight text-white/50">{roleLabel}</span>
          )}
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3" aria-label="Navegación principal">
        {AURORA_NAV.map((section) => {
          const items = section.items.filter((i) => !i.adminOnly || isAdmin)
          if (items.length === 0) return null
          return (
            <div key={section.title} className="mb-4">
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
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
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
                          active
                            ? 'bg-white/10 text-white'
                            : 'text-white/60 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden />
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

      <div className="flex items-center gap-2.5 border-t border-white/10 px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] text-[11px] font-bold">
          {initials(userName)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold leading-tight">{userName}</span>
          {roleLabel && <span className="block truncate text-[10px] leading-tight text-white/50">{roleLabel}</span>}
        </span>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/auth/signin' })}
          className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  )
}
