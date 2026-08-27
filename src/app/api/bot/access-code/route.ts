/**
 * Bot Access Code API
 * 
 * Handles generation and retrieval of bot access codes for team members
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateUniqueBotAccessCode } from '@/lib/bot/access-code';
import { authenticateAPIWithPermission } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET - Retrieve current bot access code and active sessions
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAPIWithPermission(request, 'view_config');
    if (!auth.ok) return auth.response;
    const { tenantId } = auth;

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
    const auth = await authenticateAPIWithPermission(request, 'update_config');
    if (!auth.ok) return auth.response;
    const { tenantId, role: userRole, userId } = auth;

    // Generate new unique code
    const code = await generateUniqueBotAccessCode(tenantId);

    // Log the action
    await prisma.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'BotAccessCode',
        entityId: tenantId,
        entityName: 'Bot Access Code',
        userId,
        userName: 'Authenticated user',
        userRole: userRole,
        tenantId,
        newValues: {
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

