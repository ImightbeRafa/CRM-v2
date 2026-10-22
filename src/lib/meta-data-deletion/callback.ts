/**
 * Shared front door of Meta's data-deletion and deauthorize callbacks (public routes):
 *  - production container only: the Railway preview shares the production database, and Meta only calls www;
 *  - small bodies only (Meta sends one form field);
 *  - signed_request verified against our Meta app secrets, then checked to be a fresh callback payload
 *    (issued_at within 24 h, not a Facebook-login signedRequest of the same app, string user_id).
 * Returns the Meta user id, or the response to send.
 */
import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { getMetaWebhookAppSecrets } from '@/lib/meta-api'
import { parseMetaSignedRequest, readSignedRequestFromBody } from '@/lib/meta-signed-request'
import { isProductionContainer } from '@/lib/ops/runtime'
import { checkCallbackPayload } from './core'

export const MAX_CALLBACK_BODY_BYTES = 16_384

export async function readMetaCallback(
  request: NextRequest,
  tag: string,
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const fail = (status: number, error: string) => ({ ok: false as const, response: NextResponse.json({ error }, { status }) })
  if (!isProductionContainer()) return fail(503, 'Not available here')

  const length = Number(request.headers.get('content-length') || '0')
  if (Number.isFinite(length) && length > MAX_CALLBACK_BODY_BYTES) return fail(413, 'Payload too large')
  const rawBody = await request.text()
  if (rawBody.length > MAX_CALLBACK_BODY_BYTES) return fail(413, 'Payload too large')

  const signedRequest = readSignedRequestFromBody(rawBody, request.headers.get('content-type'))
  if (!signedRequest) {
    console.error(`[${tag}] No signed_request provided`)
    return fail(400, 'Invalid request')
  }
  const secrets = getMetaWebhookAppSecrets().map((s) => s.secret)
  if (secrets.length === 0) {
    console.error(`[${tag}] No Meta app secret configured`)
    return fail(500, 'Server misconfiguration')
  }
  const payload = parseMetaSignedRequest(signedRequest, secrets)
  if (!payload) {
    console.error(`[${tag}] Signature verification failed`)
    return fail(403, 'Invalid signature')
  }
  const checked = checkCallbackPayload(payload)
  if (!checked.ok) {
    // Key names only (never values) — tells us what Meta really sends if this ever rejects a real callback.
    console.error(`[${tag}] Payload refused`, { reason: checked.reason, keys: Object.keys(payload).slice(0, 12) })
    return fail(400, 'Invalid request')
  }
  return { ok: true, userId: checked.userId }
}
