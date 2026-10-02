import 'server-only';
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `Authorization: Bearer <CRON_SECRET>` (constant-time). Returns a response to send when denied. */
export function requireCronBearer(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  if (!safeEqual(request.headers.get('authorization') || '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/** `x-api-key: <expected>` (constant-time). */
export function requireApiKey(request: NextRequest, expected: string | undefined, label: string): NextResponse | null {
  if (!expected) return NextResponse.json({ error: `${label} not configured` }, { status: 500 });
  if (!safeEqual(request.headers.get('x-api-key') || '', expected)) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }
  return null;
}
