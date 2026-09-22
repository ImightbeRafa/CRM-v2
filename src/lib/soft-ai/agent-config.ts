/**
 * Soft Agent Layer flag config — parse / serialize chat_agent_layer_v1.
 */

import {
  CHAT_AGENT_LAYER_V1_FLAG,
  DEFAULT_CHAT_AGENT_LAYER_CONFIG,
  DEFAULT_DAILY_TOKEN_CAP,
  DEFAULT_PRICING_VERSION,
  DEFAULT_TEST_DAILY_TOKEN_CAP,
  type AiFullUnlockMismatch,
  type AiFullUnlockRecord,
  type ChatAgentLayerConfig,
} from '@/lib/soft-ai/agent-types'

export { CHAT_AGENT_LAYER_V1_FLAG }

export type AiFullUnlockContext = {
  agentId: string
  model: string
  agentVersion: number
}

export type AiFullUnlockStatus = {
  unlocked: boolean
  reason: AiFullUnlockMismatch | null
  versionWarning: boolean
  record?: AiFullUnlockRecord
}

export type RealSendStatus = 'unlocked' | 'locked' | 'stale'

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function optionalCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.floor(value)
}

function parseUnlock(raw: unknown): Record<string, AiFullUnlockRecord> {
  const src = asRecord(raw)
  const out: Record<string, AiFullUnlockRecord> = {}
  for (const [accountId, entry] of Object.entries(src)) {
    const row = asRecord(entry)
    const passedAt = typeof row.passedAt === 'string' ? row.passedAt : ''
    const approvedBy = typeof row.approvedBy === 'string' ? row.approvedBy : ''
    const fixtureSetHash =
      typeof row.fixtureSetHash === 'string' ? row.fixtureSetHash : ''
    const passRate = typeof row.passRate === 'number' ? row.passRate : NaN
    if (!passedAt || !approvedBy || !fixtureSetHash || !Number.isFinite(passRate)) {
      continue
    }
    const record: AiFullUnlockRecord = { passedAt, approvedBy, fixtureSetHash, passRate }
    const agentId = optionalText(row.agentId)
    const model = optionalText(row.model)
    const agentVersion = optionalCount(row.agentVersion)
    const canaryCount = optionalCount(row.canaryCount)
    if (agentId) record.agentId = agentId
    if (model) record.model = model
    if (agentVersion !== undefined) record.agentVersion = agentVersion
    if (canaryCount !== undefined) record.canaryCount = canaryCount
    out[accountId] = record
  }
  return out
}

export function parseChatAgentLayerConfig(raw: unknown): ChatAgentLayerConfig {
  const src = asRecord(raw)
  const allowlistRaw = Array.isArray(src.accountAllowlist)
    ? src.accountAllowlist.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [...DEFAULT_CHAT_AGENT_LAYER_CONFIG.accountAllowlist]
  const dailyTokenCap =
    typeof src.dailyTokenCap === 'number' && src.dailyTokenCap > 0
      ? Math.floor(src.dailyTokenCap)
      : DEFAULT_DAILY_TOKEN_CAP
  const testDailyTokenCap =
    typeof src.testDailyTokenCap === 'number' && src.testDailyTokenCap > 0
      ? Math.floor(src.testDailyTokenCap)
      : DEFAULT_TEST_DAILY_TOKEN_CAP
  return {
    accountAllowlist: allowlistRaw,
    dailyTokenCap,
    testDailyTokenCap,
    autoActivateNewConversations:
      typeof src.autoActivateNewConversations === 'boolean'
        ? src.autoActivateNewConversations
        : true,
    pricingVersion:
      typeof src.pricingVersion === 'string' && src.pricingVersion
        ? src.pricingVersion
        : DEFAULT_PRICING_VERSION,
    aiFullUnlock: parseUnlock(src.aiFullUnlock),
    fixtureSetHash:
      typeof src.fixtureSetHash === 'string' && src.fixtureSetHash
        ? src.fixtureSetHash
        : DEFAULT_CHAT_AGENT_LAYER_CONFIG.fixtureSetHash,
    strictUnlockVersion: src.strictUnlockVersion === true,
    unlockCanaries: src.unlockCanaries === false ? false : true,
  }
}

export function chatAgentLayerConfigToJson(
  config: ChatAgentLayerConfig,
): Record<string, unknown> {
  return {
    accountAllowlist: [...config.accountAllowlist],
    dailyTokenCap: config.dailyTokenCap,
    testDailyTokenCap: config.testDailyTokenCap,
    autoActivateNewConversations: config.autoActivateNewConversations,
    pricingVersion: config.pricingVersion,
    aiFullUnlock: { ...config.aiFullUnlock },
    fixtureSetHash: config.fixtureSetHash,
    strictUnlockVersion: config.strictUnlockVersion,
    unlockCanaries: config.unlockCanaries,
  }
}

