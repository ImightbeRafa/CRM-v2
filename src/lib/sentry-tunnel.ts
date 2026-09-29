/**
 * Allow-list for the /monitoring Sentry tunnel: only this app's DSN (the same one the Sentry
 * configs use) may be relayed. Returns the upstream envelope URL, or null.
 */
export const SENTRY_DSN = 'https://34154b8e86072342dbf9c6e55236e963@o4511109425725440.ingest.us.sentry.io/4511109427494912'

const ALLOWED = new URL(SENTRY_DSN)
const ALLOWED_PROJECT = ALLOWED.pathname.replace(/^\/+/, '')

export function sentryEnvelopeTarget(body: Uint8Array): string | null {
  // The envelope header is the first line (JSON) and carries the DSN.
  const newline = body.indexOf(0x0a)
  const firstLine = new TextDecoder().decode(newline === -1 ? body.subarray(0, 4096) : body.subarray(0, Math.min(newline, 4096)))
  let dsn: URL
  try {
    const header = JSON.parse(firstLine) as { dsn?: unknown }
    if (typeof header.dsn !== 'string') return null
    dsn = new URL(header.dsn)
  } catch {
    return null
  }
  const project = dsn.pathname.replace(/^\/+/, '')
  if (dsn.protocol !== 'https:' || dsn.hostname !== ALLOWED.hostname || project !== ALLOWED_PROJECT || dsn.username !== ALLOWED.username) {
    return null
  }
  return `https://${ALLOWED.hostname}/api/${ALLOWED_PROJECT}/envelope/`
}
