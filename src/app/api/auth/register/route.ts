import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { sendVerificationEmail } from '@/lib/email';
import { withoutTenantIsolation } from '@/lib/tenantContext';

// Disable body parsing since we need the raw body for webhook verification
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();
    console.log('📝 Registration request received:', { name, email: email.substring(0, 3) + '***' });

    // Validate input
    if (!name || !email || !password) {
      console.warn('⚠️ Missing required fields');
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      );
    }

    // Normalize email first
    const normalizedEmail = email.trim().toLowerCase();
    console.log('📧 Normalized email:', normalizedEmail.substring(0, 3) + '***');

    // Check if user already exists (with normalized email)
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      console.warn('⚠️ User already exists:', normalizedEmail);
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    console.log('🔒 Hashing password...');
    const hashedPassword = await hashPassword(password);
    const emailPrefix = normalizedEmail.split('@')[0];
    const tenantSlug = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
    console.log('🏢 Tenant slug generated:', tenantSlug);

    // Create user with tenant and membership in a transaction
    // Use withoutTenantIsolation since this is a system operation creating a new tenant
    console.log('🔄 Starting transaction...');
    const result = await withoutTenantIsolation(async () => {
      return await prisma.$transaction(async (tx) => {
      // 1. Create tenant first
      console.log('  1️⃣ Creating tenant...');
      const tenant = await tx.tenant.create({
        data: {
          name: `${name}'s Organization`,
          slug: tenantSlug,
          plan: 'FREE',
          isActive: true,
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days trial
        }
      });
      console.log('  ✅ Tenant created:', tenant.id);

      // 2. Create user (active immediately to allow login)
      console.log('  2️⃣ Creating user...');
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
      console.log('  ✅ User created:', user.id);

      // 3. Create membership with OWNER role
      console.log('  3️⃣ Creating membership...');
      await tx.membership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          role: 'OWNER',
          isActive: true,
          joinedAt: new Date()
        }
      });
      console.log('  ✅ Membership created');

      // 4. Create default order statuses directly in transaction
      console.log('  4️⃣ Creating default order statuses...');
      const defaultStatuses = [
        { key: 'pendiente', label: 'Pendiente', color: '#FCD34D', order: 0 },
        { key: 'en-proceso', label: 'En Proceso', color: '#60A5FA', order: 1 },
        { key: 'urgente', label: 'Urgente', color: '#EF4444', order: 2 },
        { key: 'completado', label: 'Completado', color: '#10B981', order: 3 },
        { key: 'enviado', label: 'Enviado', color: '#A855F7', order: 4 },
        { key: 'entregado', label: 'Entregado', color: '#059669', order: 5 },
      ];

      await tx.orderStatus.createMany({
        data: defaultStatuses.map(status => ({
          ...status,
          tenantId: tenant.id,
          isActive: true,
        })),
        skipDuplicates: true
      });
      console.log('  ✅ Order statuses created');

      return { user, tenant };
      });
    });
    console.log('✅ Transaction completed successfully');

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

  } catch (error: any) {
    console.error('❌ Registration error:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack
    });
    
    // Return more specific error message in development
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error?.message || 'Registration failed'
      : 'Registration failed. Please try again.';
    
    return NextResponse.json(
      { 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined 
      },
      { status: 500 }
    );
  }
}
