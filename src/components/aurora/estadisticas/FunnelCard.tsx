import { barPercent, safeCount } from '@/lib/statistics-aurora'

type FunnelRow = { label: string; value: number | null; tone: string; note?: string }

/**
 * "Embudo chat → pedido". Real numbers only; "Con intención de compra" has no data source and
 * says "Sin datos". No AI-attribution percentage (no order ↔ agent link exists).
 */
export function FunnelBody({
  chatsOpened,
  aiResponded,
  ordersCreated,
}: {
  chatsOpened: number | null
  aiResponded: number | null
  ordersCreated: number
}) {
  const rows: FunnelRow[] = [
    { label: 'Chats abiertos', value: chatsOpened, tone: 'bg-[#DDD3F7]' },
    { label: 'Respondidos por IA', value: aiResponded, tone: 'bg-[#C4B2F5]' },
    { label: 'Con intención de compra', value: null, tone: 'bg-[#C4B2F5]' },
    {
      label: 'Pedidos creados',
      value: safeCount(ordersCreated),
      tone: 'bg-gradient-to-r from-[#5B6CFF] to-[#A855F7]',
      note: 'todos los canales',
    },
  ]
  const max = rows.reduce((m, r) => (r.value === null ? m : Math.max(m, r.value)), 0)
  return (
    <ul className="space-y-3.5" data-testid="stats-funnel">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-slate-600">
              {r.label}
              {r.note ? <span className="text-slate-400"> · {r.note}</span> : null}
            </span>
            {r.value === null ? (
              <span className="text-[12px] font-medium text-slate-400">Sin datos</span>
            ) : (
              <span className="font-semibold tabular-nums text-[#0E0D17]">{safeCount(r.value)}</span>
            )}
          </div>
          <div className="h-3 overflow-hidden rounded-lg bg-[#F1EFE9]">
            {r.value === null ? null : (
              <div className={`h-full rounded-lg ${r.tone}`} style={{ width: `${barPercent(r.value, max)}%` }} />
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
