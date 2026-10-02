import { NextRequest, NextResponse } from 'next/server'
import { reportError } from '@/lib/observability/report-error'
import { createIdentifierRateLimit, getClientIP } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024
const limiter = createIdentifierRateLimit({ windowMs: 60_000, maxRequests: 10, identifier: 'client-errors' })

/** Same-origin only: the browser's Origin must be this site (sendBeacon always sends it). */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return false
  if (!origin) return false
  return origin === request.nextUrl.origin || origin === `https://${request.headers.get('host')}`
}

async function readCapped(request: NextRequest, max: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined)

/**
 * Browser error reports (Betsy's own error tracking). Public (errors happen before / without a
 * session) but same-origin, rate limited per IP, 8 KB cap, scrubbed again server-side; the
 * fingerprint is computed here. Answers 204 for anything it accepts or ignores.
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 })
  if (!(await limiter(`client-errors:${getClientIP(request)}`)).allowed) return new NextResponse(null, { status: 429 })
  const text = await readCapped(request, MAX_BYTES)
  if (text === null) return new NextResponse(null, { status: 413 })
  let body: Record<string, unknown> | null = null
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return new NextResponse(null, { status: 204 })
  }
  const message = str(body?.message, 500)
  if (!body || !message) return new NextResponse(null, { status: 204 })
  reportError({
    source: 'client',
    name: str(body.name, 120) ?? 'Error',
    message,
    stack: str(body.stack, 3000),
    route: str(body.route, 300)?.split('?')[0] ?? null,
  })
  return new NextResponse(null, { status: 204 })
}
