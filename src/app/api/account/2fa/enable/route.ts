import { NextRequest } from 'next/server'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { completeMfaSetup } from '@/lib/mfa-state'
import { auditMfaChange, mfaReply } from '@/lib/mfa-account'
import { notifyMfaEvent } from '@/lib/mfa-throttle'
import { revokeUserSessions } from '@/lib/session-revocation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Setup step 2: a code from the app turns 2FA on. Returns the recovery codes ONCE, then ends every
 * session of the user (this one too): the next sign-in asks for a code. Once 2FA is on, the answer
 * is success even if a follow-up step hiccups (the codes must never be lost; AUTH-50).
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code.trim().slice(0, 12) : ''
  if (!code) return mfaReply(400, { success: false, error: 'Ingresá el código de 6 dígitos de la app.' })

  let done: Awaited<ReturnType<typeof completeMfaSetup>>
  try {
    done = await completeMfaSetup(auth.userId, code)
  } catch {
    return mfaReply(503, { success: false, error: 'No disponible en este momento.' })
  }
  if ('error' in done) {
    if (done.error === 'invalid') {
      return mfaReply(400, { success: false, error: 'Código incorrecto. Revisá la hora del teléfono y probá de nuevo.' })
    }
    if (done.error === 'throttled') {
      return mfaReply(429, { success: false, error: 'Demasiados intentos. Esperá unos minutos.' })
    }
    return mfaReply(409, { success: false, error: 'La configuración venció. Empezá de nuevo.' })
  }

  let sessionsEnded = true
  try {
    await revokeUserSessions(auth.userId)
  } catch {
    sessionsEnded = false
  }
  await auditMfaChange(auth.userId, 'enabled', request)
  void notifyMfaEvent(auth.userId, 'mfa_enabled')
  return mfaReply(200, { success: true, recoveryCodes: done.recoveryCodes, sessionsEnded })
}
