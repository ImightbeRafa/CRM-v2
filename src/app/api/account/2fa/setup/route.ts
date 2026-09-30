import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { beginMfaSetup, mfaTablesKnownMissing } from '@/lib/mfa-state'
import { mfaReply } from '@/lib/mfa-account'
import { otpauthUri } from '@/lib/totp'
import { createIdentifierRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const setupLimit = createIdentifierRateLimit({ windowMs: 15 * 60_000, maxRequests: 10, identifier: 'mfa-setup' })

/**
 * Setup step 1: a new secret for the authenticator app (shown once as key + otpauth link). It does
 * nothing until step 2 proves a code. Refused while 2FA is already on.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  if (mfaTablesKnownMissing()) return mfaReply(503, { success: false, error: 'La verificación en dos pasos todavía no está disponible.' })
  if (!(await setupLimit(`mfa-setup:${auth.userId}`)).allowed) {
    return mfaReply(429, { success: false, error: 'Demasiados intentos. Probá en unos minutos.' })
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } })
    if (!user) return mfaReply(401, { success: false, error: 'Unauthorized' })
    const started = await beginMfaSetup(auth.userId)
    if ('error' in started) {
      return mfaReply(409, { success: false, error: 'La verificación en dos pasos ya está activa.' })
    }
    return mfaReply(200, {
      success: true,
      secret: started.secret,
      otpauthUri: otpauthUri({ secret: started.secret, accountName: user.email }),
    })
  } catch {
    return mfaReply(503, { success: false, error: 'No disponible en este momento.' })
  }
}
