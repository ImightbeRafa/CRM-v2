import { Banknote, Check, Clock, Store, Truck, Package, X } from 'lucide-react'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import type { ChannelChip, PaymentChip, ShipChip } from '@/lib/pedidos-aurora'
import type { CanalLabel } from '@/lib/order-channel-line'

const PILL = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium'

const PAYMENT_CLASS: Record<PaymentChip['tone'], string> = {
  paid: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  cod: 'bg-slate-100 text-slate-600',
  none: 'bg-slate-100 text-slate-500',
}

export function PaymentPill({ chip }: { chip: PaymentChip }) {
  const Icon = chip.tone === 'paid' ? Check : chip.tone === 'pending' ? Clock : Banknote
  return (
    <span className={`${PILL} ${PAYMENT_CLASS[chip.tone]}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {chip.label}
    </span>
  )
}

const SHIP_CLASS: Record<ShipChip['tone'], string> = {
  prep: 'bg-violet-50 text-violet-700',
  transit: 'bg-sky-50 text-sky-700',
  done: 'bg-emerald-50 text-emerald-700',
  pickup: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-50 text-red-600',
}

export function ShipPill({ chip }: { chip: ShipChip }) {
  const Icon =
    chip.tone === 'transit'
      ? Truck
      : chip.tone === 'done'
        ? Check
        : chip.tone === 'pickup'
          ? Store
          : chip.tone === 'cancelled'
            ? X
            : Package
  return (
    <span className={`${PILL} ${SHIP_CLASS[chip.tone]}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {chip.label}
    </span>
  )
}

const CHANNEL_DOT: Record<ChannelChip['family'], string> = {
  whatsapp: 'bg-[#25D366]',
  instagram: 'bg-[#E1306C]',
  facebook: 'bg-[#1877F2]',
  web: 'bg-[#5B6CFF]',
  other: 'bg-slate-400',
}

export function ChannelLabel({ chip }: { chip: ChannelChip | null }) {
  if (!chip) return <span className="text-[12px] text-slate-300">—</span>
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-slate-600">
      <span className={`h-2 w-2 rounded-full ${CHANNEL_DOT[chip.family]}`} aria-hidden />
      {chip.label}
    </span>
  )
}

/** Canal column: the specific line (name / number) with its WA / IG logo, else a labelled fallback. */
export function CanalCell({ canal }: { canal: CanalLabel }) {
  const logoFamily = canal.family === 'whatsapp' || canal.family === 'instagram' ? canal.family : null
  return (
    <span className="inline-flex max-w-[190px] items-center gap-1.5 text-[12px] text-slate-600" data-testid="pedido-canal">
      {logoFamily ? (
        <ChannelLogo platform={logoFamily} size={14} colorful />
      ) : (
        <span className={`h-2 w-2 shrink-0 rounded-full ${CHANNEL_DOT[canal.family]}`} aria-hidden />
      )}
      <span className="min-w-0">
        <span className="block truncate" title={canal.label}>
          {canal.label}
        </span>
        {canal.detail ? <span className="block truncate text-[11px] text-slate-400">{canal.detail}</span> : null}
      </span>
    </span>
  )
}
