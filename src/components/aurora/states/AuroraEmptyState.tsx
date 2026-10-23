import type { ReactNode } from 'react'
import { BetsyMark } from '@/components/brand/BetsyMark'

type Tone = 'brand' | 'neutral' | 'danger'

const TONE_CLASS: Record<Tone, string> = {
  brand: 'bg-au-tint-eef0ff text-au-ink-5b6cff ring-[#5B6CFF]/15',
  neutral: 'bg-slate-100 text-slate-500 ring-slate-200/60',
  danger: 'bg-red-50 text-red-600 ring-red-100',
}

type AuroraEmptyStateProps = {
  title: string
  description?: string
  icon?: ReactNode
  /** Betsy's own empty states: the official mark (64 px) instead of the icon circle. One per view. */
  betsy?: boolean
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
  betsy = false,
  tone = 'brand',
  actions,
  className = '',
}: AuroraEmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center px-6 py-12 text-center ${className}`}
      data-testid="aurora-empty-state"
    >
      {betsy ? (
        <div className="mb-4">
          <BetsyMark size={64} decorative />
        </div>
      ) : (
        <div
          className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full text-xl ring-8 ${TONE_CLASS[tone]}`}
          aria-hidden
        >
          {icon ?? '✓'}
        </div>
      )}
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
