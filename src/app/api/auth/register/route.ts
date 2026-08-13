import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { hashPassword, validatePasswordStrength, verifyPassword, isBcryptHash } from '@/lib/password';
import { sendVerificationEmail } from '@/lib/email';
import { withoutTenantIsolation } from '@/lib/tenantContext';
import { authRateLimit } from '@/lib/rate-limit';
import { sendCAPIEvent } from '@/lib/meta-capi';
import { provisionOwnedTenantForExistingUser } from '@/lib/tenant-provisioning';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult instanceof Response) return rateLimitResult;

  try {
    const { name, email, password, businessName, phone, country, province } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      );
    }

    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      return NextResponse.json(
        { error: passwordCheck.errors.join('. ') },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await prisma.user.findFirst({
      where: { 
        email: { 
          equals: normalizedEmail, 
          mode: 'insensitive' 
        } 
      },
      select: {
        id: true,
        email: true,
        name: true,
        username: true,
        password: true,
        active: true,
        memberships: {
          where: { isActive: true },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (existingUser) {
      const existingPassword = existingUser.password;
      const canClaimOwnTenant =
        existingUser.active !== false &&
        existingUser.memberships.length === 0 &&
        !!existingPassword &&
        isBcryptHash(existingPassword) &&
        await verifyPassword(password, existingPassword);

      if (canClaimOwnTenant) {
        await withoutTenantIsolation(async () => {
          await prisma.$transaction(async (tx) => {
            await provisionOwnedTenantForExistingUser(tx, {
              userId: existingUser.id,
              email: existingUser.email,
              displayName: name || existingUser.name || existingUser.username || normalizedEmail.split('@')[0],
              businessName: businessName || null,
              phone: phone || null,
              country: country || null,
              province: province || null,
            });
          });
        });
      }

      return NextResponse.json(
        { success: true, message: 'Registration successful! Please check your email to verify your account.' },
        { status: 200 }
      );
    }

    const hashedPassword = await hashPassword(password);
    const emailPrefix = normalizedEmail.split('@')[0];
    const tenantSlug = emailPrefix.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();

    const result = await withoutTenantIsolation(async () => {
      return await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: businessName || `${name}'s Organization`,
          slug: tenantSlug,
          plan: 'FREE',
          isActive: true,
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          businessName: businessName || null,
          ownerName: name,
          phone: phone || null,
          country: country || null,
          province: province || null,
          profileCompleted: !!(phone && country),
        }
      });

      const user = await tx.user.create({
        data: {
          username: name,
          name: name,
          email: normalizedEmail,
          password: hashedPassword,
          active: true,
          emailVerified: null,
          defaultTenantId: tenant.id
        },
        select: {
          id: true,
          email: true,
          username: true,
          active: true
        }
      });

      await tx.membership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          role: 'OWNER',
          isActive: true,
          joinedAt: new Date()
        }
      });

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

      return { user, tenant };
      });
    });

    try {
      await sendVerificationEmail({ email: normalizedEmail, name });
    } catch (emailError) {
      console.error('Failed to send verification email (non-blocking):', emailError);
    }

    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
    const clientUa = request.headers.get('user-agent') || '';
    const eventId = request.headers.get('x-event-id') || crypto.randomUUID();

    sendCAPIEvent({
      eventName: 'CompleteRegistration',
      eventId,
      email: normalizedEmail,
      phone: phone || undefined,
      firstName,
      lastName: lastName || undefined,
      clientIpAddress: clientIp,
      clientUserAgent: clientUa,
    });

    sendCAPIEvent({
      eventName: 'StartTrial',
      eventId: crypto.randomUUID(),
      email: normalizedEmail,
      firstName,
      lastName: lastName || undefined,
      clientIpAddress: clientIp,
      clientUserAgent: clientUa,
    });

    return NextResponse.json({
      success: true,
      message: 'Registration successful! You can now log in.',
    });

  } catch (error: any) {
    console.error('Registration error:', error?.message, error?.code);
    
    return NextResponse.json(
      { error: error?.message || 'Registration failed. Please try again.' },
      { status: 500 }
    );
  }
}
