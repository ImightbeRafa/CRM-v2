import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { dbConnErrors5m, recordDbConnError } from '@/lib/db-retry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** The Worker watchdog sends CRON_SECRET in this header to also get the app's connection-error count. */
function isWatchdog(request: NextRequest): boolean {
  const expected = (process.env.CRON_SECRET || '').trim()
  const given = (request.headers.get('x-betsy-watch') || '').trim()
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Uptime check (public, no data): the app answers AND the database answers within 3 s.
 * Used by the Cloudflare Worker watchdog every 5 minutes (and by any outside uptime monitor).
 * Only the watchdog's own check also gets `connErrors5m` (database connection failures this process saw
 * in the last 5 min), so it can warn while the site is still up (2026-10-23 incident).
 */
export async function GET(request: NextRequest) {
  const extra = isWatchdog(request)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), 3_000)
    })
    const started = Date.now()
    const db = await Promise.race([prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const), timeout])
    if (db !== 'ok') {
      recordDbConnError()
      return NextResponse.json({ ok: false, db: 'timeout' }, { status: 503, headers: NO_STORE })
    }
    // dbMs: database answer time, shown in the watchdog emails (a number only, no data).
    const body = extra
      ? { ok: true, dbMs: Date.now() - started, connErrors5m: dbConnErrors5m() }
      : { ok: true, dbMs: Date.now() - started }
    return NextResponse.json(body, { headers: NO_STORE })
  } catch {
    recordDbConnError()
    return NextResponse.json({ ok: false, db: 'error' }, { status: 503, headers: NO_STORE })
  } finally {
    if (timer) clearTimeout(timer)
  }
}
