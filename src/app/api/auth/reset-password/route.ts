import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword, validatePasswordStrength } from '@/lib/password';
import { authRateLimit } from '@/lib/rate-limit';
import { hashResetToken, legacyRawResetToken } from '@/lib/password-reset';
import { clearLoginFailures, clientIpFromHeaders } from '@/lib/auth-gates';
import { forgetUserAuthState, isMissingColumn } from '@/lib/session-revocation';

/**
 * One statement: check + consume the link + new password + end every session (sessionVersion + 1),
 * so a link works exactly once and no login that read the old password can outlive the reset
 * (SecureDog M1). The reset also proves the mailbox, so it verifies the email — but ONLY together
 * with the session bump: before migration 034 (no column) a squatter's live session could not be
 * ended, so the email stays unverified there (SecureDog H3).
 */
async function consumeResetLink(hashedPassword: string, tokenHash: string, legacy: string | null) {
  try {
    return await prisma.$queryRaw<Array<{ id: string; email: string }>>`
      UPDATE "User"
      SET password = ${hashedPassword},
          "passwordResetToken" = NULL,
          "passwordResetTokenExpires" = NULL,
          "emailVerified" = COALESCE("emailVerified", NOW()),
          "sessionVersion" = "sessionVersion" + 1,
          "passwordChangedAt" = NOW()
      WHERE ("passwordResetToken" = ${tokenHash} OR (${legacy}::text IS NOT NULL AND "passwordResetToken" = ${legacy}::text))
        AND "passwordResetTokenExpires" > NOW()
        AND active = true
      RETURNING id, email
    `;
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    // Pre-034: nothing was changed (the statement failed as a whole). Same, minus the new columns.
    return prisma.$queryRaw<Array<{ id: string; email: string }>>`
      UPDATE "User"
      SET password = ${hashedPassword},
          "passwordResetToken" = NULL,
          "passwordResetTokenExpires" = NULL
      WHERE ("passwordResetToken" = ${tokenHash} OR (${legacy}::text IS NOT NULL AND "passwordResetToken" = ${legacy}::text))
        AND "passwordResetTokenExpires" > NOW()
        AND active = true
      RETURNING id, email
    `;
  }
}

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

    const tokenHash = hashResetToken(token);
    const legacy = legacyRawResetToken(token);

    // Cheap check first: no bcrypt for dead links (unauthenticated CPU burn, SecureDog L6).
    const live = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "User"
      WHERE ("passwordResetToken" = ${tokenHash} OR (${legacy}::text IS NOT NULL AND "passwordResetToken" = ${legacy}::text))
        AND "passwordResetTokenExpires" > NOW()
        AND active = true
      LIMIT 1
    `;
    if (!live.length) {
      return NextResponse.json(
        { error: 'El enlace ha expirado o es inválido. Solicita uno nuevo.' },
        { status: 400 }
      );
    }

    const hashedPassword = await hashPassword(password);
    const users = await consumeResetLink(hashedPassword, tokenHash, legacy);

    if (!users || users.length === 0) {
      return NextResponse.json(
        { error: 'El enlace ha expirado o es inválido. Solicita uno nuevo.' },
        { status: 400 }
      );
    }

    forgetUserAuthState(users[0].id);

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
