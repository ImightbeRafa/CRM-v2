import 'server-only'
import { graphGet, graphGetAll } from '@/lib/meta-ads/graph'
import { mapInsightRows, normalizeCurrency, storedStatusFor, type AdGraphProblem, type AdInsightRow } from '@/lib/meta-ads/core'
import { markAdConnectionProblem, readAdConnection, readAdToken, syncAdCurrency, type AdConnection } from '@/lib/meta-ads/store'

/**
 * Ads Insights for the connected ad account: spend / impressions / clicks per ad for a date range
 * (GET /act_{id}/insights?level=ad). Dates are the ad account's own timezone (Meta's rule); the card says so when
 * it is not Costa Rica. Cached per business + ad account + range for 15 min (Meta's standard-tier limits are low);
 * a failure is cached 1 min only.
 */
export type AdSpendResult =
  | { state: 'unavailable' | 'not_connected' }
  | { state: 'pending_pick'; connection: AdConnection }
  | { state: 'problem'; problem: AdGraphProblem; connection: AdConnection }
  | { state: 'ok'; connection: AdConnection; currency: string | null; rows: AdInsightRow[]; truncated: boolean }

const OK_TTL_MS = 15 * 60_000
const ERROR_TTL_MS = 60_000
const MAX_PAGES = 10
const CACHE_MAX = 500
const cache = new Map<string, { at: number; ttl: number; value: AdSpendResult }>()

function remember(key: string, value: AdSpendResult, ttl: number) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, { at: Date.now(), ttl, value })
}

/** After a pick / exchange rate / disconnect: this business only (or everything in tests). */
export function clearAdSpendCache(tenantId?: string) {
  if (!tenantId) return cache.clear()
  for (const key of [...cache.keys()]) if (key.startsWith(`${tenantId}|`)) cache.delete(key)
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/

export async function loadAdSpend(tenantId: string, range: { startDate: string; endDate: string }): Promise<AdSpendResult> {
  const connection = await readAdConnection(tenantId)
  if (connection === 'unavailable') return { state: 'unavailable' }
  if (!connection) return { state: 'not_connected' }
  if (connection.status === 'pending_pick' || !connection.adAccountId) return { state: 'pending_pick', connection }
  if (connection.status !== 'connected') return { state: 'problem', problem: connection.status, connection }
  if (!DATE_KEY.test(range.startDate) || !DATE_KEY.test(range.endDate)) return { state: 'problem', problem: 'error', connection }

  const key = `${tenantId}|${connection.adAccountId}|${range.startDate}|${range.endDate}`
  const hit = cache.get(key)
  // Cached Meta numbers, but always today's connection row (a new exchange rate shows at once).
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value.state === 'ok' || hit.value.state === 'problem' ? { ...hit.value, connection } : hit.value

  const token = await readAdToken(tenantId)
  if (!token) return { state: 'problem', problem: 'token_invalid', connection }
  const res = await graphGetAll<Record<string, unknown>>(
    'insights',
    `act_${connection.adAccountId}/insights`,
    {
      level: 'ad',
      fields: 'ad_id,ad_name,adset_name,campaign_name,spend,impressions,clicks,account_currency',
      time_range: JSON.stringify({ since: range.startDate, until: range.endDate }),
      limit: '500',
    },
    token,
    MAX_PAGES,
  )
  if (!res.ok) {
    const stored = storedStatusFor(res.problem)
    if (stored) await markAdConnectionProblem(tenantId, stored)
    const value: AdSpendResult = { state: 'problem', problem: res.problem, connection }
    remember(key, value, ERROR_TTL_MS)
    return value
  }
  const currency = normalizeCurrency(res.rows.find((r) => r?.account_currency)?.account_currency) ?? connection.currency
  if (currency && currency !== connection.currency) await syncAdCurrency(tenantId, currency)
  const value: AdSpendResult = { state: 'ok', connection, currency, rows: mapInsightRows(res.rows), truncated: res.truncated }
  remember(key, value, OK_TTL_MS)
  return value
}

// ---------------------------------------------------------------------------
// Names for ad ids that had no spend in the range (the 7-day last touch can reach back before it)
// ---------------------------------------------------------------------------

const NAME_TTL_MS = 60 * 60_000
const names = new Map<string, { at: number; name: string | null; campaign: string | null; adset: string | null }>()
const AD_ID = /^\d{5,30}$/

export async function loadAdNames(
  tenantId: string,
  adIds: readonly string[],
): Promise<Map<string, { name: string | null; campaign: string | null; adset: string | null }>> {
  const out = new Map<string, { name: string | null; campaign: string | null; adset: string | null }>()
  const wanted = [...new Set(adIds.filter((id) => AD_ID.test(id)))].slice(0, 200)
  if (!wanted.length) return out
  const connection = await readAdConnection(tenantId)
  if (!connection || connection === 'unavailable' || connection.status !== 'connected') return out
  const missing: string[] = []
  for (const id of wanted) {
    const hit = names.get(`${tenantId}|${id}`)
    if (hit && Date.now() - hit.at < NAME_TTL_MS) out.set(id, hit)
    else missing.push(id)
  }
  if (!missing.length) return out
  const token = await readAdToken(tenantId)
  if (!token) return out
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50)
    const res = await graphGet<Record<string, { id?: string; name?: string; campaign?: { name?: string }; adset?: { name?: string } }>>(
      'ad_names',
      '',
      { ids: batch.join(','), fields: 'name,campaign{name},adset{name}' },
      token,
    )
    // Names are best effort and the ids can belong to another ad account of the business: a failure here never
    // changes the connection's state (only the Insights call does). Misses are remembered too (no retry per load).
    const nodes = res.ok ? res.data : {}
    for (const id of batch) {
      const node = nodes[id]
      if (!node) {
        names.set(`${tenantId}|${id}`, { at: Date.now(), name: null, campaign: null, adset: null })
        continue
      }
      const entry = {
        at: Date.now(),
        name: typeof node.name === 'string' ? node.name.slice(0, 200) : null,
        campaign: typeof node.campaign?.name === 'string' ? node.campaign.name.slice(0, 200) : null,
        adset: typeof node.adset?.name === 'string' ? node.adset.name.slice(0, 200) : null,
      }
      if (names.size >= 5_000) names.delete(names.keys().next().value as string)
      names.set(`${tenantId}|${id}`, entry)
      out.set(id, entry)
    }
    if (!res.ok) break
  }
  return out
}
