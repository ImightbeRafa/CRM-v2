/**
 * Soft Agent Layer A1 — locked pilot constants + types.
 * Soft-only; never import staff bot paths.
 */

export const CHAT_AGENT_LAYER_V1_FLAG = 'chat_agent_layer_v1' as const

/** Forge Costa Rica WhatsApp pilot SocialAccount.id */
export const FORGE_WA_SOCIAL_ACCOUNT_ID = 'cmuahn5y90001l504y6kksiek' as const
export const FORGE_TENANT_ID = 'cmhsibjue0004js04gie724nx' as const

/** v1 model allowlist — reject anything else. */
export const CHAT_AGENT_MODEL_ALLOWLIST = ['grok-4.6'] as const
export type ChatAgentModel = (typeof CHAT_AGENT_MODEL_ALLOWLIST)[number]

export const DEFAULT_DAILY_TOKEN_CAP = 250_000
export const DEFAULT_PRICING_VERSION = 'xai-2026-09'
export const AGENT_INSTRUCTIONS_MAX = 1_200
export const AGENT_NAME_MAX = 40
export const INTRODUCTION_NAMES_MAX = 3
export const INTRODUCTION_NAME_MAX_LEN = 40
export const HISTORY_WINDOW_MAX = 24
export const HISTORY_WINDOW_MIN = 16
export const OUTPUT_RETENTION_DAYS = 90

export const A1_TOOL_NAMES = [
  'search_inventory',
  'get_order_status',
  'get_shipping_status',
  'escalate_to_human',
] as const
export type A1ToolName = (typeof A1_TOOL_NAMES)[number]

/** A2 adds grounded knowledge search (auto read). */
export const A2_TOOL_NAMES = ['search_approved_knowledge'] as const
export type A2ToolName = (typeof A2_TOOL_NAMES)[number]

export const AGENT_TOOL_NAMES = [...A1_TOOL_NAMES, ...A2_TOOL_NAMES] as const
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number]

export type ChatAgentTonePreset = 'warm_concise' | 'formal' | 'playful'
export type ChatAgentOperationMode = 'ai_full' | 'ai_suggest' | 'human_only'
export type ChatAgentStatus = 'draft' | 'live' | 'archived'
export type ChatAgentBindingScope = 'social_account' | 'tenant_default'

export type ChatAgentTurnMode = 'ai_full' | 'ai_suggest' | 'test'
export type ChatAgentTurnStatus =
  | 'generated'
  | 'delivered'
  | 'suggested'
  | 'test'
  | 'fallback'
  | 'budget_blocked'
  | 'window_closed'
  | 'failed'
  | 'skipped'

export type ChatAgentSkipReason =
  | 'human_replied'
  | 'superseded'
  | 'flag_off'
  | 'account_not_allowlisted'
  | 'binding_inactive'
  | 'agent_not_live'
  | 'stale_version'
  | 'paused_before_send'
  | 'human_before_send'
  | 'missing_mode'
  | 'token_unhealthy'
  | 'ai_full_not_unlocked'
  | 'no_binding'
  | 'model_not_allowed'
  | 'human_only'
  | 'schema_not_ready'
  | 'draft_agent'

export type EffectiveAgentBehavior =
  | 'skip'
  | 'suggest'
  | 'send'
  | 'human_only'

export type AiFullUnlockRecord = {
  passedAt: string
  approvedBy: string
  fixtureSetHash: string
  passRate: number
}

export type ChatAgentLayerConfig = {
  accountAllowlist: string[]
  dailyTokenCap: number
  autoActivateNewConversations: boolean
  pricingVersion: string
  aiFullUnlock: Record<string, AiFullUnlockRecord>
  /** Current Forge fixture set hash for unlock matching. */
  fixtureSetHash: string
}

export const DEFAULT_CHAT_AGENT_LAYER_CONFIG: ChatAgentLayerConfig = {
  accountAllowlist: [FORGE_WA_SOCIAL_ACCOUNT_ID],
  dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP,
  autoActivateNewConversations: true,
  pricingVersion: DEFAULT_PRICING_VERSION,
  aiFullUnlock: {},
  fixtureSetHash: 'forge-wa-v1-a1-2026-09-21',
}

export const TONE_PRESET_LABELS: Record<ChatAgentTonePreset, string> = {
  warm_concise: 'Cálido y breve',
  formal: 'Formal',
  playful: 'Juguetón',
}

export const TONE_PRESET_SNIPPETS: Record<ChatAgentTonePreset, string> = {
  warm_concise:
    'Tono cálido y breve en español de Costa Rica. Frases cortas. Tratá de vos.',
  formal:
    'Tono formal y claro en español de Costa Rica. Cortés, sin slang excesivo.',
  playful:
    'Tono juguetón y amable en español de Costa Rica, sin perder claridad ni precisión.',
}

export const DEFAULT_FORGE_VOICE =
  'Sos el agente de ventas de Forge Costa Rica por WhatsApp. Español CR, cálido y breve. Nunca inventés precios ni digas que ya creaste un pedido. Pagos y SINPE siempre a un humano.'

export function isAllowedChatAgentModel(model: string): model is ChatAgentModel {
  return (CHAT_AGENT_MODEL_ALLOWLIST as readonly string[]).includes(model)
}

export function isA1ToolName(value: string): value is A1ToolName {
  return (A1_TOOL_NAMES as readonly string[]).includes(value)
}

export function isAgentToolName(value: string): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly string[]).includes(value)
}

/**
 * Normalize presentation names for new-chat introductions.
 * Returns 1–3 unique trimmed names, or [] when intentionally cleared.
 * Throws INTRODUCTION_NAMES_INVALID on bad input.
 */
export function normalizeIntroductionNames(raw: unknown): string[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new Error('INTRODUCTION_NAMES_INVALID')
  }
  if (raw.length > INTRODUCTION_NAMES_MAX) {
    throw new Error('INTRODUCTION_NAMES_INVALID')
  }
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new Error('INTRODUCTION_NAMES_INVALID')
    }
    const name = item.trim()
    if (!name) {
      throw new Error('INTRODUCTION_NAMES_INVALID')
    }
    if (name.length > INTRODUCTION_NAME_MAX_LEN) {
      throw new Error('INTRODUCTION_NAMES_INVALID')
    }
    const key = name.toLocaleLowerCase('es')
    if (seen.has(key)) {
      throw new Error('INTRODUCTION_NAMES_INVALID')
    }
    seen.add(key)
    out.push(name)
  }
  return out
}
