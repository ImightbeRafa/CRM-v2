/**
 * Cloudflare Turnstile (bot check) for signup and password-reset requests, 2026-09-28.
 *
 * OFF unless BOTH runtime env vars exist: TURNSTILE_SITE_KEY (public) and TURNSTILE_SECRET_KEY.
 * The page fetches the site key at runtime (/api/auth/turnstile-config), never from a build-time
 * NEXT_PUBLIC_ var: a server that enforces while the client bundle lacks the widget would block
 * every signup. When ON, a missing or invalid token is refused (fail closed); if Cloudflare's
 * verify endpoint is unreachable the request is refused too (the form says to retry).
 */
import 'server-only'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function turnstileSiteKey(): string | null {
  const site = (process.env.TURNSTILE_SITE_KEY || '').trim()
  const secret = (process.env.TURNSTILE_SECRET_KEY || '').trim()
  return site && secret ? site : null
}

export function turnstileEnabled(): boolean {
  return turnstileSiteKey() !== null
}

export type TurnstileResult = { ok: true } | { ok: false; error: string }

export async function verifyTurnstile(
  token: unknown,
  ip?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  if (!turnstileEnabled()) return { ok: true }
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return { ok: false, error: 'Completa la verificación de seguridad.' }
  }
  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!.trim(), response: token })
    if (ip && ip !== 'unknown' && ip !== 'trusted-header-missing' && !ip.includes('/')) body.set('remoteip', ip)
    const res = await fetchImpl(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000), cache: 'no-store' })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean }
    return data.success === true ? { ok: true } : { ok: false, error: 'La verificación de seguridad falló. Intenta de nuevo.' }
  } catch {
    return { ok: false, error: 'No pudimos completar la verificación de seguridad. Intenta de nuevo.' }
  }
}
