import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({ error: 'Stripe removed. Use /api/tilopay/webhook.' }, { status: 410 });
}
