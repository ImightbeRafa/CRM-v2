/**
 * AI provider outage (2026-10-22: OpenAI 429 "no credits" 07:19–10:25 CR stranded 23 chats on "Dame un momento y te
 * confirmo 😊" with the chat still on IA). Pure rules, unit-testable: which errors are a provider outage, and what a live
 * turn does about one — retry the same customer message later (silently first), then hand the chat to a person.
 */

export type ProviderFailureKind = 'quota' | 'rate_limit' | 'auth' | 'server' | 'timeout' | 'network' | 'not_configured'

/** A provider-side failure (never a bad request / validation problem of ours). Null = not a provider outage. */
export function classifyProviderFailure(error: unknown): ProviderFailureKind | null {
  if (!error) return null
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'LLM_NOT_CONFIGURED') return 'not_configured'
  const e = error as { status?: unknown; code?: unknown; type?: unknown; error?: { code?: unknown; type?: unknown } }
  const code = String(e.code ?? e.error?.code ?? e.type ?? e.error?.type ?? '').toLowerCase()
  const status = typeof e.status === 'number' ? e.status : null
  if (code.includes('insufficient_quota') || code.includes('billing')) return 'quota'
  if (status === 429) return /quota|credit|billing/i.test(message) ? 'quota' : 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status !== null && status >= 500) return 'server'
  if (status === 408) return 'timeout'
  if (status !== null) return null
  const text = `${message} ${String((error as { name?: unknown }).name ?? '')}`
  if (/timed? ?out|abort/i.test(text)) return 'timeout'
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|fetch failed|connection/i.test(text)) return 'network'
  return null
}

/**
 * The kinds the owner is alerted about ("OpenAI sin crédito / caído"): not a single slow call, and not a plain rate limit
 * (Verifier: intermittent 429s at peak traffic would flap the alert; a 429 for missing credit is 'quota').
 */
export function alertsOwner(kind: ProviderFailureKind | null): boolean {
  return kind === 'quota' || kind === 'auth' || kind === 'server' || kind === 'not_configured'
}

/** Retry schedule for one customer message: silent at +2 min, then the safe line goes out once and retries continue. */
export const PROVIDER_RETRY_DELAYS_MIN = [2, 5, 15, 30, 60] as const
/** Never retry past this since the first failure (then a person takes the chat). */
export const PROVIDER_RETRY_MAX_MS = 2 * 60 * 60_000
/** A retry is only planned if it still lands this long before the 24 h messaging window closes. */
export const PROVIDER_RETRY_WINDOW_MARGIN_MS = 10 * 60_000

export type ProviderRetryState = { n: number; firstAt: string; ackSent: boolean; kind?: string }

export function readProviderRetryState(payload: unknown): ProviderRetryState | null {
  const raw = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).providerRetry : null
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const n = typeof r.n === 'number' && Number.isFinite(r.n) ? Math.max(0, Math.floor(r.n)) : 0
  const firstAt = typeof r.firstAt === 'string' && Number.isFinite(Date.parse(r.firstAt)) ? r.firstAt : null
  if (!firstAt) return null
  return { n, firstAt, ackSent: r.ackSent === true, kind: typeof r.kind === 'string' ? r.kind.slice(0, 40) : undefined }
}

export type ProviderRetryPlan =
  | { action: 'retry'; retryAt: Date; sendAck: boolean; state: ProviderRetryState }
  | { action: 'handoff'; sendAck: boolean; state: ProviderRetryState }

/**
 * Pure: what a live turn does after a provider failure.
 * - 1st failure: silent retry in 2 min (an outage of a minute never shows).
 * - Later failures: the safe line goes out ONCE ("Dame un momento y te confirmo 😊") and retries continue (5/15/30/60 min).
 * - After ~2 h, when the schedule is used up, when the next try would land too close to the end of the 24 h window, or
 *   when the AI is not configured at all: a person takes the chat (the safe line goes out first if it never did).
 */
export function planProviderRetry(input: {
  previous: ProviderRetryState | null
  kind: ProviderFailureKind
  now: Date
  /** When the 24 h customer-service window closes (last customer message + 24 h). */
  windowClosesAt: Date | null
  /** 0..1, spreads retries ±20 % (SecureDog INT-222: jobs that failed together do not retry in one wave). Default 0.5. */
  jitter?: number
}): ProviderRetryPlan {
  const now = input.now.getTime()
  const prev = input.previous
  const state: ProviderRetryState = {
    n: prev ? prev.n + 1 : 0,
    firstAt: prev?.firstAt ?? input.now.toISOString(),
    ackSent: prev?.ackSent === true,
    kind: input.kind,
  }
  const elapsed = now - Date.parse(state.firstAt)
  // SecureDog INT-222: a timeout / network failure may just be a slow prompt — two retries, then a person.
  const slowOnly = (input.kind === 'timeout' || input.kind === 'network') && state.n >= 2
  const delayMin = slowOnly ? undefined : PROVIDER_RETRY_DELAYS_MIN[state.n]
  const spread = 0.8 + 0.4 * Math.min(1, Math.max(0, input.jitter ?? 0.5))
  const retryAt = delayMin === undefined ? null : new Date(now + Math.round(delayMin * 60_000 * spread))
  const fitsWindow =
    retryAt !== null &&
    (input.windowClosesAt === null || retryAt.getTime() <= input.windowClosesAt.getTime() - PROVIDER_RETRY_WINDOW_MARGIN_MS)
  const canRetry = input.kind !== 'not_configured' && retryAt !== null && fitsWindow && retryAt.getTime() - Date.parse(state.firstAt) <= PROVIDER_RETRY_MAX_MS
  if (!canRetry) {
    return { action: 'handoff', sendAck: !state.ackSent, state: { ...state, ackSent: true } }
  }
  const sendAck = state.n >= 1 && !state.ackSent
  return { action: 'retry', retryAt: retryAt!, sendAck, state: { ...state, ackSent: state.ackSent || sendAck } }
}
