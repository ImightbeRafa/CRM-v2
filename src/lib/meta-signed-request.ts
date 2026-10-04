import crypto from 'crypto'

export type MetaSignedRequestPayload = {
  algorithm?: string
  user_id?: string
  issued_at?: number
  [key: string]: unknown
}

/**
 * Verify and decode a Meta `signed_request` (`<base64url sig>.<base64url payload>`).
 * The signature is HMAC-SHA256 of the raw payload segment with the app secret.
 * Tries every candidate secret (Inbox app first); returns null when none match.
 * Never logs secrets or the request.
 */
export function parseMetaSignedRequest(
  signedRequest: string,
  appSecrets: string[],
): MetaSignedRequestPayload | null {
  const parts = (signedRequest || '').split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const [encodedSig, payloadSegment] = parts

  let provided: Buffer
  let payload: MetaSignedRequestPayload
  try {
    provided = Buffer.from(encodedSig, 'base64url')
    payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!payload || typeof payload !== 'object') return null
  if (String(payload.algorithm || '').toUpperCase() !== 'HMAC-SHA256') return null

  for (const secret of appSecrets) {
    if (!secret) continue
    const expected = crypto.createHmac('sha256', secret).update(payloadSegment).digest()
    if (expected.length === provided.length && crypto.timingSafeEqual(expected, provided)) {
      return payload
    }
  }
  return null
}

/** Read `signed_request` from a form-encoded (Meta default) or JSON body. */
export function readSignedRequestFromBody(rawBody: string, contentType: string | null): string | null {
  const type = (contentType || '').toLowerCase()
  if (type.includes('application/json')) {
    try {
      const value = JSON.parse(rawBody)?.signed_request
      return typeof value === 'string' ? value : null
    } catch {
      return null
    }
  }
  return new URLSearchParams(rawBody).get('signed_request')
}
