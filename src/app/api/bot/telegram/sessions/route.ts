/**
 * Bot Sessions Management API
 * 
 * Admin endpoint to view all bot sessions for a tenant.
 * Only accessible by OWNER and ADMIN roles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateAPI } from '@/lib/auth-helpers';
import { findTenantBotSessions } from '@/lib/bot/bot-session';
import { prisma } from '@/lib/db';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * GET - List all bot sessions for the tenant
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate and check permissions
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    
    const { tenantId, role } = auth;
    
    // Only OWNER and ADMIN can see all sessions
    if (!['OWNER', 'ADMIN'].includes(role)) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'No tienes permisos para ver las sesiones del bot' },
        { status: 403 }
      );
    }
    
    // Get all sessions for the tenant with user info
    const sessions = await prisma.botSession.findMany({
      where: {
        tenantId,
        isActive: true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: {
        connectedAt: 'desc',
      },
    });
    
    return NextResponse.json({
      status: 'success',
      data: sessions.map((s) => ({
        id: s.id,
        platform: s.platform,
        displayName: s.displayName,
        username: s.username,
        connectedAt: s.connectedAt,
        user: {
          id: s.user.id,
          email: s.user.email,
          name: s.user.name || s.user.username,
        },
      })),
    });
  } catch (error: any) {
    console.error('[Bot Sessions] Error:', error);
    return NextResponse.json(
      { error: 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Disconnect a specific session (admin)
 */
export async function DELETE(request: NextRequest) {
  try {
    // Authenticate and check permissions
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    
    const { tenantId, role } = auth;
    
    // Only OWNER and ADMIN can disconnect sessions
    if (!['OWNER', 'ADMIN'].includes(role)) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'No tienes permisos para desconectar sesiones' },
        { status: 403 }
      );
    }
    
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('sessionId');
    
    if (!sessionId) {
      return NextResponse.json(
        { error: 'Bad request', message: 'Se requiere sessionId' },
        { status: 400 }
      );
    }
    
    // Find the session and verify it belongs to this tenant
    const session = await prisma.botSession.findUnique({
      where: { id: sessionId },
    });
    
    if (!session || session.tenantId !== tenantId) {
      return NextResponse.json(
        { error: 'Not found', message: 'Sesión no encontrada' },
        { status: 404 }
      );
    }
    
    // Deactivate the session
    await prisma.botSession.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
    
    console.log(`[Bot Sessions] Admin disconnected session ${sessionId}`);
    
    return NextResponse.json({
      status: 'success',
      message: 'Sesión desconectada exitosamente',
    });
  } catch (error: any) {
    console.error('[Bot Sessions] Error:', error);
    return NextResponse.json(
      { error: 'Server error' },
      { status: 500 }
    );
  }
}

