import 'server-only'
import { prisma } from '@/lib/db'
import {
  addAppSecretProofToUrl,
  buildMetaGraphUrl,
  getMetaWhatsAppAppId,
  getMetaWhatsAppAppSecret,
} from '@/lib/meta-api'
import { decryptSocialAccessToken } from '@/lib/social-account-crypto'
import { isProductionContainer } from '@/lib/ops/runtime'

/**
 * Per WhatsApp line: can Betsy send sales events to this business's Meta dataset?
 * 1. debug_token: the line's token must carry `whatsapp_business_manage_events` (granted when the
 *    business connects / reconnects WhatsApp after the permission is added to Embedded Signup).
 * 2. GET /{waba}/dataset, else POST /{waba}/dataset → the dataset id (Meta returns the existing one).
 * The token is decrypted only here and in the sender, sent only as a Bearer header + appsecret_proof,
 * and never logged. Read-only for the WhatsApp line itself: messaging is not touched.
 */
export const REQUIRED_SCOPE = 'whatsapp_business_manage_events'
const GRAPH_TIMEOUT_MS = 10_000

export type DatasetStatus = 'ready' | 'missing_permission' | 'token_invalid' | 'error'

export type DatasetCheck = { socialAccountId: string; status: DatasetStatus; datasetId: string | null; errorCode: string | null }

type FetchLike = typeof fetch

async function graphJson(url: string, init: RequestInit, fetchImpl: FetchLike): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS), cache: 'no-store', redirect: 'error' })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { status: res.status, json }
}

function metaErrorCode(json: Record<string, unknown>): number | null {
  const err = json.error as { code?: unknown } | undefined
  return typeof err?.code === 'number' ? err.code : null
}

export async function checkLineDataset(
  account: { id: string; tenantId: string; wabaId: string | null; accessToken: string | null },
  opts: { fetchImpl?: FetchLike; env?: Record<string, string | undefined>; createIfMissing?: boolean } = {},
): Promise<DatasetCheck> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const env = opts.env ?? process.env
  const base = { socialAccountId: account.id }
  let token: string | null = null
  try {
    token = account.accessToken ? decryptSocialAccessToken(account.accessToken) ?? null : null
  } catch {
    return { ...base, status: 'error', datasetId: null, errorCode: 'token_unreadable' }
  }
  if (!token || !account.wabaId || !/^\d{5,30}$/.test(account.wabaId)) {
    return { ...base, status: 'error', datasetId: null, errorCode: 'line_not_ready' }
  }
  const appId = getMetaWhatsAppAppId(env)
  const appSecret = getMetaWhatsAppAppSecret(env)
  if (!appId || !appSecret) return { ...base, status: 'error', datasetId: null, errorCode: 'app_not_configured' }

  try {
    // 1) Permission on this line's token.
    const appToken = `${appId}|${appSecret}`
    const debug = await graphJson(
      addAppSecretProofToUrl(
        buildMetaGraphUrl(`debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`),
        appToken,
        { purpose: 'whatsapp' },
      ),
      { method: 'GET' },
      fetchImpl,
    )
    const data = (debug.json.data ?? {}) as { is_valid?: boolean; scopes?: unknown }
    if (data.is_valid === false) return { ...base, status: 'token_invalid', datasetId: null, errorCode: 'token_invalid' }
    const scopes = Array.isArray(data.scopes) ? data.scopes.map(String) : []
    if (!scopes.includes(REQUIRED_SCOPE)) return { ...base, status: 'missing_permission', datasetId: null, errorCode: 'scope_missing' }

    // 2) The business's dataset (existing, else create).
    const headers = { Authorization: `Bearer ${token}` }
    const datasetUrl = addAppSecretProofToUrl(buildMetaGraphUrl(`${account.wabaId}/dataset`), token, { purpose: 'whatsapp' })
    const existing = await graphJson(datasetUrl, { method: 'GET', headers }, fetchImpl)
    let datasetId = pickDatasetId(existing.json)
    if (!datasetId && opts.createIfMissing === false) {
      // Not opted in yet: never create anything in the business's Meta account.
      return { ...base, status: 'error', datasetId: null, errorCode: 'no_dataset_yet' }
    }
    if (!datasetId) {
      const created = await graphJson(datasetUrl, { method: 'POST', headers }, fetchImpl)
      const code = metaErrorCode(created.json)
      if (code === 190) return { ...base, status: 'token_invalid', datasetId: null, errorCode: '190' }
      if (code === 10 || code === 200 || code === 294) return { ...base, status: 'missing_permission', datasetId: null, errorCode: String(code) }
      datasetId = pickDatasetId(created.json)
      if (!datasetId) return { ...base, status: 'error', datasetId: null, errorCode: code ? String(code) : `http_${created.status}` }
    }
    return { ...base, status: 'ready', datasetId, errorCode: null }
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    return { ...base, status: 'error', datasetId: null, errorCode: name === 'TimeoutError' ? 'timeout' : 'network' }
  }
}

/** `{ id }` (create) or `{ data: [{ id }] }` (list). Ids are numeric strings. */
export function pickDatasetId(json: Record<string, unknown>): string | null {
  const direct = typeof json.id === 'string' ? json.id : null
  const listed = Array.isArray(json.data) ? (json.data[0] as { id?: unknown } | undefined)?.id : null
  const id = direct ?? (typeof listed === 'string' ? listed : null)
  return id && /^\d{5,30}$/.test(id) ? id : null
}

/** Problems of THIS server's configuration — never saved as the line's status. */
const LOCAL_ERRORS = new Set(['app_not_configured', 'token_unreadable'])

/**
 * Checks every active WhatsApp line of a business. Results are stored (ids and status only) only
 * by the production container: the Railway preview shares the database and may lack the Meta app
 * secret, which must never mark a production line as broken. A dataset is created in the
 * business's Meta account only once the business has opted in.
 */
export async function refreshTenantDatasets(
  tenantId: string,
  opts: { fetchImpl?: FetchLike; createIfMissing?: boolean; persist?: boolean } = {},
): Promise<DatasetCheck[]> {
  const persist = opts.persist ?? isProductionContainer()
  const accounts = await prisma.socialAccount.findMany({
    where: { tenantId, isActive: true, platform: 'whatsapp' },
    select: { id: true, tenantId: true, wabaId: true, accessToken: true },
    take: 20,
  })
  const results: DatasetCheck[] = []
  for (const account of accounts) {
    let check: DatasetCheck
    try {
      check = await checkLineDataset(account, opts)
    } catch {
      check = { socialAccountId: account.id, status: 'error', datasetId: null, errorCode: 'check_failed' }
    }
    results.push(check)
    if (!persist || (check.errorCode && LOCAL_ERRORS.has(check.errorCode)) || check.errorCode === 'no_dataset_yet') continue
    const now = new Date()
    await prisma.metaCapiDataset.upsert({
      where: { socialAccountId: account.id },
      create: {
        socialAccountId: account.id,
        tenantId,
        datasetId: check.datasetId,
        status: check.status,
        checkedAt: now,
        lastErrorCode: check.errorCode,
        lastErrorAt: check.errorCode ? now : null,
      },
      update: {
        tenantId,
        datasetId: check.datasetId,
        status: check.status,
        checkedAt: now,
        lastErrorCode: check.errorCode,
        lastErrorAt: check.errorCode ? now : undefined,
      },
    })
  }
  return results
}
