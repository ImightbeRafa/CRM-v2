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

export async function resolveWhatsAppBusinessAccountId(phoneNumberId: string, accessToken: string): Promise<string | null> {
  const fields = encodeURIComponent('whatsapp_business_account')
  const url = addAppSecretProofToUrl(
    buildMetaGraphUrl(`${encodeURIComponent(phoneNumberId)}?fields=${fields}`),
    accessToken,
    { purpose: 'whatsapp' },
  )

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })
    const data = await readMetaJson(response)

    if (!response.ok) {
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

/**
 * Prove phone_number_id (and optional WABA) are reachable with this access token
 * before trusting client Embedded Signup message fields.
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
  reason?: string
} {
  if (!params.graphOk) {
    return {
      ok: false,
      phoneNumberId: null,
      whatsappBusinessAccountId: null,
      reason: params.data?.error?.message || 'graph_not_ok',
    }
  }

  const resolvedPhoneId = params.data?.id ? String(params.data.id) : null
  if (!resolvedPhoneId || resolvedPhoneId !== params.claimedPhoneNumberId) {
    return {
      ok: false,
      phoneNumberId: null,
      whatsappBusinessAccountId: null,
      reason: 'phone_id_mismatch',
    }
  }

  const resolvedWaba = params.data?.whatsapp_business_account?.id
    ? String(params.data.whatsapp_business_account.id)
    : null

  const claimedWaba = (params.claimedWabaId || '').trim()
  if (claimedWaba) {
    if (!resolvedWaba || claimedWaba !== resolvedWaba) {
      return {
        ok: false,
        phoneNumberId: resolvedPhoneId,
        whatsappBusinessAccountId: resolvedWaba,
        reason: 'waba_mismatch',
      }
    }
  }

  return {
    ok: true,
    phoneNumberId: resolvedPhoneId,
    whatsappBusinessAccountId: resolvedWaba,
  }
}

export async function verifyWhatsAppAssetsForToken(params: {
  accessToken: string
  phoneNumberId: string
  whatsappBusinessAccountId?: string | null
}): Promise<{
  ok: boolean
  phoneNumberId: string | null
  whatsappBusinessAccountId: string | null
  reason?: string
}> {
  const phoneNumberId = String(params.phoneNumberId || '').trim()
  if (!phoneNumberId || !params.accessToken) {
    return { ok: false, phoneNumberId: null, whatsappBusinessAccountId: null, reason: 'missing_phone_or_token' }
  }

  const fields = encodeURIComponent('id,display_phone_number,verified_name,whatsapp_business_account{id}')
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
    const interpreted = interpretWhatsAppOwnershipGraphData({
      graphOk: response.ok,
      data,
      claimedPhoneNumberId: phoneNumberId,
      claimedWabaId: params.whatsappBusinessAccountId,
    })

    if (interpreted.ok && !interpreted.whatsappBusinessAccountId) {
      const resolvedWaba = await resolveWhatsAppBusinessAccountId(phoneNumberId, params.accessToken)
      return {
        ...interpreted,
        whatsappBusinessAccountId: resolvedWaba,
      }
    }

    return interpreted
  } catch (error) {
    console.warn('[meta-api] WhatsApp asset verification failed', error)
    return {
      ok: false,
      phoneNumberId: null,
      whatsappBusinessAccountId: null,
      reason: 'verification_exception',
    }
  }
}

export async function subscribeWhatsAppApp(params: {
  accessToken: string
  phoneNumberId: string
  whatsappBusinessAccountId?: string | null
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
    targetId,
    data,
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
