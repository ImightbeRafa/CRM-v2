import { NextRequest } from 'next/server'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { regenerateRecoveryCodes, shouldNotifyWrongCode, verifyCurrentFactor } from '@/lib/mfa-state'
import { auditMfaChange, mfaReply, readFactorInput } from '@/lib/mfa-account'
import { notifyMfaEvent, releaseMfaIpSlot, reserveMfaIpSlot } from '@/lib/mfa-throttle'

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

/** New recovery codes (the old ones stop working). Needs a current code. Returned ONCE. */
export async function POST(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  if (!(await reserveMfaIpSlot(request))) {
    return mfaReply(429, { success: false, error: 'Demasiados intentos. Esperá unos minutos.' })
  }
  const factor = readFactorInput(await request.json().catch(() => null))
  if (!factor.code && !factor.recoveryCode) {
    return mfaReply(400, { success: false, error: 'Ingresá un código de la app.' })
  }
  let recoveryCodes: string[]
  try {
    const check = await verifyCurrentFactor(auth.userId, factor)
    if (!check.ok) {
      if (check.reason === 'throttled') {
        if (check.firstLock) void notifyMfaEvent(auth.userId, 'mfa_locked')
        return mfaReply(429, { success: false, error: 'Demasiados intentos. Esperá unos minutos.' })
      }
      if (check.reason === 'invalid') void notifyWrongCode(auth.userId)
      return mfaReply(400, { success: false, error: 'Código incorrecto.' })
    }
    recoveryCodes = await regenerateRecoveryCodes(auth.userId)
  } catch {
    return mfaReply(503, { success: false, error: 'No disponible en este momento.' })
  }
  await releaseMfaIpSlot(request)
  await auditMfaChange(auth.userId, 'recovery_codes_regenerated', request)
  void notifyMfaEvent(auth.userId, 'mfa_codes_regenerated')
  return mfaReply(200, { success: true, recoveryCodes })
}
