import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

/**
 * Integration connectivity probe.
 * Disabled in production — was unauthenticated under /api/integration PUBLIC_ROUTES.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    message: 'Integration API is working!',
    timestamp: new Date().toISOString(),
    receivedFrom: req.headers.get('origin') || 'unknown',
  });
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const body = await req.json();
    return NextResponse.json({
      success: true,
      message: 'Integration API received your POST request!',
      timestamp: new Date().toISOString(),
      receivedFrom: req.headers.get('origin') || 'unknown',
      receivedData: body,
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to parse request body' },
      { status: 400 },
    );
  }
}
