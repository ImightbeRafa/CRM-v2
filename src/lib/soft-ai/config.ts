/**
 * Soft Tenant AI config skeleton — personality, KB, allowlist, payment gate.
 * Stored in TenantFeatureFlag.config when flag soft_tenant_ai_v1 is present;
 * DEMO uses in-memory defaults (always on).
 */

import {
  DEFAULT_SOFT_AI_CONFIG,
  SOFT_AI_ALL_TOOLS,
  type SoftAiConfig,
  type SoftAiToolName,
} from '@/lib/soft-ai/types'

export { DEFAULT_SOFT_AI_CONFIG }
export const SOFT_TENANT_AI_V1_FLAG = 'soft_tenant_ai_v1'

const PAYMENT_RE =
  /\b(sinpe|transferencia|pago|pagar|comprobante|ib[aá]n|cuenta\s*banc|deposit[oa]|efectivo\s*contra)\b/i

export function isPaymentSensitiveText(text: string): boolean {
  return PAYMENT_RE.test(text || '')
}

export function parseSoftAiConfig(raw: unknown): SoftAiConfig {
  const base = { ...DEFAULT_SOFT_AI_CONFIG, kb: [...DEFAULT_SOFT_AI_CONFIG.kb] }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const obj = raw as Record<string, unknown>

  if (typeof obj.personality === 'string' && obj.personality.trim()) {
    base.personality = obj.personality.trim()
  }

  if (Array.isArray(obj.kb)) {
    const kb = obj.kb
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim())
    if (kb.length) base.kb = kb
  }

  if (Array.isArray(obj.toolAllowlist)) {
    const allow = obj.toolAllowlist.filter((x): x is SoftAiToolName =>
      SOFT_AI_ALL_TOOLS.includes(x as SoftAiToolName),
    )
    if (allow.length) base.toolAllowlist = allow
  }

  if (typeof obj.paymentAlwaysHuman === 'boolean') {
    base.paymentAlwaysHuman = obj.paymentAlwaysHuman
  } else {
    // Skeleton hard default: money always human
    base.paymentAlwaysHuman = true
  }

  return base
}

export function softAiConfigToJson(config: SoftAiConfig): SoftAiConfig {
  return {
    personality: config.personality,
    kb: [...config.kb],
    toolAllowlist: [...config.toolAllowlist],
    paymentAlwaysHuman: config.paymentAlwaysHuman !== false,
  }
}

export function isToolAllowed(config: SoftAiConfig, tool: SoftAiToolName): boolean {
  return config.toolAllowlist.includes(tool)
}
