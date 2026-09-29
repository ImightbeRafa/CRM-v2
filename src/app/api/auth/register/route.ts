import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { hashPassword, validatePasswordStrength, verifyPassword, isBcryptHash } from '@/lib/password';
import { sendVerificationEmail } from '@/lib/email';
import { withoutTenantIsolation } from '@/lib/tenantContext';
import { authRateLimit, getClientIP } from '@/lib/rate-limit';
import { verifyTurnstile } from '@/lib/turnstile';
import { findUserIdByEmail } from '@/lib/user-lookup';
import { burnPasswordCheck, releaseLoginAttempt, reserveLoginAttempt } from '@/lib/auth-gates';
import { sendCAPIEvent } from '@/lib/meta-capi';
import { provisionOwnedTenantForExistingUser } from '@/lib/tenant-provisioning';
import { acceptTeamInviteForUser, findInviteForPresentedToken, findPendingInviteForEmail } from '@/lib/team-invite-service';
import { TEAM_INVITE_COOKIE, canAutoAcceptInvite, inviteTokenMatches } from '@/lib/team-invite';

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult instanceof Response) return rateLimitResult;

  try {
    const { name, email, password, businessName, phone, country, province, inviteToken, turnstileToken } = await request.json();

    // Bot check (no-op until TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY are set).
    const human = await verifyTurnstile(turnstileToken, getClientIP(request));
    if (!human.ok) {
      return NextResponse.json({ error: human.error, code: 'turnstile' }, { status: 400 });
    }

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
    // Exact match (no ILIKE wildcards), see user-lookup.ts.
    const existingUser = await prisma.user.findUnique({
      where: { id: (await findUserIdByEmail(normalizedEmail)) ?? '' },
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
      // Claiming a business re-checks the password: it goes through the login lockout and always
      // costs one bcrypt, so this path is neither a password oracle nor a timing oracle (L2).
      const existingPassword = existingUser.password;
      const ip = getClientIP(request);
      const locked = (await reserveLoginAttempt(normalizedEmail, ip)).locked;
      let passwordOk = false;
      if (!locked && existingPassword && isBcryptHash(existingPassword)) {
        passwordOk = await verifyPassword(password, existingPassword);
      } else {
        await burnPasswordCheck(password);
      }
      if (passwordOk) await releaseLoginAttempt(normalizedEmail, ip);
      const canClaimOwnTenant =
        existingUser.active !== false &&
        existingUser.memberships.length === 0 &&
        passwordOk;

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
        { success: true, message: 'Registro recibido. Revisa tu email para verificar la cuenta.' },
        { status: 200 }
      );
    }

    const hashedPassword = await hashPassword(password);
    const emailPrefix = normalizedEmail.split('@')[0];

    // Invite path: never create an orphan owned tenant when a pending invite exists.
    try {
      const pending = await findPendingInviteForEmail(normalizedEmail)
      if (pending) {
        // Only the holder of the emailed invite link joins right away (the accept-invite page sets
        // the cookie). Anyone else who merely knows the address gets an unverified account with no
        // business; the invite waits until they verify the mailbox (verify-email accepts it).
        const presentedToken = (typeof inviteToken === 'string' && inviteToken) || cookieValue(request, TEAM_INVITE_COOKIE);
        // The invite this token names (not simply the newest one for the address).
        const held = await findInviteForPresentedToken(presentedToken, normalizedEmail);
        const invite = held ?? pending;
        const viaToken = !!held && inviteTokenMatches(presentedToken, held.token);
        const invitedUser = await prisma.user.create({
          data: {
            username: name,
            name: name,
            email: normalizedEmail,
            password: hashedPassword,
            active: true,
            emailVerified: null,
            defaultTenantId: viaToken ? invite.tenantId : null,
          },
          select: { id: true, email: true },
        })
        if (!canAutoAcceptInvite({ viaToken, emailVerified: false })) {
          try {
            await sendVerificationEmail({ email: normalizedEmail, name })
          } catch {}
          return NextResponse.json(
            { success: true, inviteLinkRequired: true, message: 'Cuenta creada. Para unirte al equipo que te invitó, abre el enlace de la invitación que te llegó por email.' },
            { status: 201 },
          )
        }
        const accepted = await acceptTeamInviteForUser({
          emailProven: true,
          token: invite.token,
          userId: invitedUser.id,
          userEmail: normalizedEmail,
        })
        if (!accepted.ok) {
          return NextResponse.json({ error: accepted.error }, { status: accepted.status })
        }
        try {
          await sendVerificationEmail({ email: normalizedEmail, name })
        } catch {}
        return NextResponse.json(
          { success: true, message: `Te uniste a ${accepted.tenantName}. Revisa tu email para verificar la cuenta.`, joinedTenantId: accepted.tenantId },
          { status: 201 },
        )
      }
    } catch (inviteErr) {
      console.warn('[register] TenantInvite lookup/accept skipped:', inviteErr)
    }

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
      message: 'Registro recibido. Revisa tu email para verificar la cuenta.',
    });

  } catch (error: any) {
    console.error('Registration error:', error?.message, error?.code);
    
    return NextResponse.json(
      { error: error?.message || 'Registration failed. Please try again.' },
      { status: 500 }
    );
  }
}
