import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { isMfaPendingToken, pendingMfaNonce, pendingMfaUserId } from '@/lib/mfa-session'
import { shouldNotifyWrongCode, verifyMfaChallenge } from '@/lib/mfa-state'
import { notifyMfaEvent, releaseMfaIpSlot, reserveMfaIpSlot } from '@/lib/mfa-throttle'
import { PII_NO_STORE_HEADERS } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MESSAGES = {
  invalid: 'Código incorrecto. Revisá la app de autenticación e intentá de nuevo.',
  locked: 'Demasiados intentos. Volvé a iniciar sesión.',
  expired: 'El inicio de sesión venció. Volvé a iniciar sesión.',
  throttled: 'Demasiados intentos. Esperá unos minutos y volvé a iniciar sesión.',
  bad_request: 'Ingresá el código de 6 dígitos o un código de recuperación.',
} as const

function reply(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status, headers: PII_NO_STORE_HEADERS })
}

/**
 * Second step of sign-in. Reads the pending session from the encrypted cookie (never from the
 * body); marks the challenge verified on a correct code. The client then calls NextAuth `update()`,
 * which consumes the challenge once and restores the session.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET
  const token = secret ? await getToken({ req: request, secret }).catch(() => null) : null
  const userId = pendingMfaUserId(token)
  const nonce = pendingMfaNonce(token)
  if (!token || !isMfaPendingToken(token) || !userId || !nonce) {
    return reply(401, { ok: false, code: 'NO_PENDING_LOGIN', error: MESSAGES.expired })
  }

  const body = (await request.json().catch(() => null)) as { code?: unknown; recoveryCode?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code.trim().slice(0, 12) : ''
  const recoveryCode = typeof body?.recoveryCode === 'string' ? body.recoveryCode.trim().slice(0, 24) : ''
  if (!code === !recoveryCode) return reply(400, { ok: false, code: 'BAD_REQUEST', error: MESSAGES.bad_request })

  // Reserve first (never check-then-act); the per-user budget inside verifyMfaChallenge is the hard cap.
  if (!(await reserveMfaIpSlot(request))) {
    return reply(429, { ok: false, code: 'THROTTLED', error: MESSAGES.throttled })
  }

  let result: Awaited<ReturnType<typeof verifyMfaChallenge>>
  try {
    result = await verifyMfaChallenge({ userId, nonce, code: code || null, recoveryCode: recoveryCode || null })
  } catch (error) {
    console.error('[2fa/verify] failed:', error instanceof Error ? error.name : 'unknown')
    return reply(503, { ok: false, code: 'UNAVAILABLE', error: 'No pudimos verificar el código. Intentá de nuevo.' })
  }

  if (!result.ok) {
    if (result.reason === 'throttled') {
      if (result.firstLock) void notifyMfaEvent(userId, 'mfa_locked')
      return reply(429, { ok: false, code: 'THROTTLED', error: MESSAGES.throttled })
    }
    if (result.reason === 'invalid') {
      // Someone has the password: tell the owner once a day, even below the lock (AUTH-54).
      void shouldNotifyWrongCode(userId)
        .then(async (first) => {
          if (first) await notifyMfaEvent(userId, 'mfa_wrong_code')
        })
        .catch(() => undefined)
    }
    const status = result.reason === 'invalid' ? 400 : 401
    const message = result.reason === 'invalid' ? MESSAGES.invalid : result.reason === 'locked' ? MESSAGES.locked : MESSAGES.expired
    return reply(status, { ok: false, code: result.reason.toUpperCase(), error: message })
  }

  await releaseMfaIpSlot(request)
  if (result.method === 'recovery') void notifyMfaEvent(userId, 'mfa_recovery_used')
  return reply(200, {
    ok: true,
    method: result.method,
    ...(result.method === 'recovery' ? { recoveryLeft: result.recoveryLeft ?? 0 } : {}),
  })
}
