import { NextRequest } from 'next/server'
import { authenticateUserOnly } from '@/lib/auth-helpers'
import { getMfaStatus } from '@/lib/mfa-state'
import { mfaReply } from '@/lib/mfa-account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The signed-in user's own 2FA state (never the secret). */
export async function GET(request: NextRequest) {
  const auth = await authenticateUserOnly(request)
  if (!auth.ok) return auth.response
  try {
    return mfaReply(200, { success: true, ...(await getMfaStatus(auth.userId)) })
  } catch {
    return mfaReply(503, { success: false, error: 'No disponible en este momento.' })
  }
}
