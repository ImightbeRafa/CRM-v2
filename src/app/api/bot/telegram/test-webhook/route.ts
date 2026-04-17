/**
 * Development-only diagnostic endpoint for Telegram webhook setup.
 */

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  console.log('[telegram-test-webhook] POST called at', new Date().toISOString());

  try {
    const body = await request.json();
    console.log('[telegram-test-webhook] Body received:', JSON.stringify(body).substring(0, 200));

    return NextResponse.json({
      ok: true,
      message: 'Test webhook working',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[telegram-test-webhook] Error:', error.message);
    return NextResponse.json({
      ok: false,
      error: 'Test webhook failed',
    });
  }
}

export async function GET(_request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    message: 'Test webhook GET endpoint',
    timestamp: new Date().toISOString(),
  });
}
