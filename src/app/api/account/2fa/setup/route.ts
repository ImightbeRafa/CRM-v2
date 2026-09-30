import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { beginMfaSetup, mfaTablesKnownMissing } from '@/lib/mfa-state'
import { mfaReply, proveAccountOwner } from '@/lib/mfa-account'
import { otpauthUri } from '@/lib/totp'
import { createIdentifierRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const setupLimit = createIdentifierRateLimit({ windowMs: 15 * 60_000, maxRequests: 10, identifier: 'mfa-setup' })

/**
 * Setup step 1: a new secret for the authenticator app (shown once as key + otpauth link). Needs
 * the password (or a fresh Google sign-in): an open session alone can't put its own app on the
 * account and lock the owner out (AUTH-44). Nothing changes until step 2 proves a code.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  if (mfaTablesKnownMissing()) return mfaReply(503, { success: false, error: 'La verificación en dos pasos todavía no está disponible.' })
  if (!(await setupLimit(`mfa-setup:${auth.userId}`)).allowed) {
    return mfaReply(429, { success: false, error: 'Demasiados intentos. Probá en unos minutos.' })
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null
  try {
    const owner = await proveAccountOwner(request, auth.userId, body?.password)
    if (!owner.ok) return mfaReply(owner.status, { success: false, error: owner.error })
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } })
    if (!user) return mfaReply(401, { success: false, error: 'Unauthorized' })
    const started = await beginMfaSetup(auth.userId)
    if ('error' in started) {
      if (started.error === 'unavailable') {
        return mfaReply(503, { success: false, error: 'La verificación en dos pasos todavía no está disponible.' })
      }
      if (started.error === 'email_unverified') {
        return mfaReply(403, { success: false, error: 'Primero verificá tu correo electrónico.' })
      }
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
