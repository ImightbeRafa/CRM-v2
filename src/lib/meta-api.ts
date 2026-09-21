import crypto from 'crypto'

export const DEFAULT_META_GRAPH_API_VERSION = 'v24.0'

export function getMetaGraphApiVersion(): string {
  return (process.env.META_GRAPH_API_VERSION || DEFAULT_META_GRAPH_API_VERSION).trim()
}

export function buildMetaGraphUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}/${cleanPath}`
}

/**
 * CRM WhatsApp Meta app id (dedicated Inbox WA app).
 * Falls back to META_APP_ID when unset (dev / single-app setups).
 * Production should set META_WA_APP_ID to the customer-inbox WA app.
 */
export function getMetaWhatsAppAppId(
  env: Record<string, string | undefined> = process.env,
): string {
  return (env.META_WA_APP_ID || env.META_APP_ID || '').trim()
}

/** Browser-facing WA app id for FB.login Embedded Signup. */
export function getPublicMetaWhatsAppAppId(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    env.NEXT_PUBLIC_META_WA_APP_ID ||
    env.META_WA_APP_ID ||
    env.NEXT_PUBLIC_META_APP_ID ||
    env.META_APP_ID ||
    ''
  ).trim()
}

/**
 * CRM WhatsApp Meta app secret (HMAC + appsecret_proof for WA Graph).
 * Falls back to META_APP_SECRET when unset.
 */
export function getMetaWhatsAppAppSecret(
  env: Record<string, string | undefined> = process.env,
): string {
  return (env.META_WA_APP_SECRET || env.META_APP_SECRET || '').trim()
}

export type MetaAppSecretProofPurpose = 'default' | 'whatsapp'

function resolveAppSecretForProof(
  purpose: MetaAppSecretProofPurpose,
  env: Record<string, string | undefined> = process.env,
): string {
  if (purpose === 'whatsapp') return getMetaWhatsAppAppSecret(env)
  return (env.META_APP_SECRET || '').trim()
}

/**
 * Generate appsecret_proof for Meta API calls.
 * Use purpose `'whatsapp'` for CRM WA Graph (subscribe / send / ownership).
 * Default keeps Instagram / shared META_APP_SECRET behavior.
 */
export function generateAppSecretProof(
  accessToken: string,
  options?: { purpose?: MetaAppSecretProofPurpose; appSecret?: string },
): string {
  const purpose = options?.purpose || 'default'
  const appSecret = (options?.appSecret || resolveAppSecretForProof(purpose)).trim()
  if (!appSecret) {
    console.warn(
      `[meta-api] ${purpose === 'whatsapp' ? 'META_WA_APP_SECRET/META_APP_SECRET' : 'META_APP_SECRET'} not configured, skipping appsecret_proof`,
    )
    return ''
  }

  if (!accessToken) {
    console.warn('[meta-api] No access token provided for appsecret_proof generation')
    return ''
  }

  try {
    return crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex')
  } catch (error) {
    console.error('[meta-api] Error generating appsecret_proof:', error)
    return ''
  }
}

export type MetaWebhookMatchedSecret = 'meta' | 'whatsapp' | 'instagram'

export type MetaWebhookSignatureResult = {
  valid: boolean
  matchedSecret: MetaWebhookMatchedSecret | null
  triedMeta: boolean
  triedWhatsApp: boolean
  triedInstagram: boolean
}

/**
 * Candidate app secrets for CRM inbox webhook HMAC.
 * Order: META_APP_SECRET (IG/shared), META_WA_APP_SECRET (CRM WA app),
 * then INSTAGRAM_APP_SECRET if distinct. Dedupes identical values.
 */
export function getMetaWebhookAppSecrets(
  env: Record<string, string | undefined> = process.env,
): Array<{
  name: MetaWebhookMatchedSecret
  secret: string
}> {
  const meta = (env.META_APP_SECRET || '').trim()
  const whatsapp = (env.META_WA_APP_SECRET || '').trim()
  const instagram = (env.INSTAGRAM_APP_SECRET || '').trim()
  const secrets: Array<{ name: MetaWebhookMatchedSecret; secret: string }> = []
  const seen = new Set<string>()

  const push = (name: MetaWebhookMatchedSecret, secret: string) => {
    if (!secret || seen.has(secret)) return
    seen.add(secret)
    secrets.push({ name, secret })
  }

  push('meta', meta)
  push('whatsapp', whatsapp)
  push('instagram', instagram)
  return secrets
}

/**
 * Verify X-Hub-Signature-256 against META_APP_SECRET, META_WA_APP_SECRET,
 * and/or INSTAGRAM_APP_SECRET. Never logs secret values.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  env: Record<string, string | undefined> = process.env,
): MetaWebhookSignatureResult {
  const secrets = getMetaWebhookAppSecrets(env)
  const triedMeta = secrets.some((entry) => entry.name === 'meta')
  const triedWhatsApp = secrets.some((entry) => entry.name === 'whatsapp')
  const triedInstagram = secrets.some((entry) => entry.name === 'instagram')
  const signature = (signatureHeader || '').trim()

  if (secrets.length === 0 || !signature.startsWith('sha256=')) {
    return { valid: false, matchedSecret: null, triedMeta, triedWhatsApp, triedInstagram }
  }

  const providedBuffer = Buffer.from(signature)

  for (const { name, secret } of secrets) {
    const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`
    const expectedBuffer = Buffer.from(expected)
    if (
      expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      return { valid: true, matchedSecret: name, triedMeta, triedWhatsApp, triedInstagram }
    }
  }

  return { valid: false, matchedSecret: null, triedMeta, triedWhatsApp, triedInstagram }
}

