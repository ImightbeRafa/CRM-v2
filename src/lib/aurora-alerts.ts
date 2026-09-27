/**
 * Derived, read-only alerts for the Aurora bell. Built only from signals the app already has
 * (channel health, Meta readiness, unassigned chats, SINPE pending, orders to ship). No table,
 * no read/unread state: an alert disappears when its underlying count reaches 0.
 */
export type AuroraAlertTone = 'warn' | 'info'

export interface AuroraAlert {
  key: string
  tone: AuroraAlertTone
  title: string
  href: string
}

export interface AuroraAlertInput {
  /** Channels whose health needs action (0 while unknown). */
  channelsNeedingAction: number
  /** `tenant.readyToReceive` from /api/chat/meta-status; `null` when unknown / not allowed. */
  metaReady: boolean | null
  unassigned: { count: number; more: boolean }
  sinpePending: number
  porEnviar: number
  isAdmin: boolean
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

export function buildAuroraAlerts(input: AuroraAlertInput): AuroraAlert[] {
  const alerts: AuroraAlert[] = []
  const n = Math.max(0, Math.floor(input.channelsNeedingAction))

  if (n > 0) {
    alerts.push({
      key: 'channels',
      tone: 'warn',
      title: `${n} ${plural(n, 'línea necesita atención', 'líneas necesitan atención')}`,
      href: input.isAdmin ? '/config?tab=social' : '/chats',
    })
  }

  if (input.isAdmin && input.metaReady === false) {
    alerts.push({
      key: 'meta',
      tone: 'warn',
      title: 'Todavía no hay una línea conectada para recibir mensajes',
      href: '/config?tab=social',
    })
  }

  const chats = Math.max(0, Math.floor(input.unassigned.count))
  if (chats > 0) {
    const label = input.unassigned.more ? `${chats}+` : String(chats)
    alerts.push({
      key: 'unassigned',
      tone: 'info',
      title: `${label} ${input.unassigned.more || chats !== 1 ? 'chats sin asignar' : 'chat sin asignar'}`,
      href: '/chats',
    })
  }

  const sinpe = Math.max(0, Math.floor(input.sinpePending))
  if (sinpe > 0) {
    alerts.push({
      key: 'sinpe',
      tone: 'warn',
      title: `${sinpe} ${plural(sinpe, 'pago SINPE por confirmar', 'pagos SINPE por confirmar')}`,
      href: '/ventas',
    })
  }

  const ship = Math.max(0, Math.floor(input.porEnviar))
  if (ship > 0) {
    alerts.push({
      key: 'por-enviar',
      tone: 'info',
      title: `${ship} ${plural(ship, 'pedido por enviar', 'pedidos por enviar')}`,
      href: '/ventas',
    })
  }

  return alerts
}

/** The red dot shows only when there is something to look at. */
export function showBellDot(alerts: AuroraAlert[]): boolean {
  return alerts.length > 0
}

export const ALERTS_EMPTY_LABEL = 'Todo al día'
