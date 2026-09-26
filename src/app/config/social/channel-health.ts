import { accountNeedsReconnect } from '@/lib/social-account-token-health'
import type { SocialAccount } from './types'

export type ChannelTab = 'all' | 'whatsapp' | 'instagram'
export type ChannelHealthTone = 'ok' | 'neutral' | 'warn' | 'bad'
export type ChannelHealthAction = 'diagnose' | 'repair' | 'reconnect'

export interface ChannelHealth {
  label: string
  tone: ChannelHealthTone
  action: ChannelHealthAction
  /** Counts toward "Saludables". */
  healthy: boolean
  /** Counts toward "Requieren acción". */
  needsAction: boolean
}

/**
 * Owner Canales only lists customer channels (WhatsApp / Instagram SocialAccount).
 * The staff / Meta assistant bot never lives here; this allow-list keeps it out
 * even if a stray row with another platform appears.
 */
export function isOwnerChannel(acc: Pick<SocialAccount, 'platform'>): boolean {
  return acc.platform === 'whatsapp' || acc.platform === 'instagram'
}

export function filterByTab(accounts: SocialAccount[], tab: ChannelTab): SocialAccount[] {
  return tab === 'all' ? accounts : accounts.filter((a) => a.platform === tab)
}

export function classifyChannelHealth(acc: SocialAccount): ChannelHealth {
  const status = (acc.tokenStatus || 'unknown').toLowerCase()
  if (acc.disconnectedAt) {
    return { label: 'Desvinculada', tone: 'bad', action: 'reconnect', healthy: false, needsAction: true }
  }
  if (!acc.isActive) {
    return { label: 'Webhook caído', tone: 'bad', action: 'repair', healthy: false, needsAction: true }
  }
  if (status === 'expired' || status === 'revoked') {
    return { label: 'Token vencido', tone: 'warn', action: 'reconnect', healthy: false, needsAction: true }
  }
  if (status === 'expiring' || accountNeedsReconnect(acc)) {
    return { label: 'Token por vencer', tone: 'warn', action: 'reconnect', healthy: false, needsAction: true }
  }
  if (status === 'error') {
    return { label: 'Error de token', tone: 'warn', action: 'reconnect', healthy: false, needsAction: true }
  }
  if (status === 'valid') {
    return { label: 'Saludable', tone: 'ok', action: 'diagnose', healthy: true, needsAction: false }
  }
  return { label: 'Conectado', tone: 'neutral', action: 'diagnose', healthy: false, needsAction: false }
}

export interface ChannelSummary {
  connected: number
  connectedWhatsApp: number
  connectedInstagram: number
  healthy: number
  needsAction: number
  webhookDown: number
  tokenIssues: number
}

export function summarizeChannels(accounts: SocialAccount[]): ChannelSummary {
  const summary: ChannelSummary = {
    connected: 0,
    connectedWhatsApp: 0,
    connectedInstagram: 0,
    healthy: 0,
    needsAction: 0,
    webhookDown: 0,
    tokenIssues: 0,
  }
  for (const acc of accounts) {
    const health = classifyChannelHealth(acc)
    if (acc.isActive && !acc.disconnectedAt) {
      summary.connected += 1
      if (acc.platform === 'whatsapp') summary.connectedWhatsApp += 1
      if (acc.platform === 'instagram') summary.connectedInstagram += 1
    }
    if (health.healthy) summary.healthy += 1
    if (health.needsAction) {
      summary.needsAction += 1
      if (health.action === 'repair') summary.webhookDown += 1
      else summary.tokenIssues += 1
    }
  }
  return summary
}

/** "hace 2 min" style label; null when there is no timestamp. */
export function formatRelativeEs(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const minutes = Math.max(0, Math.round((now - t) / 60_000))
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`
}
