'use client'

import { useEffect, useRef, useState } from 'react'
import { ThemeSegmented } from './theme/ThemeChoice'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { Bell, ChevronDown, LogOut, MessageCircleQuestion, MessageSquare, MoreHorizontal, Package, Radio, X } from 'lucide-react'
import { AURORA_NAV, getActiveAuroraHref } from './aurora-nav'
import { AuroraAvatar } from './shell/AuroraAvatar'
import { AuroraAlertsList } from './shell/AuroraAlertsList'
import { useAuroraAlerts } from './shell/useAuroraAlerts'
import { useAuroraViewer } from './shell/useAuroraViewer'

type AuroraMobileNavProps = {
  /** Conversations with unread messages; badge is hidden at 0. */
  chatsBadge?: number
  /** Amber dot on Canales when any line needs repair. */
  channelsAlert?: boolean
  /** Active Config tab (only passed by ConfigShell; avoids `useSearchParams` here). */
  configTab?: string
}

const CANALES_HREF = '/config?tab=social'

const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8F7BFF]/60'

const TAB_BASE = `flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1 pt-1.5 text-[11px] font-medium transition-colors duration-150 ${FOCUS}`

/**
 * CHAT-M01 bottom nav (< md only): Chats · Pedidos · Canales · Más.
 * Más opens a sheet with the rest of the Aurora sidebar destinations.
 */
export function AuroraMobileNav({ chatsBadge = 0, channelsAlert = false, configTab }: AuroraMobileNavProps) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [moreOpen, setMoreOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const viewer = useAuroraViewer()
  const { alerts } = useAuroraAlerts()
  const user = session?.user
  const membershipRole = user?.currentTenant?.role
  const isMaster = user?.role === 'MASTER'
  const isAdmin = isMaster || membershipRole === 'OWNER' || membershipRole === 'ADMIN'
  const activeHref = getActiveAuroraHref(pathname)

  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  const moreTriggerRef = useRef<HTMLButtonElement>(null)
  const moreSheetRef = useRef<HTMLDivElement>(null)
  const wasMoreOpen = useRef(false)

  // Modal sheet: focus moves in on open, Tab stays inside, Esc closes, focus returns to "Más".
  useEffect(() => {
    if (!moreOpen) {
      if (wasMoreOpen.current) moreTriggerRef.current?.focus()
      wasMoreOpen.current = false
      return
    }
    wasMoreOpen.current = true
    const focusables = () =>
      Array.from(
        moreSheetRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [],
      )
    requestAnimationFrame(() => focusables()[0]?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreOpen(false)
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moreOpen])

  const canalesActive = pathname === '/config/social' || (pathname === '/config' && configTab === 'social')
  const primary = new Set(['/chats', '/ventas', CANALES_HREF])
  const moreActive = !canalesActive && activeHref != null && !primary.has(activeHref)
  const moreItems = AURORA_NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => !primary.has(i.href) && (!i.adminOnly || isAdmin)),
  })).filter((s) => s.items.length > 0)

  function tabClass(active: boolean) {
    return `${TAB_BASE} ${active ? 'text-au-ink-5b3fe0' : 'text-slate-500'}`
  }

  function pill(active: boolean) {
    return `relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150 ${
      active ? 'bg-au-tint-e9e5ff' : ''
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
            href={CANALES_HREF}
            aria-current={canalesActive ? 'page' : undefined}
            className={tabClass(canalesActive)}
          >
            <span className={pill(canalesActive)}>
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
          ref={moreTriggerRef}
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
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Más opciones">
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMoreOpen(false)}
          />
          <div ref={moreSheetRef} className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_32px_rgba(15,23,42,0.18)]">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-slate-900">Más</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Cerrar"
                className={`flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors duration-150 hover:bg-slate-200 ${FOCUS}`}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5" data-testid="aurora-mobile-profile">
              <AuroraAvatar name={viewer.name} image={viewer.image} className="h-10 w-10 text-[13px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-slate-900">{viewer.name}</p>
                {viewer.email ? <p className="truncate text-[12px] text-slate-500">{viewer.email}</p> : null}
                {viewer.roleLabel ? <p className="mt-0.5 truncate text-[11px] text-slate-400">{viewer.roleLabel}</p> : null}
                <p className="mt-1 truncate text-[11px] font-medium text-slate-500" data-testid="aurora-mobile-tenant">
                  {viewer.tenantName}
                </p>
              </div>
            </div>
            <div className="mb-3 px-1" data-testid="aurora-mobile-theme">
              <p className="pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Apariencia</p>
              <ThemeSegmented />
            </div>
            <div className="mb-3">
              <button
                type="button"
                onClick={() => setAlertsOpen((v) => !v)}
                aria-expanded={alertsOpen}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-3 text-[14px] font-medium text-slate-800 transition-colors duration-150 hover:bg-slate-50 ${FOCUS}`}
              >
                <span className="relative">
                  <Bell className="h-5 w-5 shrink-0" aria-hidden />
                  {alerts.length > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 text-left">Avisos</span>
                {alerts.length > 0 ? (
                  <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">{alerts.length}</span>
                ) : null}
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${alertsOpen ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {alertsOpen ? (
                <div className="mt-1 overflow-hidden rounded-xl border border-slate-100">
                  <AuroraAlertsList alerts={alerts} onNavigate={() => setMoreOpen(false)} />
                </div>
              ) : null}
            </div>
            {moreItems.map((section) => (
              <div key={section.title} className="mb-3">
                <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.title}
                </p>
                <ul>
                  {section.items.map((item) => {
                    const Icon = item.icon
                    const active = !item.shortcut && item.href === activeHref && !(item.href === '/config' && canalesActive)
                    return (
                      <li key={item.label}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={`flex items-center gap-3 rounded-lg px-2 py-3 text-[14px] font-medium transition-colors duration-150 ${FOCUS} ${
                            active ? 'bg-au-tint-f1eeff text-au-ink-5b3fe0' : 'text-slate-800 hover:bg-slate-50'
                          }`}
                        >
                          <Icon className="h-5 w-5 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false)
                window.dispatchEvent(new Event('betsy:open-feedback'))
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-3 text-[14px] font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-50 ${FOCUS}`}
            >
              <MessageCircleQuestion className="h-5 w-5 shrink-0" aria-hidden />
              Enviar comentarios
            </button>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/auth/signin' })}
              className={`flex w-full items-center gap-3 rounded-lg px-2 py-3 text-[14px] font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-50 ${FOCUS}`}
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
