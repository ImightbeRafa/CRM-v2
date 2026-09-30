import { NextRequest } from 'next/server'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { regenerateRecoveryCodes, verifyCurrentFactor } from '@/lib/mfa-state'
import { auditMfaChange, mfaReply, readFactorInput } from '@/lib/mfa-account'
import { mfaThrottled, recordMfaFailure } from '@/lib/mfa-throttle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** New recovery codes (the old ones stop working). Needs a current code. Returned ONCE. */
export async function POST(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  if (await mfaThrottled(auth.userId, request)) {
    return mfaReply(429, { success: false, error: 'Demasiados intentos. Esperá unos minutos.' })
  }
  const factor = readFactorInput(await request.json().catch(() => null))
  if (!factor.code && !factor.recoveryCode) {
    return mfaReply(400, { success: false, error: 'Ingresá un código de la app.' })
  }
  try {
    if (!(await verifyCurrentFactor(auth.userId, factor))) {
      await recordMfaFailure(auth.userId, request)
      return mfaReply(400, { success: false, error: 'Código incorrecto.' })
    }
    const recoveryCodes = await regenerateRecoveryCodes(auth.userId)
    await auditMfaChange(auth.userId, 'recovery_codes_regenerated', request)
    return mfaReply(200, { success: true, recoveryCodes })
  } catch {
    return mfaReply(503, { success: false, error: 'No disponible en este momento.' })
  }
}