/**
 * Safe signature header diagnostics for production 401 logs.
 * Never includes the raw body, tokens, or full signature value.
 */
export function describeMetaSignatureHeader(signatureHeader: string | null): {
  signaturePresent: boolean
  signaturePrefix: 'sha256=' | 'sha1=' | 'other' | 'missing' | string
} {
  const stripped = (signatureHeader || '').trim()
  if (!stripped) {
    return { signaturePresent: false, signaturePrefix: 'missing' }
  }
  if (stripped.startsWith('sha256=')) {
    return { signaturePresent: true, signaturePrefix: 'sha256=' }
  }
  if (stripped.startsWith('sha1=')) {
    return { signaturePresent: true, signaturePrefix: 'sha1=' }
  }
  if (/^[A-Za-z0-9_+-]+=/.test(stripped)) {
    return { signaturePresent: true, signaturePrefix: 'other' }
  }
  return { signaturePresent: true, signaturePrefix: stripped.slice(0, 8) }
}

export function getMetaWebhookVerifyTokens(): string[] {
  const tokens = [
    process.env.META_WEBHOOK_VERIFY_TOKEN,
    process.env.WHATSAPP_VERIFY_TOKEN,
    process.env.INSTAGRAM_VERIFY_TOKEN,
    // Backward compatibility with the existing chat webhook env name.
    process.env.WHATSAPP_WEBHOOK_SECRET,
  ]

  return Array.from(new Set(tokens.map((token) => token?.trim()).filter(Boolean) as string[]))
}

