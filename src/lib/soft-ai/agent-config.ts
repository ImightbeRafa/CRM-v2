/**
 * Soft Agent Layer flag config — parse / serialize chat_agent_layer_v1.
 */

import {
  CHAT_AGENT_LAYER_V1_FLAG,
  DEFAULT_CHAT_AGENT_LAYER_CONFIG,
  DEFAULT_DAILY_TOKEN_CAP,
  DEFAULT_PRICING_VERSION,
  FORGE_WA_SOCIAL_ACCOUNT_ID,
  type AiFullUnlockRecord,
  type ChatAgentLayerConfig,
} from '@/lib/soft-ai/agent-types'

export { CHAT_AGENT_LAYER_V1_FLAG }

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
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
    out[accountId] = { passedAt, approvedBy, fixtureSetHash, passRate }
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
  return {
    accountAllowlist:
      allowlistRaw.length > 0 ? allowlistRaw : [FORGE_WA_SOCIAL_ACCOUNT_ID],
    dailyTokenCap,
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
  }
}

export function chatAgentLayerConfigToJson(
  config: ChatAgentLayerConfig,
): Record<string, unknown> {
  return {
    accountAllowlist: [...config.accountAllowlist],
    dailyTokenCap: config.dailyTokenCap,
    autoActivateNewConversations: config.autoActivateNewConversations,
    pricingVersion: config.pricingVersion,
    aiFullUnlock: { ...config.aiFullUnlock },
    fixtureSetHash: config.fixtureSetHash,
  }
}

export function isAccountAllowlisted(
  config: ChatAgentLayerConfig,
  socialAccountId: string,
): boolean {
  return config.accountAllowlist.includes(socialAccountId)
}

export function hasAiFullUnlock(
  config: ChatAgentLayerConfig,
  socialAccountId: string,
): boolean {
  const unlock = config.aiFullUnlock[socialAccountId]
  if (!unlock) return false
  return unlock.fixtureSetHash === config.fixtureSetHash
}
