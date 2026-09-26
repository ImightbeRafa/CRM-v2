import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqualString } from '@/lib/security'
import { metaEnvFingerprint } from '@/lib/meta-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(request: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  return timingSafeEqualString(header, `Bearer ${secret}`)
}

/**
 * GET /api/cron/meta-env-fingerprint
 * Safe Meta env presence check for CF cutover. Never returns secret values.
 */
export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fp = metaEnvFingerprint()
  return NextResponse.json({
    success: true,
    ...fp,
    ok: fp.waAppIdUsable && fp.waSecretUsable && fp.encryptionKeyUsable,
  })
}
