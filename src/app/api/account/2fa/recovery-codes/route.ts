import { NextRequest } from 'next/server'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { regenerateRecoveryCodes, verifyCurrentFactor } from '@/lib/mfa-state'
import { auditMfaChange, mfaReply, readFactorInput } from '@/lib/mfa-account'
import { notifyMfaEvent, releaseMfaIpSlot, reserveMfaIpSlot } from '@/lib/mfa-throttle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
