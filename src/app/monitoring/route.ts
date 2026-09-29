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

  // Streamed with a byte counter: a chunked upload without Content-Length stops at the cap.
  const body = await readCapped(request, MAX_ENVELOPE_BYTES);
  if (!body || body.byteLength === 0) return new NextResponse(null, { status: 413 });

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

async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
