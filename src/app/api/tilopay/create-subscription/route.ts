import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getMembershipForToken } from '@/lib/selected-tenant';

/** Retired because paid access must be activated by a verified webhook. */
export async function POST(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await getMembershipForToken(token);
  if (!membership) {
    return NextResponse.json({ error: 'Selected tenant membership not found' }, { status: 403 });
  }
  if (membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only the tenant owner can manage billing' }, { status: 403 });
  }

  return NextResponse.json({
    error: 'This payment flow has been retired. Use hosted Tilopay checkout.',
    code: 'payment_flow_retired',
  }, { status: 410 });
}
