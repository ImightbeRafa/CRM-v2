/**
 * Meta ad account connection (ads_read) — pure helpers, no DB / network, shared by routes, server code and tests.
 *
 * The business connects its own ad account with Facebook Login for Business asking ONLY `ads_read` (never
 * ads_management). Betsy reads spend / impressions / clicks per ad and joins them by ad id with the orders it
 * already credits to each ad (src/lib/insights/ad-sales.ts) → spend, orders, revenue, ROAS.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const ADS_READ_SCOPE = 'ads_read'

export type AdConnectionStatus = 'pending_pick' | 'connected' | 'token_invalid' | 'missing_permission'

/** Problems a Graph call can report; only token_invalid / missing_permission are stored on the row. */
export type AdGraphProblem = 'token_invalid' | 'missing_permission' | 'rate_limited' | 'not_found' | 'error'

export type AdAccountChoice = { id: string; name: string; currency: string | null; timezoneName: string | null }

const AD_ACCOUNT_ID = /^\d{1,20}$/

/** "act_123" / "123" → "123", anything else → null (never put an unchecked id in a Graph path). */
export function normalizeAdAccountId(raw: unknown): string | null {
  const s = String(raw ?? '').trim().replace(/^act_/, '')
  return AD_ACCOUNT_ID.test(s) ? s : null
}

const CURRENCY = /^[A-Z]{3}$/

export function normalizeCurrency(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase()
  return CURRENCY.test(s) ? s : null
}

/**
 * Graph error → what to show / store. 190 = token expired or revoked; 10 / 200–299 = permission missing;
 * 4 / 17 / 32 / 613 / 80000–80014 = rate limits (shown, never stored); 100 with subcode 33 = object not found.
 */
export function classifyGraphError(error: { code?: unknown; error_subcode?: unknown } | null | undefined): AdGraphProblem {
  const code = Number(error?.code)
  const sub = Number(error?.error_subcode)
  if (code === 190 || code === 102) return 'token_invalid'
  if (code === 10 || (code >= 200 && code <= 299)) return 'missing_permission'
  if (code === 4 || code === 17 || code === 32 || code === 613 || (code >= 80000 && code <= 80014)) return 'rate_limited'
  if (code === 100 && sub === 33) return 'not_found'
  return 'error'
}

/** Only these are written to the row (a rate limit or a blip must not flip the connection's state). */
export function storedStatusFor(problem: AdGraphProblem): AdConnectionStatus | null {
  return problem === 'token_invalid' || problem === 'missing_permission' ? problem : null
}

/** debug_token data → whether ads_read was granted, and the ad accounts picked in the dialog (if Meta says). */
export function readAdsGrant(data: {
  scopes?: unknown
  granular_scopes?: unknown
  user_id?: unknown
  expires_at?: unknown
  data_access_expires_at?: unknown
}): { granted: boolean; targetIds: string[] | null; metaUserId: string | null; expiresAt: Date | null } {
  const scopes = Array.isArray(data.scopes) ? data.scopes.map(String) : []
  const granular = Array.isArray(data.granular_scopes) ? (data.granular_scopes as Array<{ scope?: unknown; target_ids?: unknown }>) : []
  const ads = granular.find((g) => g?.scope === ADS_READ_SCOPE)
  const targetIds = Array.isArray(ads?.target_ids)
    ? ads!.target_ids.map((id) => normalizeAdAccountId(id)).filter((id): id is string => Boolean(id))
    : null
  const userId = String(data.user_id ?? '').trim()
  // Whichever comes first: the token's own expiry or Meta's 90-day data-access expiry (0 = never).
  const stamps = [Number(data.expires_at), Number(data.data_access_expires_at)].filter((n) => Number.isFinite(n) && n > 0)
  return {
    granted: scopes.includes(ADS_READ_SCOPE),
    targetIds: targetIds && targetIds.length ? targetIds : null,
    metaUserId: /^\d{1,30}$/.test(userId) ? userId : null,
    expiresAt: stamps.length ? new Date(Math.min(...stamps) * 1000) : null,
  }
}

const ACCOUNT_CAP = 50

/** /me/adaccounts rows → choices (only the ones picked in the dialog when Meta lists them). */
export function toAdAccountChoices(rows: unknown, targetIds: string[] | null): AdAccountChoice[] {
  const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []
  const allowed = targetIds ? new Set(targetIds) : null
  const out: AdAccountChoice[] = []
  for (const row of list) {
    const id = normalizeAdAccountId(row?.account_id ?? row?.id)
    if (!id || (allowed && !allowed.has(id)) || out.some((a) => a.id === id)) continue
    out.push({
      id,
      name: String(row?.name ?? '').trim().slice(0, 200) || `Cuenta ${id}`,
      currency: normalizeCurrency(row?.currency),
      timezoneName: typeof row?.timezone_name === 'string' ? row.timezone_name.slice(0, 64) : null,
    })
    if (out.length >= ACCOUNT_CAP) break
  }
  return out
}

