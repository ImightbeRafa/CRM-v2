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
 * Generate appsecret_proof for Meta API calls
 * This is required when app secret proof is enabled in Meta app settings
 */
export function generateAppSecretProof(accessToken: string): string {
  const appSecret = (process.env.META_APP_SECRET || '').trim()
  if (!appSecret) {
    console.warn('[meta-api] META_APP_SECRET not configured, skipping appsecret_proof')
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

export function verifyMetaWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = (process.env.META_APP_SECRET || '').trim()
  const signature = (signatureHeader || '').trim()

  if (!appSecret || !signature.startsWith('sha256=')) {
    return false
  }

  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(signature)

  return expectedBuffer.length === providedBuffer.length && crypto.timingSafeEqual(expectedBuffer, providedBuffer)
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
 * Add appsecret_proof to a Meta API URL if required
 */
export function addAppSecretProofToUrl(baseUrl: string, accessToken: string): string {
  const proof = generateAppSecretProof(accessToken)
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
  const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${encodeURIComponent(phoneNumberId)}?fields=${fields}`), accessToken)

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

  const url = addAppSecretProofToUrl(buildMetaGraphUrl(`${encodeURIComponent(targetId)}/subscribed_apps`), params.accessToken)
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
