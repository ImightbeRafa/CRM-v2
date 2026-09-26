import type { ReactNode } from 'react'

/** Panel title block: H1 28/600 ink, slate subtitle, optional right-aligned actions. Never truncates. */
export function ConfigPanelHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={`mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3 ${className}`}>
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="break-words text-[28px] font-semibold leading-tight tracking-tight text-[#0E0D17]">{title}</h1>
        {subtitle ? <p className="mt-1 break-words text-[14px] leading-relaxed text-slate-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
