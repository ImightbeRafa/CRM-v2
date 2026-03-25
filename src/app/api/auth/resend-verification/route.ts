import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendVerificationEmail } from '@/lib/email';
import { authRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult instanceof Response) return rateLimitResult;

  try {
    const { email } = await request.json();

    // Validate input
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        username: true,
        emailVerified: true,
        active: true
      }
    });

    if (!user) {
      // Don't reveal if user exists or not for security
      return NextResponse.json(
        { 
          success: true,
          message: 'If an account exists with this email, a verification email has been sent.' 
        },
        { status: 200 }
      );
    }

    if (user.emailVerified) {
      return NextResponse.json(
        { 
          success: true,
          message: 'If an account exists with this email, a verification email has been sent.' 
        },
        { status: 200 }
      );
    }

    // Resend verification email
    console.log(`🔄 Resending verification email to: ${user.email}`);
    const emailResult = await sendVerificationEmail({
      email: user.email,
      name: user.username || undefined
    });

    if (!emailResult.success) {
      console.error('❌ Failed to send verification email:', emailResult.error);
      return NextResponse.json(
        { 
          error: emailResult.error || 'Failed to send verification email. Please try again later.' 
        },
        { status: 500 }
      );
    }

    console.log(`✅ Verification email sent successfully to: ${user.email}`);
    return NextResponse.json({
      success: true,
      message: 'Verification email sent! Please check your inbox.'
    });

  } catch (error) {
    console.error('Resend verification error:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}

