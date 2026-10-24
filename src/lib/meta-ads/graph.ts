import 'server-only'
import { addAppSecretProofToUrl, buildMetaGraphUrl } from '@/lib/meta-api'
import { classifyGraphError, type AdGraphProblem } from '@/lib/meta-ads/core'

/**
 * Graph calls for the ads_read connection. Same Meta app as the Instagram login (Betsy CRM Inbox:
 * META_APP_ID + META_WA_APP_SECRET). Rules (SecureDog): tokens only in the Authorization header or a POST body,
 * never in a URL we build or log; appsecret_proof on user-token calls; paging rebuilt from the `after` cursor
 * (a response's `paging.next` is never fetched); 10 s timeout; no redirects; logs carry codes only.
 */
const TIMEOUT_MS = 10_000

export function adsAppIdentity(env: Record<string, string | undefined> = process.env): {
  appId: string
  appSecret: string
  configId: string
} {
  return {
    appId: (env.META_APP_ID || '').trim(),
    // The Inbox app's secret (the Instagram callback uses the same one: META_APP_SECRET is the Staff app on live).
    appSecret: (env.META_WA_APP_SECRET || '').trim(),
    // Runtime-only (no image rebuild): the Login-for-Business configuration with only ads_read.
    configId: (env.META_ADS_LOGIN_CONFIG_ID || '').trim(),
  }
}

export function adsRedirectUri(env: Record<string, string | undefined> = process.env): string {
  return `${(env.NEXTAUTH_URL || '').trim().replace(/\/+$/, '')}/api/auth/meta-ads/callback`
}

type GraphResult<T> = { ok: true; data: T } | { ok: false; problem: AdGraphProblem; code: number | null }

function logGraphError(stage: string, status: number, error: { code?: unknown; error_subcode?: unknown; fbtrace_id?: unknown } | undefined) {
  console.warn('[meta-ads] graph error', {
    stage,
    status,
    code: typeof error?.code === 'number' ? error.code : undefined,
    subcode: typeof error?.error_subcode === 'number' ? error.error_subcode : undefined,
    fbtrace: typeof error?.fbtrace_id === 'string' ? error.fbtrace_id : undefined,
  })
}

async function send<T>(stage: string, url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<GraphResult<T>> {
  let res: Response
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error', cache: 'no-store' })
  } catch (error) {
    console.warn('[meta-ads] graph unreachable', { stage, name: error instanceof Error ? error.name : 'error' })
    return { ok: false, problem: 'error', code: null }
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code?: unknown; error_subcode?: unknown; fbtrace_id?: unknown } } & T
  if (!res.ok || json?.error) {
    logGraphError(stage, res.status, json?.error)
    return { ok: false, problem: classifyGraphError(json?.error), code: typeof json?.error?.code === 'number' ? json.error.code : null }
  }
  return { ok: true, data: json as T }
}

/** GET with the user token in the header + appsecret_proof. `params` must not contain tokens. */
export async function graphGet<T>(
  stage: string,
  path: string,
  params: Record<string, string>,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GraphResult<T>> {
  const base = `${buildMetaGraphUrl(path)}?${new URLSearchParams(params)}`
  const url = addAppSecretProofToUrl(base, token, { purpose: 'whatsapp' })
  return send<T>(stage, url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }, fetchImpl)
}

/** Every page of a list edge, rebuilt from the `after` cursor; stops at `maxPages`. */
export async function graphGetAll<Row>(
  stage: string,
  path: string,
  params: Record<string, string>,
  token: string,
  maxPages: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; rows: Row[]; truncated: boolean } | { ok: false; problem: AdGraphProblem; code: number | null }> {
  const rows: Row[] = []
  let after: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const res: GraphResult<{ data?: Row[]; paging?: { cursors?: { after?: unknown }; next?: unknown } }> = await graphGet(
      stage,
      path,
      after ? { ...params, after } : params,
      token,
      fetchImpl,
    )
    if (!res.ok) return res
    rows.push(...(Array.isArray(res.data.data) ? res.data.data : []))
    const cursor: unknown = res.data.paging?.cursors?.after
    // Only continue while Meta says there is a next page; the cursor is an opaque token, length-capped.
    if (!res.data.paging?.next || typeof cursor !== 'string' || !cursor || cursor.length > 512) return { ok: true, rows, truncated: false }
    after = cursor
  }
  return { ok: true, rows, truncated: true }
}

/** POST form to an OAuth endpoint (secrets in the body, never in the URL). */
async function postForm<T>(stage: string, path: string, form: Record<string, string>, fetchImpl: typeof fetch): Promise<GraphResult<T>> {
  return send<T>(
    stage,
    buildMetaGraphUrl(path),
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() },
    fetchImpl,
  )
}

/** code → short-lived user token → long-lived user token (~60 days). */
export async function exchangeAdsCode(code: string, fetchImpl: typeof fetch = fetch): Promise<GraphResult<{ accessToken: string }>> {
  const { appId, appSecret } = adsAppIdentity()
  const short = await postForm<{ access_token?: string }>(
    'code_exchange',
    'oauth/access_token',
    { client_id: appId, client_secret: appSecret, redirect_uri: adsRedirectUri(), code },
    fetchImpl,
  )
  if (!short.ok) return short
  if (!short.data.access_token) return { ok: false, problem: 'error', code: null }
  const long = await postForm<{ access_token?: string }>(
    'long_lived',
    'oauth/access_token',
    { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: short.data.access_token },
    fetchImpl,
  )
  // A failed long-lived exchange keeps the short token (1–2 h): the card then asks to reconnect sooner.
  return { ok: true, data: { accessToken: long.ok && long.data.access_token ? long.data.access_token : short.data.access_token } }
}

/** debug_token with the app token, as a POST body (no token in any URL). */
export async function debugAdsToken(token: string, fetchImpl: typeof fetch = fetch): Promise<GraphResult<{ data?: Record<string, unknown> }>> {
  const { appId, appSecret } = adsAppIdentity()
  return postForm('debug_token', 'debug_token', { method: 'GET', input_token: token, access_token: `${appId}|${appSecret}` }, fetchImpl)
}

/**
 * Disconnect: revoke ONLY ads_read for this person. Never `DELETE /me/permissions` without a permission name:
 * that removes the whole app (the person's Instagram / WhatsApp lines too) and fires the deauthorize callback.
 */
export async function revokeAdsRead(token: string, metaUserId: string | null, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const who = metaUserId && /^\d{1,30}$/.test(metaUserId) ? metaUserId : 'me'
  const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${who}/permissions/ads_read`), token, { purpose: 'whatsapp' })
  const res = await send<{ success?: boolean }>('revoke', url, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }, fetchImpl)
  return res.ok && res.data.success !== false
}
