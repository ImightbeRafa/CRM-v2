import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { timingSafeEqualString } from '@/lib/security'
import { probeSocialAccountToken } from '@/lib/social-account-token-health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BATCH_SIZE = 40

function isAuthorized(request: NextRequest): boolean {
  const secret = (process.env.CRON_SECRET || '').trim()
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  return timingSafeEqualString(header, `Bearer ${secret}`)
}

async function runTokenHealthCheck() {
  const db = prisma as any
  const now = new Date()

  const accounts = await db.socialAccount.findMany({
    where: {
      isActive: true,
      accessToken: { not: null },
      disconnectedAt: null,
    },
    select: {
      id: true,
      platform: true,
      accountId: true,
      accessToken: true,
      expiresAt: true,
      tokenStatus: true,
    },
    take: 500,
    orderBy: [{ tokenLastCheckedAt: 'asc' }, { linkedAt: 'asc' }],
  })

  let checked = 0
  let revoked = 0
  let expired = 0
  let expiring = 0
  let valid = 0
  let errors = 0

  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    const batch = accounts.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(
      batch.map(async (account: (typeof accounts)[number]) => {
        const probe = await probeSocialAccountToken(account)
        await db.socialAccount.update({
          where: { id: account.id },
          data: {
            tokenStatus: probe.tokenStatus,
            tokenLastCheckedAt: now,
            lastErrorCode: probe.lastErrorCode,
            lastErrorAt: probe.lastErrorCode ? now : null,
          },
        })
        return probe.tokenStatus
      }),
    )

    for (const status of results) {
      checked += 1
      if (status === 'revoked') revoked += 1
      else if (status === 'expired') expired += 1
      else if (status === 'expiring') expiring += 1
      else if (status === 'valid') valid += 1
      else errors += 1
    }
  }

  const expiredFlip = await db.socialAccount.updateMany({
    where: {
      isActive: true,
      expiresAt: { lte: now },
      tokenStatus: { notIn: ['expired', 'revoked'] },
    },
    data: {
      tokenStatus: 'expired',
      tokenLastCheckedAt: now,
      lastErrorCode: 'expires_at',
      lastErrorAt: now,
    },
  })

  return {
    checked,
    revoked,
    expired,
    expiring,
    valid,
    errors,
    expiredFlip: expiredFlip.count,
  }
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await runTokenHealthCheck()
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    console.error('[cron/chat-token-health] failed', error)
    return NextResponse.json({ error: 'Token health check failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
