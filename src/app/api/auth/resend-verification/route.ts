import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendVerificationEmail } from '@/lib/email';
import { authRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// One answer for every case (unknown, verified, deactivated, sent, send failed): the response
// never tells a caller whether an account exists for an address.
const GENERIC = {
  success: true,
  message: 'Si existe una cuenta con ese email, te enviamos un nuevo enlace de verificación.',
};

export async function POST(request: NextRequest) {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult instanceof Response) return rateLimitResult;

  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      select: { id: true, email: true, username: true, emailVerified: true, active: true },
    });

    // Deactivated accounts get nothing (verifying never re-enables them anyway).
    if (!user || user.emailVerified || user.active === false) {
      return NextResponse.json(GENERIC, { status: 200 });
    }

    const emailResult = await sendVerificationEmail({
      email: user.email,
      name: user.username || undefined,
    });
    if (!emailResult.success) {
      console.error('[resend-verification] send failed:', emailResult.error);
    }
    return NextResponse.json(GENERIC, { status: 200 });
  } catch (error) {
    console.error('Resend verification error:', error);
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}
