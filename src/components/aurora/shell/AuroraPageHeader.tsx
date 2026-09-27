import type { ReactNode } from 'react'
import { AuroraTopActions } from './AuroraTopActions'

type AuroraPageHeaderProps = {
  title: ReactNode
  subtitle?: ReactNode
  /** Page actions rendered before the bell (buttons, links). */
  actions?: ReactNode
  /** Icon / logo before the title (Ayuda). */
  leading?: ReactNode
  className?: string
}

/**
 * The one Aurora page header: title + subtitle on the left, page actions and the notifications
 * bell on the right. Used by Inicio, Pedidos, Ayuda (Estadísticas / Chats / Config keep their
 * own controls but render the same `AuroraTopActions`).
 */
export function AuroraPageHeader({ title, subtitle, actions, leading, className = '' }: AuroraPageHeaderProps) {
  return (
    <header
      data-testid="aurora-page-header"
      className={`flex shrink-0 items-start justify-between gap-3 border-b border-slate-200/70 bg-white px-4 py-4 sm:px-6 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {leading}
        <div className="min-w-0">
          <h1 className="truncate text-[20px] font-semibold leading-tight text-slate-900">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-[13px] text-slate-500">{subtitle}</p> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <AuroraTopActions />
      </div>
    </header>
  )
}
