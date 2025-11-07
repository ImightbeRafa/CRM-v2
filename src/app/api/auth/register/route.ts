import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { createDefaultOrderStatuses } from '@/lib/default-statuses';
import { sendVerificationEmail } from '@/lib/email';
import { v4 as uuidv4 } from 'uuid';

// Disable body parsing since we need the raw body for webhook verification
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();

    // Validate input
    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      );
    }

    // Normalize email first
    const normalizedEmail = email.trim().toLowerCase();

    // Check if user already exists (with normalized email)
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);
    const emailPrefix = normalizedEmail.split('@')[0];
    const tenantSlug = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();

    // Create user with tenant and membership in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create tenant first
      const tenant = await tx.tenant.create({
        data: {
          name: `${name}'s Organization`,
          slug: tenantSlug,
          plan: 'FREE',
          isActive: true,
          trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) // 15 days trial
        }
      });

      // 2. Create user (active immediately to allow login)
      const user = await tx.user.create({
        data: {
          username: name,
          name: name,
          email: normalizedEmail,
          password: hashedPassword,
          active: true, // FIXED: Active immediately so user can log in
          emailVerified: null, // Email not verified yet, but doesn't block login
          defaultTenantId: tenant.id
        },
        select: {
          id: true,
          email: true,
          username: true,
          active: true
        }
      });

      // 3. Create membership with OWNER role
      await tx.membership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          role: 'OWNER',
          isActive: true,
          joinedAt: new Date()
        }
      });

      // 4. Create default order statuses for the new tenant
      try {
        await createDefaultOrderStatuses(tenant.id);
      } catch (statusError) {
        console.warn('Failed to create default order statuses:', statusError);
        // Don't fail registration if status creation fails
      }

      return { user, tenant };
    });

    // Send verification email (optional - doesn't block login)
    try {
      await sendVerificationEmail({
        email: normalizedEmail,
        name
      });
      console.log(`✅ Verification email sent to ${normalizedEmail}`);
    } catch (emailError) {
      console.error('⚠️ Failed to send verification email, but user can still log in:', emailError);
      // Don't fail registration if email fails - user can resend later
    }

    return NextResponse.json({
      success: true,
      message: 'Registration successful! You can now log in.',
      userId: result.user.id,
      tenantId: result.tenant.id,
      requiresVerification: false // Email verification is optional
    });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
