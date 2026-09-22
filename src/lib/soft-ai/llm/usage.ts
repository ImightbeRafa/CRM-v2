/**
 * Soft Agent Layer usage / cost helpers.
 * Short-context rates ($2 / 1M input, $6 / 1M output) are shared by every
 * model on the allowlist. Verified 2026-09-22 on the xAI price card: the new
 * default matches the previous default at those rates (and at the long-context
 * tier, which this estimator does not apply). Cached input is still billed at
 * the full input rate. pricingVersion stays xai-2026-09.
 */

import {
  CHAT_AGENT_MODEL_ALLOWLIST,
  DEFAULT_PRICING_VERSION,
  type ChatAgentModel,
} from '@/lib/soft-ai/agent-types'

const SHARED_INPUT_USD_PER_M = 2
const SHARED_OUTPUT_USD_PER_M = 6

const MODEL_RATES: Record<ChatAgentModel, { inputUsdPerM: number; outputUsdPerM: number }> =
  Object.fromEntries(
    CHAT_AGENT_MODEL_ALLOWLIST.map((model) => [
      model,
      { inputUsdPerM: SHARED_INPUT_USD_PER_M, outputUsdPerM: SHARED_OUTPUT_USD_PER_M },
    ]),
  ) as Record<ChatAgentModel, { inputUsdPerM: number; outputUsdPerM: number }>

function ratesFor(model: string | undefined): { inputUsdPerM: number; outputUsdPerM: number } {
  if (model && Object.prototype.hasOwnProperty.call(MODEL_RATES, model)) {
    return MODEL_RATES[model as ChatAgentModel]
  }
  return { inputUsdPerM: SHARED_INPUT_USD_PER_M, outputUsdPerM: SHARED_OUTPUT_USD_PER_M }
}

export function estimateCostMicros(input: {
  model?: string
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  /** Until a pricingVersion bump applies the published cache discount, bill cached tokens at full input rate. */
  cachedPriceUsdPerM?: number
}): number {
  const rates = ratesFor(input.model)
  const uncached = Math.max(0, input.inputTokens - input.cachedInputTokens)
  const cachedRate = input.cachedPriceUsdPerM ?? rates.inputUsdPerM
  const usd =
    (uncached * rates.inputUsdPerM +
      input.cachedInputTokens * cachedRate +
      input.outputTokens * rates.outputUsdPerM) /
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
