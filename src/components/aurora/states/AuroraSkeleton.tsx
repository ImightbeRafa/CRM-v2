function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-full bg-slate-200/70 ${className}`} />
}

/** STATE-01 · "Cargando bandeja" — list rows. */
export function AuroraListSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div
      className="space-y-4 px-4 py-3"
      role="status"
      aria-busy="true"
      aria-label="Cargando chats"
      data-testid="aurora-list-skeleton"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-slate-200/70" />
          <div className="min-w-0 flex-1 space-y-2 pt-1">
            <Bar className={`h-2.5 ${i % 2 ? 'w-2/3' : 'w-1/2'}`} />
            <Bar className="h-2 w-full" />
            <Bar className="h-2 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** STATE-01 · "Cargando bandeja" — conversation thread. */
export function AuroraThreadSkeleton() {
  const bubbles: Array<{ side: 'l' | 'r'; w: string; h: string }> = [
    { side: 'l', w: 'w-3/5', h: 'h-14' },
    { side: 'r', w: 'w-1/2', h: 'h-10' },
    { side: 'l', w: 'w-2/5', h: 'h-10' },
    { side: 'r', w: 'w-3/5', h: 'h-16' },
    { side: 'l', w: 'w-1/3', h: 'h-9' },
  ]
  return (
    <div
      className="flex-1 space-y-4 px-5 py-5"
      role="status"
      aria-busy="true"
      aria-label="Cargando conversación"
      data-testid="aurora-thread-skeleton"
    >
      {bubbles.map((b, i) => (
        <div key={i} className={`flex ${b.side === 'r' ? 'justify-end' : 'justify-start'}`}>
          <div className={`animate-pulse rounded-2xl bg-slate-100 ${b.w} ${b.h}`} />
        </div>
      ))}
    </div>
  )
}
