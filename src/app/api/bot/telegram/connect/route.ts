/**
 * Telegram Bot Connection API
 * 
 * Generates magic link tokens for connecting Telegram accounts to Betsy.
 * Users click the link, which opens Telegram with the /start command and token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateConnectionToken } from '@/lib/bot/bot-session';
import { generateDeepLink } from '@/lib/bot/telegram';
import { prisma } from '@/lib/db';
import { authenticateAPI } from '@/lib/auth-helpers';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

/**
 * POST - Generate a connection link for the current user
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    const { tenantId, userId } = auth;
    
    // Get user details
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
      },
    });
    
    if (!user) {
      return NextResponse.json(
        { error: 'User not found', message: 'Usuario no encontrado' },
        { status: 404 }
      );
    }
    
    const userName = user.name || user.username || user.email || 'Usuario';
    
    // Generate connection token (JWT)
    const connectionToken = await generateConnectionToken(
      user.id,
      tenantId,
      userName,
      'telegram'
    );
    
    // Generate Telegram deep link
    const deepLink = generateDeepLink(connectionToken);
    
    console.log(`[Bot Connect] Generated link for user ${user.id} in tenant ${tenantId}`);
    
    return NextResponse.json({
      status: 'success',
      data: {
        deepLink,
        expiresIn: '15 minutes',
        instructions: [
          'Haz clic en el enlace para abrir Telegram',
          'Presiona "Start" o "Iniciar" en el bot',
          '¡Listo! Tu cuenta quedará vinculada automáticamente',
        ],
      },
    });
  } catch (error: any) {
    console.error('[Bot Connect] Error:', error);
    return NextResponse.json(
      { error: 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * GET - Get connection status for current user
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    const { tenantId, userId } = auth;
    
    // Get bot sessions for this user
    const sessions = await prisma.botSession.findMany({
      where: {
        userId,
        tenantId,
        isActive: true,
      },
      select: {
        id: true,
        platform: true,
        platformId: true,
        displayName: true,
        username: true,
        connectedAt: true,
        isActive: true,
      },
      orderBy: {
        connectedAt: 'desc',
      },
    });
    
    const telegramSession = sessions.find((s) => s.platform === 'telegram');
    
    return NextResponse.json({
      status: 'success',
      data: {
        telegram: telegramSession ? {
          connected: true,
          displayName: telegramSession.displayName,
          username: telegramSession.username,
          connectedAt: telegramSession.connectedAt,
          sessionId: telegramSession.id,
        } : {
          connected: false,
        },
        // Placeholder for future WhatsApp support
        whatsapp: {
          connected: false,
          comingSoon: true,
        },
      },
    });
  } catch (error: any) {
    console.error('[Bot Connect] Error getting status:', error);
    return NextResponse.json(
      { error: 'Server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Disconnect a bot session
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authenticateAPI(request);
    if (!auth.ok) return auth.response;
    const { tenantId, userId } = auth;
    
    const { searchParams } = new URL(request.url);
    const platform = searchParams.get('platform') || 'telegram';
    
    // Find and deactivate the session
    const session = await prisma.botSession.findFirst({
      where: {
        userId,
        tenantId,
        platform,
        isActive: true,
      },
    });
    
    if (!session) {
      return NextResponse.json(
        { error: 'Not found', message: 'No hay sesión activa para desconectar' },
        { status: 404 }
      );
    }
    
    await prisma.botSession.update({
      where: { id: session.id },
      data: { isActive: false },
    });
    
    console.log(`[Bot Connect] Disconnected ${platform} session for authenticated user`);
    
    return NextResponse.json({
      status: 'success',
      message: `${platform} desconectado exitosamente`,
    });
  } catch (error: any) {
    console.error('[Bot Connect] Error disconnecting:', error);
    return NextResponse.json(
      { error: 'Server error' },
      { status: 500 }
    );
  }
}

