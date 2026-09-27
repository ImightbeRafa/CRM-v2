'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, UserMinus, UserRound } from 'lucide-react'
import { AuroraAvatar } from '@/components/aurora/shell/AuroraAvatar'

export type ChatAssignee = { id: string; name: string; image: string | null }

type ChatAssigneePickerProps = {
  current: { id: string; name: string | null; image: string | null } | null | undefined
  assignees: ChatAssignee[]
  viewerUserId: string | null
  onAssign: (userId: string | null) => void
  busy?: boolean
  /** Compact trigger for the mobile header. */
  compact?: boolean
}

/** Chat owner chip + "Asignar" menu (Asignarme, teammates, Sin asignar). */
export function ChatAssigneePicker({
  current,
  assignees,
  viewerUserId,
  onAssign,
  busy = false,
  compact = false,
}: ChatAssigneePickerProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const choose = (userId: string | null) => {
    setOpen(false)
    buttonRef.current?.focus()
    if ((current?.id ?? null) !== userId) onAssign(userId)
  }

  const label = current?.name || (current ? 'Asignado' : 'Sin asignar')
  const item =
    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-700 transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none'

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current ? `Responsable: ${label}. Cambiar` : 'Asignar chat'}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-white text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFF] disabled:opacity-60 ${
          compact ? 'px-2 py-1' : 'px-2.5 py-1.5'
        }`}
        data-testid="chat-assignee-trigger"
      >
        {current ? (
          <AuroraAvatar name={label} image={current.image} className="h-5 w-5 text-[9px]" />
        ) : (
          <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        )}
        <span className={`max-w-[9rem] truncate ${current ? '' : 'text-slate-500'}`}>
          {current ? label : 'Asignar'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Asignar chat"
          className="absolute right-0 z-40 mt-1 max-h-80 w-60 overflow-y-auto rounded-xl bg-white p-1.5 shadow-xl ring-1 ring-slate-200"
        >
          {viewerUserId && current?.id !== viewerUserId ? (
            <button type="button" role="menuitem" onClick={() => choose(viewerUserId)} className={`${item} font-semibold text-[#5B3FE0]`}>
              <UserRound className="h-4 w-4" aria-hidden />
              Asignarme
            </button>
          ) : null}
          {assignees.length ? (
            <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Equipo</p>
          ) : (
            <p className="px-2.5 py-2 text-[12px] text-slate-500">Cargando equipo…</p>
          )}
          {assignees.map((a) => (
            <button key={a.id} type="button" role="menuitemradio" aria-checked={current?.id === a.id} onClick={() => choose(a.id)} className={item}>
              <AuroraAvatar name={a.name} image={a.image} className="h-6 w-6 text-[10px]" />
              <span className="min-w-0 flex-1 truncate">
                {a.name}
                {a.id === viewerUserId ? <span className="text-slate-400"> (vos)</span> : null}
              </span>
              {current?.id === a.id ? <Check className="h-4 w-4 text-[#5B3FE0]" aria-hidden /> : null}
            </button>
          ))}
          {current ? (
            <>
              <div className="my-1 border-t border-slate-100" />
              <button type="button" role="menuitem" onClick={() => choose(null)} className={item}>
                <UserMinus className="h-4 w-4 text-slate-400" aria-hidden />
                Sin asignar
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
