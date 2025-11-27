/**
 * Bot Session Management
 * 
 * Handles creation, lookup, and management of BotSession records
 * that link Telegram/WhatsApp chat IDs to Betsy users and tenants.
 */

import { prisma } from '@/lib/db';
import { SignJWT, jwtVerify } from 'jose';

// JWT secret for magic link tokens
const BOT_JWT_SECRET = new TextEncoder().encode(
  process.env.BOT_JWT_SECRET || process.env.NEXTAUTH_SECRET || 'betsy-bot-secret-key'
);

// Token expiration time (15 minutes)
const TOKEN_EXPIRATION = '15m';

export interface BotSessionData {
  id: string;
  platform: 'telegram' | 'whatsapp';
  platformId: string;
  userId: string;
  tenantId: string;
  displayName: string | null;
  username: string | null;
  isActive: boolean;
  connectedAt: Date;
}

export interface ConnectionTokenPayload {
  userId: string;
  tenantId: string;
  userName: string;
  platform: 'telegram' | 'whatsapp';
  exp?: number;
}

/**
 * Generate a JWT token for bot connection magic link
 * Contains user and tenant info that will be used when user clicks the link
 */
export async function generateConnectionToken(
  userId: string,
  tenantId: string,
  userName: string,
  platform: 'telegram' | 'whatsapp' = 'telegram'
): Promise<string> {
  const token = await new SignJWT({
    userId,
    tenantId,
    userName,
    platform,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRATION)
    .sign(BOT_JWT_SECRET);
  
  return token;
}

/**
 * Verify and decode a connection token
 * Returns null if token is invalid or expired
 */
export async function verifyConnectionToken(
  token: string
): Promise<ConnectionTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, BOT_JWT_SECRET);
    return payload as ConnectionTokenPayload;
  } catch (error) {
    console.error('[BotSession] Token verification failed:', error);
    return null;
  }
}

/**
 * Create or update a bot session when user connects via magic link
 */
export async function createBotSession(
  platform: 'telegram' | 'whatsapp',
  platformId: string,
  userId: string,
  tenantId: string,
  metadata?: {
    displayName?: string;
    username?: string;
  }
): Promise<BotSessionData> {
  // Upsert - create if not exists, update if exists
  const session = await prisma.botSession.upsert({
    where: {
      platform_platformId: {
        platform,
        platformId,
      },
    },
    create: {
      platform,
      platformId,
      userId,
      tenantId,
      displayName: metadata?.displayName || null,
      username: metadata?.username || null,
      isActive: true,
    },
    update: {
      userId,
      tenantId,
      displayName: metadata?.displayName || null,
      username: metadata?.username || null,
      isActive: true,
      connectedAt: new Date(), // Update connection time on reconnect
    },
  });
  
  console.log(`[BotSession] Created/updated session for ${platform}:${platformId} -> tenant:${tenantId}`);
  
  return session as BotSessionData;
}

/**
 * Find a bot session by platform and chat ID
 * Returns null if not found or inactive
 */
export async function findBotSession(
  platform: 'telegram' | 'whatsapp',
  platformId: string
): Promise<BotSessionData | null> {
  const session = await prisma.botSession.findUnique({
    where: {
      platform_platformId: {
        platform,
        platformId,
      },
    },
  });
  
  if (!session || !session.isActive) {
    return null;
  }
  
  return session as BotSessionData;
}

/**
 * Find all bot sessions for a user
 */
export async function findUserBotSessions(
  userId: string
): Promise<BotSessionData[]> {
  const sessions = await prisma.botSession.findMany({
    where: {
      userId,
      isActive: true,
    },
    orderBy: {
      connectedAt: 'desc',
    },
  });
  
  return sessions as BotSessionData[];
}

/**
 * Find all bot sessions for a tenant
 */
export async function findTenantBotSessions(
  tenantId: string
): Promise<BotSessionData[]> {
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
          username: true,
          name: true,
        },
      },
    },
    orderBy: {
      connectedAt: 'desc',
    },
  });
  
  return sessions as unknown as BotSessionData[];
}

/**
 * Deactivate a bot session (disconnect)
 */
export async function deactivateBotSession(
  platform: 'telegram' | 'whatsapp',
  platformId: string
): Promise<boolean> {
  try {
    await prisma.botSession.update({
      where: {
        platform_platformId: {
          platform,
          platformId,
        },
      },
      data: {
        isActive: false,
      },
    });
    
    console.log(`[BotSession] Deactivated session for ${platform}:${platformId}`);
    return true;
  } catch (error) {
    console.error('[BotSession] Failed to deactivate session:', error);
    return false;
  }
}

/**
 * Deactivate a bot session by ID
 */
export async function deactivateBotSessionById(
  sessionId: string
): Promise<boolean> {
  try {
    await prisma.botSession.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
    
    console.log(`[BotSession] Deactivated session ${sessionId}`);
    return true;
  } catch (error) {
    console.error('[BotSession] Failed to deactivate session:', error);
    return false;
  }
}

/**
 * Get session with user and tenant details
 * Used for full context when processing bot messages
 */
export async function getBotSessionWithContext(
  platform: 'telegram' | 'whatsapp',
  platformId: string
) {
  const session = await prisma.botSession.findUnique({
    where: {
      platform_platformId: {
        platform,
        platformId,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          memberships: {
            where: { isActive: true },
            select: {
              role: true,
              tenantId: true,
            },
          },
        },
      },
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          isActive: true,
        },
      },
    },
  });
  
  if (!session || !session.isActive) {
    return null;
  }
  
  // Get the membership role for this tenant
  const membership = session.user.memberships.find(
    (m) => m.tenantId === session.tenantId
  );
  
  return {
    session,
    user: session.user,
    tenant: session.tenant,
    role: membership?.role || 'VIEWER',
  };
}

