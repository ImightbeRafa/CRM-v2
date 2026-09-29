import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Resend } from 'resend';
import { escapeHtml, generateResetToken, hashResetToken, RESET_TOKEN_TTL_MS } from '@/lib/password-reset';
import { authRateLimit, getClientIP } from '@/lib/rate-limit';
import { verifyTurnstile } from '@/lib/turnstile';
import { findUserIdByEmail } from '@/lib/user-lookup';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult instanceof Response) return rateLimitResult;

  try {
    const { email, turnstileToken } = await request.json();

    // Bot check before any lookup (no-op until Turnstile keys are set).
    const human = await verifyTurnstile(turnstileToken, getClientIP(request));
    if (!human.ok) {
      return NextResponse.json({ error: human.error, code: 'turnstile' }, { status: 400 });
    }

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' },
        { status: 200 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Exact match (no ILIKE wildcards), see user-lookup.ts.
    const user = await prisma.user.findUnique({
      where: { id: (await findUserIdByEmail(normalizedEmail)) ?? '' },
      select: { id: true, email: true, username: true, name: true, provider: true, active: true },
    });

    // Always return success to prevent email enumeration (OWASP A07)
    if (!user || user.active === false) {
      return NextResponse.json(
        { message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' },
        { status: 200 }
      );
    }

    // OAuth-only accounts cannot reset password
    if (user.provider && user.provider !== 'credentials') {
      return NextResponse.json(
        { message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' },
        { status: 200 }
      );
    }

    // Only the hash is stored; the raw token lives in the email link.
    const token = generateResetToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await prisma.$executeRaw`
      UPDATE "User"
      SET "passwordResetToken" = ${hashResetToken(token)},
          "passwordResetTokenExpires" = ${expiresAt}
      WHERE id = ${user.id}
    `;

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      (process.env.NODE_ENV === 'production'
        ? 'https://betsycrm.com'
        : 'http://localhost:3000');

    const resetUrl = `${baseUrl}/auth/reset-password?token=${token}`;

    await resend.emails.send({
      from: 'BetsyCRM <noreply@betsycrm.com>',
      to: user.email,
      subject: 'Restablecer tu contraseña - BetsyCRM',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Restablecer contraseña</h2>
          <p>Hola ${escapeHtml(user.name || user.username || '')},</p>
          <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta en BetsyCRM.</p>
          <p>
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; font-weight: bold;">
              Restablecer contraseña
            </a>
          </p>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p style="word-break: break-all; color: #3b82f6;">${resetUrl}</p>
          <p>Este enlace expirará en <strong>30 minutos</strong> y solo sirve una vez.</p>
          <p>Si no solicitaste este cambio, puedes ignorar este correo de forma segura. Tu contraseña no será modificada.</p>
          <p>¡Gracias!<br>El equipo de BetsyCRM</p>
        </div>
      `,
    });

    return NextResponse.json(
      { message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' },
      { status: 200 }
    );
  }
}
