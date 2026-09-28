'use client'

import { Check } from 'lucide-react'

export type AuroraStep = {
  id: string
  title: string
  done?: boolean
  skipped?: boolean
}

type AuroraStepperProps = {
  steps: AuroraStep[]
  currentIndex: number
  /** Called for reachable steps (done or before the current one). */
  onSelect?: (index: number) => void
  className?: string
}

/**
 * Numbered circles joined by lines (CFG · Importar 192:3929 pattern).
 * Only completed / earlier steps are clickable; later steps are inert.
 */
export function AuroraStepper({ steps, currentIndex, onSelect, className = '' }: AuroraStepperProps) {
  return (
    <ol className={`flex items-center ${className}`} aria-label="Pasos">
      {steps.map((step, idx) => {
        const current = idx === currentIndex
        const done = Boolean(step.done)
        const reachable = done || idx < currentIndex
        const circle = current
          ? 'bg-gradient-to-br from-[#5B6CFF] to-[#7C5CFF] text-white'
          : done
            ? 'bg-emerald-500 text-white'
            : step.skipped
              ? 'bg-amber-100 text-amber-700'
              : 'bg-slate-100 text-slate-400'
        return (
          <li key={step.id} className="flex min-w-0 flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => reachable && onSelect?.(idx)}
              disabled={!reachable}
              aria-current={current ? 'step' : undefined}
              className={`flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-[12px] font-medium transition-colors ${
                current ? 'text-slate-900' : reachable ? 'text-slate-600 hover:text-slate-900' : 'cursor-default text-slate-400'
              }`}
            >
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${circle}`}>
                {done && !current ? <Check className="h-3.5 w-3.5" aria-hidden /> : idx + 1}
              </span>
              <span className="hidden truncate sm:inline">{step.title}</span>
            </button>
            {idx < steps.length - 1 && (
              <span aria-hidden className={`mx-1 h-0.5 min-w-3 flex-1 rounded ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
