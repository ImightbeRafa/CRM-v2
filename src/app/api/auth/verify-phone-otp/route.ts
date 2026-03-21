import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { verifyOTP, MAX_ATTEMPTS } from '@/lib/otp';
import { rateLimit, getClientIP } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = rateLimit(ip, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 10,
    identifier: 'verify-phone-otp',
  });

  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
      { status: 429, headers: rl.headers }
    );
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const tenantId = (session.user as any).tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 400 });
    }

    const { code } = (await request.json()) as { code?: string };

    if (!code || !/^\d{6}$/.test(code)) {
      return NextResponse.json(
        { error: 'Código inválido. Debe ser de 6 dígitos.' },
        { status: 400 }
      );
    }

    const tenant = await (prisma.tenant.findUnique as any)({
      where: { id: tenantId },
      select: {
        id: true,
        phoneVerified: true,
        phoneVerificationCode: true,
        phoneVerificationCodeExpires: true,
        phoneVerificationAttempts: true,
      },
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });
    }

    if (tenant.phoneVerified) {
      return NextResponse.json({ error: 'El teléfono ya está verificado' }, { status: 400 });
    }

    if (!tenant.phoneVerificationCode || !tenant.phoneVerificationCodeExpires) {
      return NextResponse.json(
        { error: 'No hay código de verificación pendiente. Solicita uno nuevo.' },
        { status: 400 }
      );
    }

    if (tenant.phoneVerificationAttempts >= MAX_ATTEMPTS) {
      await (prisma.tenant.update as any)({
        where: { id: tenantId },
        data: {
          phoneVerificationCode: null,
          phoneVerificationCodeExpires: null,
          phoneVerificationAttempts: 0,
        },
      });

      return NextResponse.json(
        { error: 'Máximo de intentos alcanzado. Solicita un nuevo código.' },
        { status: 400 }
      );
    }

    if (new Date() > new Date(tenant.phoneVerificationCodeExpires)) {
      await (prisma.tenant.update as any)({
        where: { id: tenantId },
        data: {
          phoneVerificationCode: null,
          phoneVerificationCodeExpires: null,
          phoneVerificationAttempts: 0,
        },
      });

      return NextResponse.json(
        { error: 'El código ha expirado. Solicita uno nuevo.' },
        { status: 400 }
      );
    }

    const isValid = verifyOTP(code, tenant.phoneVerificationCode);

    if (!isValid) {
      const newAttempts = (tenant.phoneVerificationAttempts || 0) + 1;
      await (prisma.tenant.update as any)({
        where: { id: tenantId },
        data: { phoneVerificationAttempts: newAttempts },
      });

      const remaining = MAX_ATTEMPTS - newAttempts;
      return NextResponse.json(
        {
          error: `Código incorrecto. ${remaining > 0 ? `Te quedan ${remaining} intento${remaining === 1 ? '' : 's'}.` : 'Solicita un nuevo código.'}`,
        },
        { status: 400 }
      );
    }

    await (prisma.tenant.update as any)({
      where: { id: tenantId },
      data: {
        phoneVerified: true,
        phoneVerifiedAt: new Date(),
        phoneVerificationCode: null,
        phoneVerificationCodeExpires: null,
        phoneVerificationAttempts: 0,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Teléfono verificado exitosamente',
    });
  } catch (error: any) {
    console.error('[PhoneOTP] verify error:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
