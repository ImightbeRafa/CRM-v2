import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { authRateLimit } from '@/lib/rate-limit';

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

    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 6 caracteres.' },
        { status: 400 }
      );
    }

    const users: any[] = await prisma.$queryRaw`
      SELECT id, email FROM "User"
      WHERE "passwordResetToken" = ${token}
        AND "passwordResetTokenExpires" > NOW()
      LIMIT 1
    `;

    if (!users || users.length === 0) {
      return NextResponse.json(
        { error: 'El enlace ha expirado o es inválido. Solicita uno nuevo.' },
        { status: 400 }
      );
    }

    const user = users[0];
    const hashedPassword = await hashPassword(password);

    await prisma.$executeRaw`
      UPDATE "User"
      SET password = ${hashedPassword},
          "passwordResetToken" = NULL,
          "passwordResetTokenExpires" = NULL
      WHERE id = ${user.id}
    `;

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
