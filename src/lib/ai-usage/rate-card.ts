/**
 * Versioned AI price card for the usage meter (estimated list price, not an invoice).
 * USD per 1M tokens unless noted. Re-check the provider pages whenever a rate changes, then bump
 * AI_PRICING_VERSION so old rows keep the price they were recorded with.
 *  - xAI Grok 4.x: $2 input / $6 output; cached input billed at the input rate (xAI card 2026-09-22).
 *  - OpenAI gpt-6-luna: $0.10 input / $0.50 output / $0.01 cached input (OpenAI page 2026-10-02).
 *  - OpenAI whisper-1 (audio): $0.006 per minute.
 *  - Meta WhatsApp templates are billed by Meta per conversation; recorded with units, cost 0 here (F7 sets it).
 * Unknown models are priced like Grok so a stray row never reads as free.
 * Must not import from the staff bot or the inbox agent: both import this.
 */

export const AI_PRICING_VERSION = 'ai-2026-10'

type TokenRates = { kind: 'tokens'; inputUsdPerM: number; outputUsdPerM: number; cachedInputUsdPerM: number }
type MinuteRates = { kind: 'audio_minutes'; usdPerMinute: number }
type Rates = TokenRates | MinuteRates

const GROK: TokenRates = { kind: 'tokens', inputUsdPerM: 2, outputUsdPerM: 6, cachedInputUsdPerM: 2 }
const LUNA: TokenRates = { kind: 'tokens', inputUsdPerM: 0.1, outputUsdPerM: 0.5, cachedInputUsdPerM: 0.01 }
const WHISPER: MinuteRates = { kind: 'audio_minutes', usdPerMinute: 0.006 }

export function aiProviderFor(model: string): 'openai' | 'xai' | 'meta' {
  const m = model.toLowerCase()
  if (m.startsWith('gpt-') || m.startsWith('whisper')) return 'openai'
  if (m.startsWith('meta-')) return 'meta'
  return 'xai'
}

export function aiRatesFor(model: string): Rates {
  const m = (model || '').toLowerCase()
  if (m.startsWith('whisper') || m.includes('transcribe')) return WHISPER
  if (m.startsWith('gpt-6-luna')) return LUNA
  return GROK
}

export function estimateAiCostMicros(input: {
  model: string
  inputTokens?: number
  cachedTokens?: number
  outputTokens?: number
  audioSeconds?: number | null
}): number {
  const rates = aiRatesFor(input.model)
  if (rates.kind === 'audio_minutes') {
    const seconds = Math.max(0, input.audioSeconds ?? 0)
    return Math.round((seconds / 60) * rates.usdPerMinute * 1_000_000)
  }
  const inTok = Math.max(0, input.inputTokens ?? 0)
  const cached = Math.min(Math.max(0, input.cachedTokens ?? 0), inTok)
  const out = Math.max(0, input.outputTokens ?? 0)
  const usd =
    ((inTok - cached) * rates.inputUsdPerM + cached * rates.cachedInputUsdPerM + out * rates.outputUsdPerM) / 1_000_000
  return Math.round(usd * 1_000_000)
}

/** Whisper responses carry no duration: estimate from the audio size (WhatsApp/Telegram voice ≈ 16 kbps opus). */
export function estimateAudioSecondsFromBytes(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0
  return Math.round((bytes / 2000) * 100) / 100
}