export function maskMetaSecret(secret?: string | null): string {
  if (!secret) return 'null'
  const value = String(secret)
  if (value.length <= 6) return '*'.repeat(value.length)
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

/**
 * Add appsecret_proof to a Meta API URL if required.
 * Pass purpose `'whatsapp'` for CRM WhatsApp Graph calls (uses META_WA_APP_SECRET).
 */
export function addAppSecretProofToUrl(
  baseUrl: string,
  accessToken: string,
  options?: { purpose?: MetaAppSecretProofPurpose },
): string {
  const proof = generateAppSecretProof(accessToken, { purpose: options?.purpose || 'default' })
  if (!proof) return baseUrl

  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}appsecret_proof=${proof}`
}

/**
 * Common headers for Meta API requests
 */
export function getMetaApiHeaders(accessToken: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Betsy-CRM/1.0'
  }
}

async function readMetaJson(response: Response) {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { raw: text }
  }
}

function metaGetInit(accessToken: string, signal?: AbortSignal): RequestInit {
  return {
    headers: { Authorization: `Bearer ${accessToken}` },
    ...(signal ? { signal } : {}),
  }
}

/** Meta Graph (#100) for a missing/unsupported field on a node. */
export function isMetaNonexistingFieldError(data: unknown, fieldName?: string): boolean {
  const error =
    data && typeof data === 'object' && 'error' in data
      ? (data as { error?: { code?: number; message?: string } }).error
      : null
  if (!error) return false
  const code = typeof error.code === 'number' ? error.code : null
  const message = typeof error.message === 'string' ? error.message : ''
  const isCode100 = code === 100 || /\(#100\)/.test(message)
  if (!isCode100 || !/nonexisting field/i.test(message)) return false
  if (!fieldName) return true
  return message.toLowerCase().includes(fieldName.toLowerCase())
}

/**
 * Best-effort WABA id from a phone node.
 * Nested `whatsapp_business_account` is missing on coexistence / some Cloud API phones (#100);
 * callers must not treat that alone as ownership failure.
 */
export async function resolveWhatsAppBusinessAccountId(
  phoneNumberId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const fields = encodeURIComponent('whatsapp_business_account')
  const url = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${encodeURIComponent(phoneNumberId)}?fields=${fields}`),
    accessToken,
    { purpose: 'whatsapp' },
  )

  try {
    const response = await fetch(url, metaGetInit(accessToken, signal))
    const data = await readMetaJson(response)

    if (!response.ok) {
      if (isMetaNonexistingFieldError(data, 'whatsapp_business_account')) {
        console.warn('[meta-api] Phone node has no whatsapp_business_account field (coexistence-safe)', {
          phoneNumberId,
        })
        return null
      }
      console.warn('[meta-api] Could not resolve WhatsApp Business Account ID', {
        phoneNumberId,
        status: response.status,
        error: data?.error?.message || data?.raw,
      })
      return null
    }

    return data?.whatsapp_business_account?.id ? String(data.whatsapp_business_account.id) : null
  } catch (error) {
    console.warn('[meta-api] WhatsApp Business Account lookup failed', error)
    return null
  }
}

export type WhatsAppWabaPhoneNumber = {
  id: string
  displayPhoneNumber: string | null
  isOnBizApp: boolean | null
  platformType: string | null
}

const WABA_PHONE_LIST_MAX_PAGES = 5

function mapWabaPhoneRow(row: any): WhatsAppWabaPhoneNumber {
  return {
    id: String(row.id),
    displayPhoneNumber: row.display_phone_number ? String(row.display_phone_number) : null,
    isOnBizApp: typeof row.is_on_biz_app === 'boolean' ? row.is_on_biz_app : null,
    platformType: row.platform_type ? String(row.platform_type) : null,
  }
}

/**
 * List phone numbers on a WABA (used when coexistence FINISH returns waba_id only).
 * Follows Graph paging with a hard page cap to avoid malformed cursor loops.
 */
