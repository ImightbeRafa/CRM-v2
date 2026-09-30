import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { disableMfa, verifyCurrentFactor } from '@/lib/mfa-state'
import { auditMfaChange, mfaReply, readFactorInput } from '@/lib/mfa-account'
import { mfaThrottled, recordMfaFailure } from '@/lib/mfa-throttle'
import { verifyPassword } from '@/lib/password'
import { revokeUserSessions } from '@/lib/session-revocation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Turns 2FA off. Needs a current code (or recovery code) AND, for password accounts, the password:
 * a stolen open session alone can't remove the second step. Ends every session afterwards.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  if (await mfaThrottled(auth.userId, request)) {
    return mfaReply(429, { success: false, error: 'Demasiados intentos. Esperá unos minutos.' })
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null
  const factor = readFactorInput(body)
  if (!factor.code && !factor.recoveryCode) {
    return mfaReply(400, { success: false, error: 'Ingresá un código de la app o un código de recuperación.' })
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { password: true } })
    if (!user) return mfaReply(401, { success: false, error: 'Unauthorized' })
    if (user.password) {
      const password = typeof body?.password === 'string' ? body.password : ''
      if (!password || !(await verifyPassword(password, user.password))) {
        await recordMfaFailure(auth.userId, request)
        return mfaReply(400, { success: false, error: 'Contraseña o código incorrecto.' })
      }
    }
    if (!(await verifyCurrentFactor(auth.userId, factor))) {
      await recordMfaFailure(auth.userId, request)
      return mfaReply(400, { success: false, error: 'Contraseña o código incorrecto.' })
    }
    await disableMfa(auth.userId)
    await revokeUserSessions(auth.userId)
    await auditMfaChange(auth.userId, 'disabled', request)
    return mfaReply(200, { success: true })
  } catch {
    return mfaReply(503, { success: false, error: 'No disponible en este momento.' })
  }
}
