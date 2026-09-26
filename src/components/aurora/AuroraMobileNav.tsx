'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { LogOut, MessageSquare, MoreHorizontal, Package, Radio, X } from 'lucide-react'
import { AURORA_NAV, getActiveAuroraHref } from './aurora-nav'

type AuroraMobileNavProps = {
  /** Conversations with unread messages; badge is hidden at 0. */
  chatsBadge?: number
  /** Amber dot on Canales when any line needs repair. */
  channelsAlert?: boolean
}

const TAB_BASE = 'flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1 pt-1.5 text-[11px] font-medium'

/**
 * CHAT-M01 bottom nav (< md only): Chats · Pedidos · Canales · Más.
 * Más opens a sheet with the rest of the Aurora sidebar destinations.
 */
export function AuroraMobileNav({ chatsBadge = 0, channelsAlert = false }: AuroraMobileNavProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [moreOpen, setMoreOpen] = useState(false)
  const user = session?.user
  const membershipRole = user?.currentTenant?.role
  const isMaster = user?.role === 'MASTER'
  const isAdmin = isMaster || membershipRole === 'OWNER' || membershipRole === 'ADMIN'
  const activeHref = getActiveAuroraHref(pathname)

  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moreOpen])

  const primary = new Set(['/chats', '/ventas', '/config/social'])
  const moreActive = activeHref != null && !primary.has(activeHref)
  const moreItems = AURORA_NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => !primary.has(i.href) && (!i.adminOnly || isAdmin)),
  })).filter((s) => s.items.length > 0)

  function tabClass(active: boolean) {
    return `${TAB_BASE} ${active ? 'text-[#5B3FE0]' : 'text-slate-500'}`
  }

  function pill(active: boolean) {
    return `relative flex h-8 w-14 items-center justify-center rounded-full transition-colors ${
      active ? 'bg-[#E9E5FF]' : ''
    }`
  }

  return (
    <>
      <nav
        aria-label="Navegación móvil"
        className="flex shrink-0 items-stretch border-t border-slate-200/70 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <Link
          href="/chats"
          aria-current={activeHref === '/chats' ? 'page' : undefined}
          className={tabClass(activeHref === '/chats')}
        >
          <span className={pill(activeHref === '/chats')}>
            <MessageSquare className="h-5 w-5" aria-hidden />
            {chatsBadge > 0 ? (
              <span
                data-testid="aurora-mobile-chats-badge"
                className="absolute -top-1 right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#5B3FE0] px-1 text-[10px] font-bold text-white"
              >
                {chatsBadge > 99 ? '99+' : chatsBadge}
              </span>
            ) : null}
          </span>
          Chats
        </Link>
        <Link
          href="/ventas"
          aria-current={activeHref === '/ventas' ? 'page' : undefined}
          className={tabClass(activeHref === '/ventas')}
        >
          <span className={pill(activeHref === '/ventas')}>
            <Package className="h-5 w-5" aria-hidden />
          </span>
          Pedidos
        </Link>
        {isAdmin ? (
          <Link
            href="/config/social"
            aria-current={activeHref === '/config/social' ? 'page' : undefined}
            className={tabClass(activeHref === '/config/social')}
          >
            <span className={pill(activeHref === '/config/social')}>
              <Radio className="h-5 w-5" aria-hidden />
              {channelsAlert ? (
                <span
                  aria-label="Una línea necesita atención"
                  className="absolute right-3 top-0.5 h-2 w-2 rounded-full bg-amber-500"
                />
              ) : null}
            </span>
            Canales
          </Link>
        ) : null}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
          className={tabClass(moreActive || moreOpen)}
        >
          <span className={pill(moreActive || moreOpen)}>
            <MoreHorizontal className="h-5 w-5" aria-hidden />
          </span>
          Más
        </button>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Más opciones">
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMoreOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_rgba(15,23,42,0.18)]">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-slate-900">Más</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Cerrar"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {moreItems.map((section) => (
              <div key={section.title} className="mb-3">
                <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </p>
                <ul>
                  {section.items.map((item) => {
                    const Icon = item.icon
                    const active = item.href === activeHref
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={`flex items-center gap-3 rounded-xl px-2 py-3 text-[14px] font-medium ${
                            active ? 'bg-[#F1EEFF] text-[#5B3FE0]' : 'text-slate-800'
                          }`}
                        >
                          <Icon className="h-5 w-5 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.badge ? (
                            <span className="rounded-md border border-slate-200 px-1.5 py-px text-[10px] text-slate-500">
                              {item.badge}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/auth/signin' })}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-[14px] font-medium text-slate-600"
            >
              <LogOut className="h-5 w-5 shrink-0" aria-hidden />
              Cerrar sesión
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
