import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * Uptime check (public, no data): the app answers AND the database answers within 3 s.
 * Used by the Cloudflare Worker watchdog every 5 minutes (and by any outside uptime monitor).
 */
export async function GET() {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), 3_000)
    })
    const db = await Promise.race([prisma.$queryRaw`SELECT 1`.then(() => 'ok' as const), timeout])
    if (db !== 'ok') return NextResponse.json({ ok: false, db: 'timeout' }, { status: 503, headers: NO_STORE })
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  } catch {
    return NextResponse.json({ ok: false, db: 'error' }, { status: 503, headers: NO_STORE })
  } finally {
    if (timer) clearTimeout(timer)
  }
}
