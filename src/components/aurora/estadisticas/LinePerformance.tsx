import Link from 'next/link'
import { AuroraEmptyState, auroraButtonSecondary } from '../states'

export type LineRow = {
  socialAccountId: string
  platform: string
  title: string
  detail: string | null
  isActive: boolean
  chats: number
}

function PlatformDot({ platform }: { platform: string }) {
  const ig = platform.toLowerCase() === 'instagram'
  return (
    <span
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${ig ? 'bg-pink-500' : 'bg-emerald-500'}`}
      title={ig ? 'Instagram' : 'WhatsApp'}
      aria-label={ig ? 'Instagram' : 'WhatsApp'}
    />
  )
}

const DASH = '—'

/**
 * "Rendimiento por línea": one row per connected line. Chats are real; Pedidos / Conversión /
 * Ventas show "—" because orders are not linked to a chat yet.
 */
export function LinePerformanceBody({ lines }: { lines: LineRow[] | null }) {
  if (lines === null) {
    return (
      <AuroraEmptyState
        tone="neutral"
        icon="—"
        title="Sin datos"
        description="No pudimos leer las conversaciones de tus líneas."
        className="py-8"
      />
    )
  }
  if (lines.length === 0) {
    return (
      <AuroraEmptyState
        tone="neutral"
        icon="◎"
        title="Sin líneas conectadas"
        description="Conectá un WhatsApp o Instagram para ver sus chats acá."
        actions={
          <Link href="/config?tab=social" className={auroraButtonSecondary}>
            Conectar una línea
          </Link>
        }
        className="py-8"
      />
    )
  }
  const sorted = [...lines].sort((a, b) => b.chats - a.chats)
  return (
    <div data-testid="stats-lines">
      {/* md+: table */}
      <table className="hidden w-full text-[13px] md:table">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <th className="pb-3 font-semibold">Línea</th>
            <th className="pb-3 text-right font-semibold">Chats</th>
            <th className="pb-3 text-right font-semibold">Pedidos</th>
            <th className="pb-3 text-right font-semibold">Conversión</th>
            <th className="pb-3 text-right font-semibold">Ventas</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((line) => (
            <tr key={line.socialAccountId} className="border-t border-slate-100">
              <td className="py-3.5">
                <span className="flex items-center gap-2.5 font-medium text-[#0E0D17]">
                  <PlatformDot platform={line.platform} />
                  <span className="truncate">{line.title}</span>
                  {!line.isActive ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                      Inactiva
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="py-3.5 text-right tabular-nums text-slate-600">{line.chats}</td>
              <td className="py-3.5 text-right text-slate-300">{DASH}</td>
              <td className="py-3.5 text-right text-slate-300">{DASH}</td>
              <td className="py-3.5 text-right text-slate-300">{DASH}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* < md: card rows */}
      <ul className="space-y-2 md:hidden">
        {sorted.map((line) => (
          <li key={line.socialAccountId} className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
            <div className="flex items-center gap-2 text-[13px] font-medium text-[#0E0D17]">
              <PlatformDot platform={line.platform} />
              <span className="min-w-0 flex-1 truncate">{line.title}</span>
              {!line.isActive ? <span className="text-[10px] text-slate-400">Inactiva</span> : null}
            </div>
            <dl className="mt-2 grid grid-cols-4 gap-2 text-[11px]">
              {[
                ['Chats', String(line.chats)],
                ['Pedidos', DASH],
                ['Conv.', DASH],
                ['Ventas', DASH],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-slate-400">{k}</dt>
                  <dd className={`text-[13px] tabular-nums ${v === DASH ? 'text-slate-300' : 'font-semibold text-slate-700'}`}>
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate-400">
        Pedidos y ventas por línea: sin vínculo chat → pedido todavía.
      </p>
    </div>
  )
}

