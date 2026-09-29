import { NextResponse } from 'next/server';
import { getClientIP, rateLimit } from '@/lib/rate-limit';
import { sentryEnvelopeTarget } from '@/lib/sentry-tunnel';

export const dynamic = 'force-dynamic';

const MAX_ENVELOPE_BYTES = 1024 * 1024;

/**
 * Sentry tunnel (security, 2026-09-29). Browser error reports go through our domain (no Sentry
 * Allowed-Domains 403, no ad-blocker drops) — but only to OUR Sentry project, with only the envelope
 * body. The built-in rewrite tunnel forwarded every request header, including the session cookie,
 * to Sentry, and relayed to any Sentry project (SecureDog M6).
 */
export async function POST(request: Request) {
  if (!rateLimit(getClientIP(request), { windowMs: 60_000, maxRequests: 60, identifier: 'sentry-tunnel' }).allowed) {
    return new NextResponse(null, { status: 429 });
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_ENVELOPE_BYTES) return new NextResponse(null, { status: 413 });

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_ENVELOPE_BYTES) return new NextResponse(null, { status: 413 });

  const target = sentryEnvelopeTarget(body);
  if (!target) return new NextResponse(null, { status: 400 });

  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body,
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
      cache: 'no-store',
    });
    return new NextResponse(null, { status: upstream.status });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
