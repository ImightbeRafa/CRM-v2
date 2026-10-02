/**
 * Soft Agent Layer usage / cost helpers (estimated list price, not an invoice).
 *
 * Rate card per model, USD per 1M tokens:
 *  - Grok 4.6 / 4.7: $2 input, $6 output (xAI price card 2026-09-22). Cached input is still
 *    billed at the full input rate (no published discount applied). pricingVersion xai-2026-09.
 *  - gpt-6-luna: $0.10 input, $0.50 output, cached input $0.01 (OpenAI model page,
 *    2026-10-02). pricingVersion openai-2026-10.
 * Re-check the provider page whenever a rate changes and bump the pricingVersion.
 */

import {
  CHAT_AGENT_MODEL_ALLOWLIST,
  DEFAULT_CHAT_AGENT_MODEL,
  DEFAULT_PRICING_VERSION,
  type ChatAgentModel,
} from '@/lib/soft-ai/agent-types'

type Rates = { inputUsdPerM: number; outputUsdPerM: number; cachedInputUsdPerM: number }

const XAI_RATES: Rates = { inputUsdPerM: 2, outputUsdPerM: 6, cachedInputUsdPerM: 2 }
const LUNA_RATES: Rates = { inputUsdPerM: 0.1, outputUsdPerM: 0.5, cachedInputUsdPerM: 0.01 }

const MODEL_RATES: Record<ChatAgentModel, Rates> = Object.fromEntries(
  CHAT_AGENT_MODEL_ALLOWLIST.map((model) => [model, model.startsWith('gpt-') ? LUNA_RATES : XAI_RATES]),
) as Record<ChatAgentModel, Rates>

export function ratesFor(model: string | undefined): Rates {
  if (model && Object.prototype.hasOwnProperty.call(MODEL_RATES, model)) {
    return MODEL_RATES[model as ChatAgentModel]
  }
  // Unknown ids are rejected before any call; price them like the default so a stray row never reads as free.
  return MODEL_RATES[DEFAULT_CHAT_AGENT_MODEL]
}

export function estimateCostMicros(input: {
  model?: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  /** Optional override of the cached-input rate (tests / future rate card changes). */
  cachedPriceUsdPerM?: number
}): number {
  const rates = ratesFor(input.model)
  const cachedTokens = Math.min(Math.max(0, input.cachedInputTokens), Math.max(0, input.inputTokens))
  const uncached = Math.max(0, input.inputTokens - cachedTokens)
  const cachedRate = input.cachedPriceUsdPerM ?? rates.cachedInputUsdPerM
  const usd =
    (uncached * rates.inputUsdPerM +
      cachedTokens * cachedRate +
      Math.max(0, input.outputTokens) * rates.outputUsdPerM) /
    1_000_000
  return Math.round(usd * 1_000_000)
}

export function billedTokens(input: {
  inputTokens: number
  outputTokens: number
}): number {
  return Math.max(0, input.inputTokens) + Math.max(0, input.outputTokens)
}

export function defaultPricingVersion() {
  return DEFAULT_PRICING_VERSION
}
