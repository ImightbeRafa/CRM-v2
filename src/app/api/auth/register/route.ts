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

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user (inactive until email is verified)
    const user = await prisma.user.create({
      data: {
        username: name,
        email,
        password: hashedPassword,
        active: false // User is inactive until email is verified
      },
      select: {
        id: true,
        email: true,
        username: true,
        active: true
      }
    });

    // Send verification email (this will generate and save the token)
    await sendVerificationEmail({
      email,
      name
    });

    return NextResponse.json({
      success: true,
      message: 'Registration successful! Please check your email to verify your account.',
      userId: user.id,
      requiresVerification: true
    });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
