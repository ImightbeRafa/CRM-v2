import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { generateOTP, hashOTP, getOTPExpiry } from '@/lib/otp';
import { sendWhatsAppTemplate } from '@/lib/bot/whatsapp';
import { sendOTPEmail } from '@/lib/email';
import { rateLimit, getClientIP } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const WHATSAPP_TEMPLATE_NAME = 'betsy_verification_code';
const WHATSAPP_TEMPLATE_LANG = 'es';

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, '');
}

function isValidE164(phone: string): boolean {
  return /^\d{7,15}$/.test(phone);
}

export async function POST(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = rateLimit(ip, {
    windowMs: 15 * 60 * 1000,
    maxRequests: 3,
    identifier: 'send-phone-otp',
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

    const body = await request.json();
    const { phone, method } = body as { phone?: string; method?: 'whatsapp' | 'email' };

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        phone: true,
        phoneVerified: true,
      },
    });

    if (!tenant) {
      return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 });
    }

    if (tenant.phoneVerified) {
      return NextResponse.json({ error: 'El teléfono ya está verificado' }, { status: 400 });
    }

    const targetPhone = phone || tenant.phone;
    if (!targetPhone) {
      return NextResponse.json(
        { error: 'Se requiere un número de teléfono' },
        { status: 400 }
      );
    }

    const normalized = normalizePhone(targetPhone);
    if (!isValidE164(normalized)) {
      return NextResponse.json(
        { error: 'Número de teléfono inválido' },
        { status: 400 }
      );
    }

    const otp = generateOTP();
    const hashed = hashOTP(otp);
    const expires = getOTPExpiry();

    await (prisma.tenant.update as any)({
      where: { id: tenantId },
      data: {
        phone: targetPhone,
        phoneVerificationCode: hashed,
        phoneVerificationCodeExpires: expires,
        phoneVerificationAttempts: 0,
      },
    });

    // Default to email until WhatsApp templates are approved in Meta Business Manager.
    // Once approved, change this default back to 'whatsapp'.
    let deliveryMethod: 'whatsapp' | 'email' = method || 'email';
    let sent = false;

    if (deliveryMethod === 'whatsapp') {
      const waResult = await sendWhatsAppTemplate(
        normalized,
        WHATSAPP_TEMPLATE_NAME,
        WHATSAPP_TEMPLATE_LANG,
        [otp]
      );

      if (waResult.success) {
        sent = true;
      } else {
        console.warn('[PhoneOTP] WhatsApp template failed, falling back to email:', waResult.error);
        deliveryMethod = 'email';
      }
    }

    if (deliveryMethod === 'email' && !sent) {
      const email = session.user.email;
      if (!email) {
        return NextResponse.json(
          { error: 'No se pudo enviar el código. No hay email ni WhatsApp disponible.' },
          { status: 500 }
        );
      }

      const emailResult = await sendOTPEmail({
        email,
        code: otp,
        name: session.user.name || undefined,
      });

      if (emailResult.success) {
        sent = true;
      } else {
        return NextResponse.json(
          { error: 'No se pudo enviar el código de verificación' },
          { status: 500 }
        );
      }
    }

    if (!sent) {
      return NextResponse.json(
        { error: 'No se pudo enviar el código de verificación' },
        { status: 500 }
      );
    }

    const maskedPhone = normalized.slice(0, 3) + '****' + normalized.slice(-2);

    return NextResponse.json({
      success: true,
      method: deliveryMethod,
      maskedPhone,
      expiresIn: 600,
    });
  } catch (error: any) {
    console.error('[PhoneOTP] send error:', error);
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
