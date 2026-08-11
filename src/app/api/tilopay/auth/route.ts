import { NextResponse } from 'next/server';

/**
 * Tilopay merchant token endpoint — DISABLED.
 *
 * Previously returned the platform Tilopay access_token to any authenticated
 * session user. Merchant credentials must stay server-side (see getAccessToken
 * in src/lib/tilopay.ts). Clients must never receive this token.
 */
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint is disabled. Tilopay credentials are server-side only.' },
    { status: 403 },
  );
}

export async function GET() {
  return POST();
}