export async function listWhatsAppPhoneNumbersForWaba(params: {
  wabaId: string
  accessToken: string
  signal?: AbortSignal
}): Promise<{ ok: boolean; phones: WhatsAppWabaPhoneNumber[]; reason?: string }> {
  const wabaId = String(params.wabaId || '').trim()
  if (!wabaId || !params.accessToken) {
    return { ok: false, phones: [], reason: 'missing_waba_or_token' }
  }

  const fields = encodeURIComponent('id,display_phone_number,is_on_biz_app,platform_type')
  let nextUrl: string | null = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${encodeURIComponent(wabaId)}/phone_numbers?fields=${fields}&limit=100`),
    params.accessToken,
    { purpose: 'whatsapp' },
  )

  const phones: WhatsAppWabaPhoneNumber[] = []

  try {
    for (let page = 0; page < WABA_PHONE_LIST_MAX_PAGES && nextUrl; page += 1) {
      const response = await fetch(nextUrl, metaGetInit(params.accessToken, params.signal))
      const data = await readMetaJson(response)
      if (!response.ok) {
        return {
          ok: false,
          phones,
          reason: data?.error?.message || `graph_${response.status}`,
        }
      }

      for (const row of data?.data || []) {
        phones.push(mapWabaPhoneRow(row))
      }

      const pagingNext =
        data?.paging?.next && typeof data.paging.next === 'string' ? String(data.paging.next) : null
      nextUrl = pagingNext
        ? addAppSecretProofToUrl(pagingNext, params.accessToken, { purpose: 'whatsapp' })
        : null
    }

    return { ok: true, phones }
  } catch (error) {
    console.warn('[meta-api] WABA phone_numbers listing failed', error)
    return { ok: false, phones: [], reason: 'list_exception' }
  }
}

/**
 * Pick the coexistence phone on a WABA: prefer is_on_biz_app + CLOUD_API,
 * else a single unambiguous phone.
 */
export function selectCoexistencePhoneNumber(
  phones: WhatsAppWabaPhoneNumber[],
): { ok: true; phone: WhatsAppWabaPhoneNumber } | { ok: false; reason: string } {
  if (!phones.length) return { ok: false, reason: 'no_phones_on_waba' }

  const coexistenceMatches = phones.filter(
    (p) => p.isOnBizApp === true && (p.platformType === 'CLOUD_API' || !p.platformType),
  )
  if (coexistenceMatches.length === 1) {
    return { ok: true, phone: coexistenceMatches[0]! }
  }
  if (coexistenceMatches.length > 1) {
    return { ok: false, reason: 'ambiguous_coexistence_phones' }
  }

  const onBizApp = phones.filter((p) => p.isOnBizApp === true)
  if (onBizApp.length === 1) return { ok: true, phone: onBizApp[0]! }
  if (onBizApp.length > 1) return { ok: false, reason: 'ambiguous_biz_app_phones' }

  if (phones.length === 1) return { ok: true, phone: phones[0]! }
  return { ok: false, reason: 'ambiguous_phones_on_waba' }
}

export async function resolvePhoneNumberIdFromWaba(params: {
  wabaId: string
  accessToken: string
  signal?: AbortSignal
}): Promise<{
  ok: boolean
  phoneNumberId: string | null
  whatsappBusinessAccountId: string | null
  coexistence?: boolean
  reason?: string
  phones?: WhatsAppWabaPhoneNumber[]
}> {
  const listed = await listWhatsAppPhoneNumbersForWaba(params)
  if (!listed.ok) {
    return {
      ok: false,
      phoneNumberId: null,
      whatsappBusinessAccountId: params.wabaId,
      reason: listed.reason || 'waba_phone_list_failed',
      phones: listed.phones,
    }
  }

  const selected = selectCoexistencePhoneNumber(listed.phones)
  if (!selected.ok) {
    return {
      ok: false,
      phoneNumberId: null,
      whatsappBusinessAccountId: params.wabaId,
      reason: selected.reason,
      phones: listed.phones,
    }
  }

  return {
    ok: true,
    phoneNumberId: selected.phone.id,
    whatsappBusinessAccountId: params.wabaId,
    coexistence: selected.phone.isOnBizApp === true,
    phones: listed.phones,
  }
}

/** Optional check that a phone is registered for Cloud API + WA Business app. */
export async function verifyWhatsAppCoexistenceStatus(params: {
  phoneNumberId: string
  accessToken: string
}): Promise<{
  ok: boolean
  isOnBizApp: boolean | null
  platformType: string | null
  reason?: string
}> {
  const phoneNumberId = String(params.phoneNumberId || '').trim()
  if (!phoneNumberId || !params.accessToken) {
    return { ok: false, isOnBizApp: null, platformType: null, reason: 'missing_phone_or_token' }
  }

  const fields = encodeURIComponent('is_on_biz_app,platform_type')
  const url = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${encodeURIComponent(phoneNumberId)}?fields=${fields}`),
    params.accessToken,
    { purpose: 'whatsapp' },
  )

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${params.accessToken}` },
    })
    const data = await readMetaJson(response)
    if (!response.ok) {
      return {
        ok: false,
        isOnBizApp: null,
        platformType: null,
        reason: data?.error?.message || `graph_${response.status}`,
      }
    }
    return {
      ok: true,
      isOnBizApp: typeof data?.is_on_biz_app === 'boolean' ? data.is_on_biz_app : null,
      platformType: data?.platform_type ? String(data.platform_type) : null,
    }
  } catch (error) {
    console.warn('[meta-api] coexistence status check failed', error)
    return { ok: false, isOnBizApp: null, platformType: null, reason: 'coexistence_check_exception' }
  }
}

/** Webhook fields for Cloud API + coexistence (history / SMB sync / echoes). */
export const WHATSAPP_SUBSCRIBED_FIELDS_DEFAULT =
  'messages,history,smb_app_state_sync,smb_message_echoes,account_update'

export type WhatsAppSmbSyncType = 'smb_app_state_sync' | 'history'

/**
 * Kick off one-shot SMB contacts or history sync after coexistence onboard.
 * Must run within 24h of Embedded Signup completion.
 */
export async function initiateWhatsAppSmbAppDataSync(params: {
  phoneNumberId: string
  accessToken: string
  syncType: WhatsAppSmbSyncType
}): Promise<{ ok: boolean; status: number; requestId: string | null; data: unknown }> {
  const phoneNumberId = String(params.phoneNumberId || '').trim()
  const url = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${encodeURIComponent(phoneNumberId)}/smb_app_data`),
    params.accessToken,
    { purpose: 'whatsapp' },
  )

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      sync_type: params.syncType,
    }),
  })
  const data = await readMetaJson(response)
  const requestId =
    data && typeof data === 'object' && 'request_id' in data && data.request_id
      ? String(data.request_id)
      : null

  return {
    ok: response.ok,
    status: response.status,
    requestId,
    data,
  }
}