export function isAccountAllowlisted(
  config: ChatAgentLayerConfig,
  socialAccountId: string,
): boolean {
  return config.accountAllowlist.includes(socialAccountId)
}

export function withoutAccountUnlock(
  config: ChatAgentLayerConfig,
  socialAccountId: string,
): ChatAgentLayerConfig {
  if (!config.aiFullUnlock[socialAccountId]) return config
  const aiFullUnlock = { ...config.aiFullUnlock }
  delete aiFullUnlock[socialAccountId]
  return { ...config, aiFullUnlock }
}

export function aiFullUnlockStatus(
  config: ChatAgentLayerConfig,
  socialAccountId: string,
  ctx?: AiFullUnlockContext,
): AiFullUnlockStatus {
  const record = config.aiFullUnlock[socialAccountId]
  if (!record) return { unlocked: false, reason: 'missing', versionWarning: false }
  if (record.fixtureSetHash !== config.fixtureSetHash) {
    return { unlocked: false, reason: 'hash', versionWarning: false, record }
  }
  if (ctx && record.agentId && record.agentId !== ctx.agentId) {
    return { unlocked: false, reason: 'agent', versionWarning: false, record }
  }
  if (ctx && record.model && record.model !== ctx.model) {
    return { unlocked: false, reason: 'model', versionWarning: false, record }
  }
  const versionMismatch = Boolean(
    ctx &&
      typeof record.agentVersion === 'number' &&
      record.agentVersion !== ctx.agentVersion,
  )
  if (versionMismatch && config.strictUnlockVersion) {
    return { unlocked: false, reason: 'version', versionWarning: false, record }
  }
  return {
    unlocked: true,
    reason: null,
    versionWarning: versionMismatch,
    record,
  }
}

export function hasAiFullUnlock(
  config: ChatAgentLayerConfig,
  socialAccountId: string,
  ctx?: AiFullUnlockContext,
): boolean {
  return aiFullUnlockStatus(config, socialAccountId, ctx).unlocked
}

export function channelRealSendStatus(
  config: ChatAgentLayerConfig,
  socialAccountId: string,
  binding: { agentId: string; model: string; agentVersion: number } | null,
) {
  const status = aiFullUnlockStatus(
    config,
    socialAccountId,
    binding
      ? {
          agentId: binding.agentId,
          model: binding.model,
          agentVersion: binding.agentVersion,
        }
      : undefined,
  )
  const send = realSendFromUnlockStatus(status)
  if (!binding && send.realSend === 'unlocked') {
    return { ...send, realSend: 'locked' as const, realSendVersionWarning: false }
  }
  return send
}

export function realSendFromUnlockStatus(status: AiFullUnlockStatus): {
  realSend: RealSendStatus
  realSendReason: AiFullUnlockMismatch | null
  realSendVersionWarning: boolean
  approvedVersion: number | null
} {
  let realSend: RealSendStatus = 'locked'
  if (status.unlocked) realSend = 'unlocked'
  else if (status.reason && status.reason !== 'missing') realSend = 'stale'
  return {
    realSend,
    realSendReason: status.reason,
    realSendVersionWarning: status.versionWarning,
    approvedVersion:
      typeof status.record?.agentVersion === 'number' ? status.record.agentVersion : null,
  }
}

function staleReasonCopy(reason: AiFullUnlockMismatch | null): string {
  switch (reason) {
    case 'hash':
      return 'la prueba cambió'
    case 'agent':
      return 'el agente cambió'
    case 'model':
      return 'el modelo cambió'
    case 'version':
      return 'la versión cambió'
    case 'missing':
    case null:
      return 'vencida'
    default: {
      const _exhaustive: never = reason
      return _exhaustive
    }
  }
}

/** Plain Spanish for the Canales row. */
export function formatRealSendStatus(input: {
  realSend: RealSendStatus
  realSendReason: AiFullUnlockMismatch | null
  versionWarning: boolean
  approvedVersion: number | null
}): string {
  switch (input.realSend) {
    case 'unlocked':
      if (input.versionWarning && input.approvedVersion != null) {
        return `Envío real: desbloqueado · aprobado en v${input.approvedVersion}`
      }
      return 'Envío real: desbloqueado'
    case 'locked':
      return 'Envío real: bloqueado'
    case 'stale':
      return `Envío real: aprobación vencida (${staleReasonCopy(input.realSendReason)})`
    default: {
      const _exhaustive: never = input.realSend
      return _exhaustive
    }
  }
}

export function formatUnlockConfirm(channelLabel: string, agentName: string): string {
  return `¿Aprobar envío real en ${channelLabel} con ${agentName}? El agente podrá responder en ese WhatsApp.`
}

export function formatUnlockSuccessLine(input: {
  fixtureSetHash: string
  passRate: number
  approvedByName: string
  passedAtLabel: string
}): string {
  return `Desbloqueado · hash ${input.fixtureSetHash} · passRate ${input.passRate} · por ${input.approvedByName} · ${input.passedAtLabel}`
}
