import { NextResponse } from 'next/server';

// Stripe removed. This endpoint is deprecated.
export async function POST() {
  return NextResponse.json({ error: 'Stripe removed. Use /api/tilopay/checkout.' }, { status: 410 });
}
