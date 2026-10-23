import { Check, Clock, CreditCard, Package, RotateCw, Sparkles, User, type LucideIcon } from 'lucide-react'
import s from '../landing.module.css'

/** Status chips of the inbox / orders mocks: an icon + label (no emoji as UI chrome, Rafael 2026-10-22). */
const KINDS: Record<ChipKind, { cls: string; icon: LucideIcon }> = {
  ia: { cls: s.chipIa, icon: Sparkles },
  pago: { cls: s.chipPago, icon: CreditCard },
  pedido: { cls: s.chipPedido, icon: Package },
  persona: { cls: s.chipPersona, icon: User },
  seguimiento: { cls: s.chipWait, icon: RotateCw },
  live: { cls: s.chipLive, icon: Check },
  wait: { cls: s.chipWait, icon: Clock },
}

export type ChipKind = 'ia' | 'pago' | 'pedido' | 'persona' | 'seguimiento' | 'live' | 'wait'

export function Chip({ kind, children, small = false }: { kind: ChipKind; children: React.ReactNode; small?: boolean }) {
  const k = KINDS[kind]
  const Icon = k.icon
  return (
    <span className={`${s.chip} ${k.cls} ${small ? s.chipSmall : ''}`}>
      <Icon size={small ? 9 : 11} strokeWidth={2.4} aria-hidden />
      {children}
    </span>
  )
}