/**
 * Prove phone_number_id (and optional nested WABA when Graph returns it) from a phone GET.
 * Missing nested `whatsapp_business_account` is NOT a mismatch — verify via WABA phone list instead.
 * Callers must not treat Graph (#100) nonexisting-field alone as ownership failure; use safe fields.
 */
export function interpretWhatsAppOwnershipGraphData(params: {
  graphOk: boolean
  data: any
  claimedPhoneNumberId: string
  claimedWabaId?: string | null
}): {
  ok: boolean
  phoneNumberId: string | null
  whatsappBusinessAccountId: string | null
  providerDisplayName: string | null
  displayPhoneNumber: string | null
  reason?: string
} {
  if (!params.graphOk) {
    const reason = params.data?.error?.message || 'graph_not_ok'
    return {
      ok: false,
      phoneNumberId: null,
      whatsappBusinessAccountId: null,
      providerDisplayName: null,
      displayPhoneNumber: null,
      reason: isMetaNonexistingFieldError(params.data, 'whatsapp_business_account')
        ? 'nonexisting_waba_field'
        : reason,
    }
  }

  const resolvedPhoneId = params.data?.id ? String(params.data.id) : null
  if (!resolvedPhoneId || resolvedPhoneId !== params.claimedPhoneNumberId) {
    return {
      ok: false,
      phoneNumberId: null,
      whatsappBusinessAccountId: null,
      providerDisplayName: null,
      displayPhoneNumber: null,
      reason: 'phone_id_mismatch',
    }
  }

  const resolvedWaba = params.data?.whatsapp_business_account?.id
    ? String(params.data.whatsapp_business_account.id)
    : null

  const claimedWaba = (params.claimedWabaId || '').trim()
  // Only fail closed when Graph returns a nested WABA that disagrees with the claim.
  // Absent nested field is coexistence-normal — membership is checked via WABA phone list.
  if (claimedWaba && resolvedWaba && claimedWaba !== resolvedWaba) {
    return {
      ok: false,
      phoneNumberId: resolvedPhoneId,
      whatsappBusinessAccountId: resolvedWaba,
      providerDisplayName: null,
      displayPhoneNumber: null,
      reason: 'waba_mismatch',
    }
  }

  const providerDisplayName = params.data?.verified_name
    ? String(params.data.verified_name).trim() || null
    : null
  const displayPhoneNumber = params.data?.display_phone_number
    ? String(params.data.display_phone_number).trim() || null
    : null

  return {
    ok: true,
    phoneNumberId: resolvedPhoneId,
    whatsappBusinessAccountId: resolvedWaba,
    providerDisplayName,
    displayPhoneNumber,
  }
}

