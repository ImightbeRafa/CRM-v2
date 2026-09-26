import { sharePercent } from '@/lib/statistics-aurora'
import { AuroraEmptyState } from '../states'

export type StatusRow = { status: string; count: number; percentage?: number; color?: string }

/** "Pedidos por estado": takes the slot of the brand card in the design (there is no brand model). */
export function StatusBreakdownBody({ rows }: { rows: StatusRow[] }) {
  const clean = rows.filter((r) => Number.isFinite(r.count) && r.count > 0)
  const total = clean.reduce((a, r) => a + r.count, 0)
  if (total <= 0) {
    return (
      <AuroraEmptyState
        tone="neutral"
        icon="▤"
        title="Sin pedidos en este período"
        description="Acá vas a ver cuántos pedidos hay en cada estado."
        className="py-8"
      />
    )
  }
  const sorted = [...clean].sort((a, b) => b.count - a.count)
  return (
    <ul className="space-y-3.5" data-testid="stats-status-rows">
      {sorted.map((r) => {
        const pct = sharePercent(r.count, total)
        return (
          <li key={r.status}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2 font-medium text-[#0E0D17]">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: r.color || '#6B7280' }}
                  aria-hidden
                />
                <span className="truncate">{r.status}</span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                <span className="font-semibold text-[#0E0D17]">{r.count}</span> · {pct}%
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: r.color || '#6B7280' }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
