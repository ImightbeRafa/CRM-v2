'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { HelpCircle, LogOut, MessageCircleQuestion, MoreHorizontal, Users } from 'lucide-react'
import { AuroraAvatar } from './AuroraAvatar'
import { useAuroraViewer } from './useAuroraViewer'
import { useDismiss } from './useDismiss'

/** Sidebar footer "…" menu: name, email, real role, Equipo y cuenta, Ayuda, Cerrar sesión. */
export function AuroraProfileMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const viewer = useAuroraViewer()
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, ref, close)

  const item =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-slate-700 transition-colors duration-150 outline-none hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#8F7BFF]/60'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menú de perfil"
        title="Menú de perfil"
        className="rounded-lg p-1.5 text-white/50 transition-colors duration-150 outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-[#8F7BFF]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E0D17]"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="aurora-light absolute bottom-full left-0 z-50 mb-2 w-[240px] rounded-xl border border-slate-200/70 bg-white p-1.5 text-slate-900 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.25)]"
        >
          <div className="flex items-center gap-2.5 border-b border-slate-100 px-2.5 pb-2 pt-1.5">
            <AuroraAvatar name={viewer.name} image={viewer.image} className="h-9 w-9 text-[12px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{viewer.name}</p>
              {viewer.email ? <p className="truncate text-[12px] text-slate-500">{viewer.email}</p> : null}
              {viewer.roleLabel ? (
                <span className="mt-1.5 inline-block rounded-md bg-[#F1EEFF] px-1.5 py-0.5 text-[10px] font-semibold text-[#5B3FE0]">
                  {viewer.roleLabel}
                </span>
              ) : null}
            </div>
          </div>
          <div className="pt-1">
            {viewer.can('manage_users') ? (
              <Link href="/config?tab=users" role="menuitem" onClick={close} className={item}>
                <Users className="h-4 w-4 text-slate-400" aria-hidden />
                Equipo y cuenta
              </Link>
            ) : null}
            <Link href="/help" role="menuitem" onClick={close} className={item}>
              <HelpCircle className="h-4 w-4 text-slate-400" aria-hidden />
              Ayuda
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close()
                window.dispatchEvent(new Event('betsy:open-feedback'))
              }}
              className={item}
            >
              <MessageCircleQuestion className="h-4 w-4 text-slate-400" aria-hidden />
              Enviar comentarios
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => signOut({ callbackUrl: '/auth/signin' })}
              className={item}
            >
              <LogOut className="h-4 w-4 text-slate-400" aria-hidden />
              Cerrar sesión
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
