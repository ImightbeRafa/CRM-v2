import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword, validatePasswordStrength } from '@/lib/password';
import { authRateLimit } from '@/lib/rate-limit';
import { hashResetToken, legacyRawResetToken } from '@/lib/password-reset';
import { clearLoginFailures, clientIpFromHeaders } from '@/lib/auth-gates';
import { revokeUserSessions } from '@/lib/session-revocation';

export async function POST(request: Request) {
  const rateLimitResult = await authRateLimit(request);
  if (rateLimitResult instanceof Response) return rateLimitResult;

  try {
    const { token, password } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Token inválido o faltante.' },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json(
        { error: 'La contraseña es requerida.' },
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

    const hashedPassword = await hashPassword(password);
    const tokenHash = hashResetToken(token);
    const legacy = legacyRawResetToken(token);

    // One statement: check + consume + update, so a link works exactly once (no read-then-write
    // race). A reset also proves the mailbox, so it verifies the email (recovery path for users
    // blocked by email verification). Deactivated accounts cannot reset.
    const users = await prisma.$queryRaw<Array<{ id: string; email: string }>>`
      UPDATE "User"
      SET password = ${hashedPassword},
          "passwordResetToken" = NULL,
          "passwordResetTokenExpires" = NULL,
          "emailVerified" = COALESCE("emailVerified", NOW())
      WHERE ("passwordResetToken" = ${tokenHash} OR (${legacy}::text IS NOT NULL AND "passwordResetToken" = ${legacy}::text))
        AND "passwordResetTokenExpires" > NOW()
        AND active = true
      RETURNING id, email
    `;

    if (!users || users.length === 0) {
      return NextResponse.json(
        { error: 'El enlace ha expirado o es inválido. Solicita uno nuevo.' },
        { status: 400 }
      );
    }

    // New password: every existing session of this account ends (no-op before migration 034).
    await revokeUserSessions(users[0].id).catch((e) => console.error('[reset-password] revoke failed', e));

    await clearLoginFailures(
      users[0].email.toLowerCase(),
      clientIpFromHeaders(Object.fromEntries(request.headers)),
    ).catch(() => undefined);

    return NextResponse.json(
      { message: 'Contraseña actualizada exitosamente.' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { error: 'Error al restablecer la contraseña. Intenta de nuevo.' },
      { status: 500 }
    );
  }
}
