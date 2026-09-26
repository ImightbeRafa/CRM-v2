import { Eye, Package } from 'lucide-react'
import {
  channelChip,
  paymentChip,
  shipChip,
  type PedidoRow,
} from '@/lib/pedidos-aurora'
import { ChannelLabel, PaymentPill, ShipPill } from './PedidoChips'

const CR_TZ = 'America/Costa_Rica'
const AVATAR_TONES = [
  'bg-sky-50 text-sky-700',
  'bg-emerald-50 text-emerald-700',
  'bg-violet-50 text-violet-700',
  'bg-amber-50 text-amber-700',
  'bg-pink-50 text-pink-700',
]

function initials(name: string): string {
  const parts = name.trim().replace(/^@/, '').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '·'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function avatarTone(seed: string): string {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_TONES[h % AVATAR_TONES.length]
}

const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: CR_TZ })

/** "10:05" for today, "Ayer" for yesterday, otherwise "26 sep" (Costa Rica time). */
export function formatPedidoDate(timestamp: string, now: Date = new Date()): string {
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return '—'
  if (dayKey(d) === dayKey(now)) {
    return d.toLocaleTimeString('es-CR', { timeZone: CR_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  }
  if (dayKey(d) === dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return 'Ayer'
  return d.toLocaleDateString('es-CR', { timeZone: CR_TZ, day: 'numeric', month: 'short' })
}

export type PedidoTableRow = PedidoRow & { timestamp: string }

const TH = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400'

export function PedidosTable({
  rows,
  formatCurrency,
  selectedId,
  onOpen,
}: {
  rows: PedidoTableRow[]
  formatCurrency: (n: number) => string
  selectedId?: string | null
  onOpen: (orderId: string) => void
}) {
  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[860px] border-collapse text-[13px]" data-testid="pedidos-table">
        <thead className="border-y border-slate-100 bg-slate-50/60">
          <tr>
            <th className={`${TH} pl-5`}>Pedido</th>
            <th className={TH}>Cliente</th>
            <th className={TH}>Productos</th>
            <th className={TH}>Total</th>
            <th className={TH}>Pago</th>
            <th className={TH}>Envío</th>
            <th className={TH}>Canal</th>
            <th className={TH}>Fecha</th>
            <th className={`${TH} pr-5`}>
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const name = o.customerName || o.username || 'Sin nombre'
            const contact = o.phone || (o.username ? `@${o.username.replace(/^@/, '')}` : '')
            const qty = o.quantity && o.quantity > 0 ? o.quantity : 1
            return (
              <tr
                key={o.orderId}
                onClick={() => onOpen(o.orderId)}
                className={`cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/70 ${
                  selectedId === o.orderId ? 'bg-[#F6F5FF]' : ''
                }`}
              >
                <td className="whitespace-nowrap py-3 pl-5 pr-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(o.orderId)
                    }}
                    className="font-semibold text-slate-900 hover:text-[#5B6CFF]"
                  >
                    {o.orderId}
                  </button>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${avatarTone(name)}`}
                      aria-hidden
                    >
                      {initials(name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block max-w-[170px] truncate font-medium text-slate-900">{name}</span>
                      {contact ? <span className="block text-[11px] text-slate-400">{contact}</span> : null}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400" aria-hidden>
                      <Package className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block max-w-[180px] truncate text-slate-700" title={o.product}>
                        {o.product || '—'}
                      </span>
                      <span className="block text-[11px] text-slate-400">×{qty}</span>
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900">
                  {formatCurrency(Number(o.total) || 0)}
                </td>
                <td className="px-3 py-3">
                  <PaymentPill chip={paymentChip(o)} />
                </td>
                <td className="px-3 py-3">
                  <ShipPill chip={shipChip(o)} />
                </td>
                <td className="px-3 py-3">
                  <ChannelLabel chip={channelChip(o)} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-[12px] text-slate-400">
                  {formatPedidoDate(o.timestamp)}
                </td>
                <td className="py-3 pl-3 pr-5 text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpen(o.orderId)
                    }}
                    className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    aria-label={`Ver detalle de ${o.orderId}`}
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
