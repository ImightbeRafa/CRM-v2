import { NextRequest } from 'next/server'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { disableMfa, shouldNotifyWrongCode, verifyCurrentFactor } from '@/lib/mfa-state'
import { auditMfaChange, mfaReply, proveAccountOwner, readFactorInput } from '@/lib/mfa-account'
import { notifyMfaEvent, releaseMfaIpSlot, reserveMfaIpSlot } from '@/lib/mfa-throttle'
import { revokeUserSessions } from '@/lib/session-revocation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** First wrong code of the day on an account change emails the owner (AUTH-57). */
function notifyWrongCode(userId: string) {
  return shouldNotifyWrongCode(userId)
    .then(async (first) => {
      if (first) await notifyMfaEvent(userId, 'mfa_wrong_code')
    })
    .catch(() => undefined)
}

/**
 * Turns 2FA off. Needs a current code (or recovery code) AND the password (fresh Google sign-in for
 * Google-only accounts): a stolen open session alone can't remove the second step. Ends every
 * session afterwards; once it is off the answer is success (AUTH-50).
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  if (!(await reserveMfaIpSlot(request))) {
    return mfaReply(429, { success: false, error: 'Demasiados intentos. Esperá unos minutos.' })
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null
  const factor = readFactorInput(body)
  if (!factor.code && !factor.recoveryCode) {
    return mfaReply(400, { success: false, error: 'Ingresá un código de la app o un código de recuperación.' })
  }
  try {
    const owner = await proveAccountOwner(request, auth.userId, body?.password)
    if (!owner.ok) return mfaReply(owner.status, { success: false, error: owner.error })
    const check = await verifyCurrentFactor(auth.userId, factor)
    if (!check.ok) {
      if (check.reason === 'throttled') {
        if (check.firstLock) void notifyMfaEvent(auth.userId, 'mfa_locked')
        return mfaReply(429, { success: false, error: 'Demasiados intentos. Esperá unos minutos.' })
      }
      if (check.reason === 'invalid') void notifyWrongCode(auth.userId)
      return mfaReply(400, { success: false, error: 'Contraseña o código incorrecto.' })
    }
    await disableMfa(auth.userId)
  } catch {
    return mfaReply(503, { success: false, error: 'No disponible en este momento.' })
  }
  try {
    await revokeUserSessions(auth.userId)
  } catch {
    // 2FA is already off; the sessions still expire on their own.
  }
  await releaseMfaIpSlot(request)
  await auditMfaChange(auth.userId, 'disabled', request)
  void notifyMfaEvent(auth.userId, 'mfa_disabled')
  return mfaReply(200, { success: true })
}
