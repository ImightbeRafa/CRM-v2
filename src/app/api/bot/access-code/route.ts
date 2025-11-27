/**
 * Bot Access Code API
 * 
 * Handles generation and retrieval of bot access codes for team members
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/db';
import { generateUniqueBotAccessCode } from '@/lib/bot/access-code';

export const dynamic = 'force-dynamic';

/**
 * GET - Retrieve current bot access code and active sessions
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tenantId = (session.user as any).tenantId;
    
    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant found' },
        { status: 400 }
      );
    }

    // Get tenant with bot code
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        botAccessCode: true,
        name: true,
      },
    });

    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }

    // Get active bot sessions
    const sessions = await prisma.botSession.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        platform: true,
        displayName: true,
        providedName: true,
        username: true,
        connectedAt: true,
      },
      orderBy: {
        connectedAt: 'desc',
      },
    });

    return NextResponse.json({
      code: tenant.botAccessCode,
      tenantName: tenant.name,
      sessions,
    });
  } catch (error: any) {
    console.error('[Bot Access Code API] GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST - Generate or regenerate bot access code
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const tenantId = (session.user as any).tenantId;
    const userRole = (session.user as any).role;
    
    if (!tenantId) {
      return NextResponse.json(
        { error: 'No tenant found' },
        { status: 400 }
      );
    }

    // Only MASTER/OWNER can generate codes
    if (userRole !== 'MASTER' && userRole !== 'OWNER') {
      return NextResponse.json(
        { error: 'Only administrators can generate bot access codes' },
        { status: 403 }
      );
    }

    // Generate new unique code
    const code = await generateUniqueBotAccessCode(tenantId);

    // Log the action
    await prisma.auditLog.create({
      data: {
        action: 'bot_code_generated',
        userId: session.user.id,
        tenantId,
        details: {
          message: `Bot access code ${code ? 'regenerated' : 'generated'}`,
        },
      },
    });

    return NextResponse.json({
      code,
      message: 'Bot access code generated successfully',
    });
  } catch (error: any) {
    console.error('[Bot Access Code API] POST error:', error);
    return NextResponse.json(
      { error: 'Failed to generate bot access code' },
      { status: 500 }
    );
  }
}