/** Safe phone fields — never request nested whatsapp_business_account (fails on coexistence). */
export const WHATSAPP_OWNERSHIP_PHONE_FIELDS = 'id,display_phone_number,verified_name'

export async function verifyWhatsAppAssetsForToken(params: {
  accessToken: string
  phoneNumberId: string
  whatsappBusinessAccountId?: string | null
  signal?: AbortSignal
}): Promise<{
  ok: boolean
  phoneNumberId: string | null
  whatsappBusinessAccountId: string | null
  providerDisplayName: string | null
  displayPhoneNumber: string | null
  reason?: string
}> {
  const phoneNumberId = String(params.phoneNumberId || '').trim()
  if (!phoneNumberId || !params.accessToken) {
    return {
      ok: false,
      phoneNumberId: null,
      whatsappBusinessAccountId: null,
      providerDisplayName: null,
      displayPhoneNumber: null,
      reason: 'missing_phone_or_token',
    }
  }

  const claimedWaba = String(params.whatsappBusinessAccountId || '').trim() || null
  const fields = encodeURIComponent(WHATSAPP_OWNERSHIP_PHONE_FIELDS)
  const url = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${encodeURIComponent(phoneNumberId)}?fields=${fields}`),
    params.accessToken,
    { purpose: 'whatsapp' },
  )

  try {
    const response = await fetch(url, metaGetInit(params.accessToken, params.signal))
    const data = await readMetaJson(response)
    const interpreted = interpretWhatsAppOwnershipGraphData({
      graphOk: response.ok,
      data,
      claimedPhoneNumberId: phoneNumberId,
      // Phone GET no longer returns nested WABA; do not treat claim as mismatch here.
      claimedWabaId: null,
    })

    if (!interpreted.ok || !interpreted.phoneNumberId) {
      return interpreted
    }

    const identity = {
      providerDisplayName: interpreted.providerDisplayName,
      displayPhoneNumber: interpreted.displayPhoneNumber,
    }

    // Preferred coexistence path: prove WABA ownership by listing phones under the claimed WABA.
    if (claimedWaba) {
      const listed = await listWhatsAppPhoneNumbersForWaba({
        wabaId: claimedWaba,
        accessToken: params.accessToken,
        signal: params.signal,
      })
      if (!listed.ok) {
        return {
          ok: false,
          phoneNumberId: interpreted.phoneNumberId,
          whatsappBusinessAccountId: null,
          ...identity,
          reason: listed.reason || 'waba_phone_list_failed',
        }
      }
      const phoneOnWaba = listed.phones.some((p) => p.id === interpreted.phoneNumberId)
      if (!phoneOnWaba) {
        return {
          ok: false,
          phoneNumberId: interpreted.phoneNumberId,
          whatsappBusinessAccountId: null,
          ...identity,
          reason: 'waba_mismatch',
        }
      }
      return {
        ok: true,
        phoneNumberId: interpreted.phoneNumberId,
        whatsappBusinessAccountId: claimedWaba,
        ...identity,
      }
    }

    // No claimed WABA: phone ownership is enough. Nested field may #100 — treat as unresolved, not fail.
    const resolvedWaba = await resolveWhatsAppBusinessAccountId(
      phoneNumberId,
      params.accessToken,
      params.signal,
    )
    return {
      ok: true,
      phoneNumberId: interpreted.phoneNumberId,
      whatsappBusinessAccountId: resolvedWaba,
      ...identity,
    }
  } catch (error) {
    console.warn('[meta-api] WhatsApp asset verification failed', error)
    return {
      ok: false,
      phoneNumberId: null,
      whatsappBusinessAccountId: null,
      providerDisplayName: null,
      displayPhoneNumber: null,
      reason: 'verification_exception',
    }
  }
}

/** Fetch IG Page name + nested username for identity refresh / connect. */
export async function fetchInstagramPageIdentity(params: {
  pageId: string
  accessToken: string
  signal?: AbortSignal
}): Promise<{
  ok: boolean
  pageName: string | null
  igUsername: string | null
  reason?: string
}> {
  const pageId = String(params.pageId || '').trim()
  if (!pageId || !params.accessToken) {
    return { ok: false, pageName: null, igUsername: null, reason: 'missing_page_or_token' }
  }
  const fields = encodeURIComponent('name,instagram_business_account{id,username}')
  const url = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${encodeURIComponent(pageId)}?fields=${fields}`),
    params.accessToken,
  )
  try {
    const response = await fetch(url, metaGetInit(params.accessToken, params.signal))
    const data = await readMetaJson(response)
    if (!response.ok) {
      return {
        ok: false,
        pageName: null,
        igUsername: null,
        reason: data?.error?.message || 'graph_not_ok',
      }
    }
    const pageName = data?.name ? String(data.name).trim() || null : null
    const igUsername = data?.instagram_business_account?.username
      ? String(data.instagram_business_account.username).trim() || null
      : null
    return { ok: true, pageName, igUsername }
  } catch (error) {
    console.warn('[meta-api] IG page identity fetch failed', error)
    return { ok: false, pageName: null, igUsername: null, reason: 'identity_exception' }
  }
}

