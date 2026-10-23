import { Banknote, CheckCircle2, CircleDashed, Clock, Store, Truck, Package, XCircle, type LucideIcon } from 'lucide-react'
import { Chip, type ChipTone } from '@/components/ui/Chip'
import { ChannelLogo } from '@/components/social/ChannelLogo'
import type { ChannelChip, PaymentChip, ShipChip } from '@/lib/pedidos-aurora'
import type { CanalLabel } from '@/lib/order-channel-line'

// Same shared Chip as the shipping-method and payment badges elsewhere.
const PAYMENT_LOOK: Record<PaymentChip['tone'], { tone: ChipTone; icon: LucideIcon }> = {
  paid: { tone: 'success', icon: CheckCircle2 },
  pending: { tone: 'warning', icon: Clock },
  cod: { tone: 'warning', icon: Banknote },
  none: { tone: 'neutral', icon: CircleDashed },
}

export function PaymentPill({ chip }: { chip: PaymentChip }) {
  const look = PAYMENT_LOOK[chip.tone]
  return (
    <Chip tone={look.tone} icon={look.icon}>
      {chip.label}
    </Chip>
  )
}

const SHIP_LOOK: Record<ShipChip['tone'], { tone: ChipTone; icon: LucideIcon }> = {
  prep: { tone: 'brand', icon: Package },
  transit: { tone: 'info', icon: Truck },
  done: { tone: 'success', icon: CheckCircle2 },
  pickup: { tone: 'neutral', icon: Store },
  cancelled: { tone: 'danger', icon: XCircle },
}

export function ShipPill({ chip }: { chip: ShipChip }) {
  const look = SHIP_LOOK[chip.tone]
  return (
    <Chip tone={look.tone} icon={look.icon}>
      {chip.label}
    </Chip>
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
