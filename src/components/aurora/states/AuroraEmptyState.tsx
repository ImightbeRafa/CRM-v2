import type { ReactNode } from 'react'

type Tone = 'brand' | 'neutral' | 'danger'

const TONE_CLASS: Record<Tone, string> = {
  brand: 'bg-[#EEF0FF] text-[#5B6CFF] ring-[#5B6CFF]/15',
  neutral: 'bg-slate-100 text-slate-500 ring-slate-200/60',
  danger: 'bg-red-50 text-red-600 ring-red-100',
}

type AuroraEmptyStateProps = {
  title: string
  description?: string
  icon?: ReactNode
  tone?: Tone
  /** Primary / secondary actions rendered under the copy. */
  actions?: ReactNode
  className?: string
}

/** STATE-01 · "Bandeja vacía" / generic empty: minimal icon, human sentence, one clear action. */
export function AuroraEmptyState({
  title,
  description,
  icon,
  tone = 'brand',
  actions,
  className = '',
}: AuroraEmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center px-6 py-12 text-center ${className}`}
      data-testid="aurora-empty-state"
    >
      <div
        className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full text-xl ring-8 ${TONE_CLASS[tone]}`}
        aria-hidden
      >
        {icon ?? '✓'}
      </div>
      <p className="text-[15px] font-semibold text-slate-900">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-[260px] text-[12px] leading-relaxed text-slate-500">
          {description}
        </p>
      ) : null}
      {actions ? <div className="mt-4 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  )
}

const BTN_BASE =
  'inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors'

export const auroraButtonPrimary = `${BTN_BASE} bg-[#5B6CFF] text-white hover:bg-[#4A5AF0]`
export const auroraButtonSecondary = `${BTN_BASE} bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50`
