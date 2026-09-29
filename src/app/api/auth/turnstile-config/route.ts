import { NextResponse } from 'next/server';
import { turnstileSiteKey } from '@/lib/turnstile';

export const dynamic = 'force-dynamic';

/** Public: the Turnstile site key (null = Turnstile off). The site key is not a secret. */
export async function GET() {
  return NextResponse.json({ siteKey: turnstileSiteKey() }, { headers: { 'Cache-Control': 'no-store' } });
}
