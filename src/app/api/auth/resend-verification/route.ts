import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendVerificationEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
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

    // If email is already verified, inform the user
    if (user.emailVerified) {
      return NextResponse.json(
        { 
          success: true,
          message: 'This email has already been verified. You can sign in.' 
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