export function parseStoredAccounts(raw: unknown): AdAccountChoice[] {
  const value = typeof raw === 'string' ? safeJson(raw) : raw
  return toAdAccountChoices(
    Array.isArray(value) ? value.map((a) => ({ account_id: a?.id, name: a?.name, currency: a?.currency, timezone_name: a?.timezoneName })) : [],
    null,
  )
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Insights rows
// ---------------------------------------------------------------------------

export type AdInsightRow = {
  adId: string
  adName: string | null
  adsetName: string | null
  campaignName: string | null
  spend: number
  impressions: number
  clicks: number
}

const AD_ID = /^\d{5,30}$/

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function label(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s.slice(0, 200) : null
}

/** Graph /insights?level=ad rows → typed rows (rows for the same ad summed; bad ids dropped). */
export function mapInsightRows(rows: unknown): AdInsightRow[] {
  const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []
  const byAd = new Map<string, AdInsightRow>()
  for (const r of list) {
    const adId = String(r?.ad_id ?? '').trim()
    if (!AD_ID.test(adId)) continue
    const prev = byAd.get(adId)
    byAd.set(adId, {
      adId,
      adName: prev?.adName ?? label(r?.ad_name),
      adsetName: prev?.adsetName ?? label(r?.adset_name),
      campaignName: prev?.campaignName ?? label(r?.campaign_name),
      spend: (prev?.spend ?? 0) + num(r?.spend),
      impressions: (prev?.impressions ?? 0) + Math.round(num(r?.impressions)),
      clicks: (prev?.clicks ?? 0) + Math.round(num(r?.clicks)),
    })
  }
  return [...byAd.values()]
}

// ---------------------------------------------------------------------------
// ROAS
// ---------------------------------------------------------------------------

/**
 * ROAS = revenue ÷ spend. Revenue is in the store's currency, spend in the ad account's. Same currency → direct.
 * Different currency → only with the owner's own rate (store units per 1 ad-account unit); never a guessed rate.
 */
export function computeRoas(input: {
  revenue: number
  spend: number
  storeCurrency: string | null
  adCurrency: string | null
  fxRate: number | null
}): { roas: number | null; reason: 'ok' | 'no_spend' | 'currency_mismatch' } {
  if (!(input.spend > 0)) return { roas: null, reason: 'no_spend' }
  const same = Boolean(input.storeCurrency && input.adCurrency && input.storeCurrency === input.adCurrency)
  if (same) return { roas: input.revenue / input.spend, reason: 'ok' }
  if (input.fxRate && input.fxRate > 0) return { roas: input.revenue / (input.spend * input.fxRate), reason: 'ok' }
  return { roas: null, reason: 'currency_mismatch' }
}

export function parseFxRate(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n < 100_000 ? Math.round(n * 1_000_000) / 1_000_000 : null
}

// ---------------------------------------------------------------------------
// OAuth state: bound to the business and the person who started the connection
// ---------------------------------------------------------------------------

export const ADS_STATE_COOKIE = 'meta_ads_oauth_state'
export const ADS_STATE_MAX_AGE_S = 600

function stateMac(secret: string, nonce: string, tenantId: string, userId: string): string {
  return createHmac('sha256', `meta-ads-state:${secret}`).update(`${nonce}.${tenantId}.${userId}`).digest('base64url')
}

/** Cookie value + the `state` sent to Meta (the nonce). */
export function buildAdsState(secret: string, nonce: string, tenantId: string, userId: string): { state: string; cookie: string } {
  return { state: nonce, cookie: `${nonce}.${stateMac(secret, nonce, tenantId, userId)}` }
}

/** Callback: the state Meta echoed matches the cookie, and the cookie was issued to this business + person. */
export function verifyAdsState(secret: string, stateParam: string, cookie: string, tenantId: string, userId: string): boolean {
  if (!secret || !stateParam || !cookie) return false
  const dot = cookie.indexOf('.')
  if (dot <= 0) return false
  const nonce = cookie.slice(0, dot)
  const mac = cookie.slice(dot + 1)
  const expected = stateMac(secret, nonce, tenantId, userId)
  // Byte lengths (a multi-byte state must fail, not throw).
  const eq = (a: string, b: string) => {
    const x = Buffer.from(a)
    const y = Buffer.from(b)
    return x.length === y.length && timingSafeEqual(x, y)
  }
  return eq(nonce, stateParam) && eq(mac, expected)
}

/** Days left on the token (null = unknown), for "Reconectá en N días". */
export function daysLeft(expiresAt: Date | null, now = new Date()): number | null {
  if (!expiresAt) return null
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000))
}
