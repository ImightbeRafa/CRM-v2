import type { ReactNode } from 'react'
import { AuroraErrorState } from '../states'

export type CardLoad = 'loading' | 'ready' | 'error'

const CARD = 'rounded-2xl border border-slate-200/70 bg-white'

export function StatsSkeleton({ className = 'h-40' }: { className?: string }) {
  return (
    <div className={`animate-pulse space-y-3 ${className}`} aria-hidden data-testid="stats-skeleton">
      <div className="h-3 w-1/3 rounded bg-slate-100" />
      <div className="h-full min-h-[64px] rounded-xl bg-slate-100/80" />
    </div>
  )
}

/** Card with its own loading skeleton and error + Reintentar; the body decides its empty state. */
export function StatsCard({
  title,
  subtitle,
  right,
  state,
  onRetry,
  skeletonClass,
  className = '',
  children,
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  state: CardLoad
  onRetry: () => void
  skeletonClass?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`${CARD} p-4 md:p-5 ${className}`} aria-busy={state === 'loading'}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-[#0E0D17]">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[12px] text-slate-400">{subtitle}</p> : null}
        </div>
        {state === 'ready' ? right : null}
      </header>
      {state === 'loading' ? <StatsSkeleton className={skeletonClass} /> : null}
      {state === 'error' ? (
        <AuroraErrorState
          title="No pudimos cargar esta tarjeta"
          description="Revisá tu conexión e intentá de nuevo."
          onRetry={onRetry}
          className="py-8"
        />
      ) : null}
      {state === 'ready' ? children : null}
    </section>
  )
}
