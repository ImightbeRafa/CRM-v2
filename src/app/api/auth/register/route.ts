import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/password';
import { createDefaultOrderStatuses } from '@/lib/default-statuses';

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

    // Create tenant first
    const tenant = await prisma.tenant.create({
      data: {
        name: `${name}'s Organization`,
        slug: email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-'),
        plan: 'FREE',
        isActive: true,
        trialEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
      }
    });

    // Create user with membership
    const user = await prisma.user.create({
      data: {
        username: name,
        email,
        password: hashedPassword,
        active: true,
        defaultTenantId: tenant.id,
        memberships: {
          create: {
            tenantId: tenant.id,
            role: 'OWNER',
            isActive: true,
            joinedAt: new Date().toISOString()
          }
        }
      }
    });

    // Create default order statuses for the new tenant (non-blocking)
    try {
      await createDefaultOrderStatuses(tenant.id, tenant.name);
    } catch (statusError) {
      console.warn('Failed to create default order statuses for new tenant:', statusError);
      // Don't fail the registration process if status creation fails
    }

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
      }
    }, { status: 201 });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
