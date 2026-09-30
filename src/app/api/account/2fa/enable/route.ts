import { NextRequest } from 'next/server'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { completeMfaSetup } from '@/lib/mfa-state'
import { auditMfaChange, mfaReply } from '@/lib/mfa-account'
import { mfaThrottled, recordMfaFailure } from '@/lib/mfa-throttle'
import { revokeUserSessions } from '@/lib/session-revocation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Setup step 2: a code from the app turns 2FA on. Returns the recovery codes ONCE, then ends every
 * session of the user (this one too): the next sign-in asks for a code.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  if (await mfaThrottled(auth.userId, request)) {
    return mfaReply(429, { success: false, error: 'Demasiados intentos. Esperá unos minutos.' })
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code.trim().slice(0, 12) : ''
  if (!code) return mfaReply(400, { success: false, error: 'Ingresá el código de 6 dígitos de la app.' })
  try {
    const done = await completeMfaSetup(auth.userId, code)
    if ('error' in done) {
      if (done.error === 'invalid') {
        await recordMfaFailure(auth.userId, request)
        return mfaReply(400, { success: false, error: 'Código incorrecto. Revisá la hora del teléfono y probá de nuevo.' })
      }
      return mfaReply(409, { success: false, error: 'La configuración venció. Empezá de nuevo.' })
    }
    await revokeUserSessions(auth.userId)
    await auditMfaChange(auth.userId, 'enabled', request)
    return mfaReply(200, { success: true, recoveryCodes: done.recoveryCodes })
  } catch {
    return mfaReply(503, { success: false, error: 'No disponible en este momento.' })
  }
}
