import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getMembershipForToken } from '@/lib/selected-tenant';

/** Retired client-priced checkout. Use the server-priced hosted checkout. */
export async function POST(request: NextRequest) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.sub) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const membership = await getMembershipForToken(token);
  if (!membership) return NextResponse.json({ error: 'Selected tenant not found' }, { status: 403 });
  if (membership.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only the tenant owner can manage billing' }, { status: 403 });
  }
  return NextResponse.json({
    error: 'This checkout path has been retired. Use /api/tilopay/create-plan-repeat.',
    code: 'checkout_path_retired',
  }, { status: 410 });
}
