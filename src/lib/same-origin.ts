/**
 * CSRF defence in depth for state-changing JSON routes (the session cookie is already SameSite=Lax).
 *
 * Do NOT compare against `request.nextUrl.origin`: in the standalone container (HOSTNAME=0.0.0.0, PORT=3000) Next
 * builds route-handler URLs as http://0.0.0.0:3000, so that origin never equals https://www.betsycrm.com and every
 * real browser request would be refused. The public origin comes from the Host / X-Forwarded-Host headers (what the
 * browser actually addressed) and NEXTAUTH_URL.
 */
import type { NextRequest } from 'next/server'

function allowedOrigins(request: NextRequest): Set<string> {
  const ok = new Set<string>()
  for (const header of ['host', 'x-forwarded-host']) {
    const host = (request.headers.get(header) || '').split(',')[0].trim()
    if (host) ok.add(`https://${host}`)
  }
  try {
    if (process.env.NEXTAUTH_URL) ok.add(new URL(process.env.NEXTAUTH_URL).origin)
  } catch {
    /* malformed env: ignore */
  }
  if (process.env.NODE_ENV !== 'production') {
    ok.add(request.nextUrl.origin)
    const host = request.headers.get('host')
    if (host) ok.add(`http://${host}`)
  }
  return ok
}

/** True when the request comes from this site. A missing Origin (non-browser client) is allowed: the cookie still gates it. */
export function isSameOriginRequest(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = request.headers.get('origin')
  if (!origin) return true
  return allowedOrigins(request).has(origin)
}

/** JSON body + same origin: the two checks every state-changing JSON route should run before doing anything. */
export function isSameOriginJson(request: NextRequest): boolean {
  const type = (request.headers.get('content-type') || '').toLowerCase()
  return type.includes('application/json') && isSameOriginRequest(request)
}
