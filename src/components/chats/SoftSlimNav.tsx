'use client'

import Link from 'next/link'

const NAV_ICON =
  'flex h-10 w-10 items-center justify-center rounded-xl text-base transition-colors'

export function SoftSlimNav() {
  return (
    <aside className="hidden h-full w-16 shrink-0 flex-col items-center bg-[#f4f6fa] py-5 md:flex">
      <Link
        href="/dashboard"
        className="mb-8 flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#5b6cff] text-sm font-bold text-white"
        title="Betsy"
      >
        B
      </Link>

      <nav className="flex flex-1 flex-col items-center gap-3">
        <Link href="/chats" className={`${NAV_ICON} bg-[#e8ecff] text-[#5b6cff]`} title="Chats">
          <span aria-hidden>💬</span>
        </Link>
        <Link
          href="/ventas"
          className={`${NAV_ICON} text-slate-400 hover:bg-white hover:text-slate-600`}
          title="Pedidos"
        >
          <span aria-hidden>📦</span>
        </Link>
        <Link
          href="/config"
          className={`${NAV_ICON} text-slate-400 hover:bg-white hover:text-slate-600`}
          title="Config"
        >
          <span aria-hidden>⚙️</span>
        </Link>
      </nav>

      <Link
        href="/config/social"
        className="mt-auto flex flex-col items-center gap-1 text-[#5b6cff]"
        title="Cuentas conectadas"
      >
        <span className="text-base" aria-hidden>
          🔗
        </span>
        <span className="text-[9px] font-medium text-slate-500">Cuentas</span>
      </Link>
    </aside>
  )
}