export async function subscribeWhatsAppApp(params: {
  accessToken: string
  phoneNumberId: string
  whatsappBusinessAccountId?: string | null
  /** Defaults to Cloud API + coexistence fields (messages, history, SMB). */
  subscribedFields?: string
}) {
  const targetId =
    params.whatsappBusinessAccountId ||
    (await resolveWhatsAppBusinessAccountId(params.phoneNumberId, params.accessToken)) ||
    params.phoneNumberId

  const url = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${encodeURIComponent(targetId)}/subscribed_apps`),
    params.accessToken,
    { purpose: 'whatsapp' },
  )
  const body = new URLSearchParams({
    access_token: params.accessToken,
    subscribed_fields: params.subscribedFields || WHATSAPP_SUBSCRIBED_FIELDS_DEFAULT,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await readMetaJson(response)

  return {
    ok: response.ok,
    status: response.status,
    targetId,
    data,
    subscribedFields: params.subscribedFields || WHATSAPP_SUBSCRIBED_FIELDS_DEFAULT,
  }
}

export async function subscribePageToInstagramMessages(pageId: string, pageAccessToken: string) {
  const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${encodeURIComponent(pageId)}/subscribed_apps`), pageAccessToken)
  const body = new URLSearchParams({
    access_token: pageAccessToken,
    subscribed_fields: 'messages',
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await readMetaJson(response)

  return {
    ok: response.ok,
    status: response.status,
    data,
  }
}
