/**
 * Soft Agent Layer usage / cost helpers.
 * Pricing: Grok 4.6 ≈ $2 / 1M input, $6 / 1M output (xai-2026-09).
 */

import { DEFAULT_PRICING_VERSION } from '@/lib/soft-ai/agent-types'

const INPUT_USD_PER_M = 2
const OUTPUT_USD_PER_M = 6

export function estimateCostMicros(input: {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  /** Until xAI documents a cache discount, bill cached tokens at full input rate. */
  cachedPriceUsdPerM?: number
}): number {
  const uncached = Math.max(0, input.inputTokens - input.cachedInputTokens)
  const cachedRate = input.cachedPriceUsdPerM ?? INPUT_USD_PER_M
  const usd =
    (uncached * INPUT_USD_PER_M +
      input.cachedInputTokens * cachedRate +
      input.outputTokens * OUTPUT_USD_PER_M) /
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
