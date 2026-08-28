/**
 * Bot Session Management
 * 
 * Handles creation, lookup, and management of BotSession records
 * that link Telegram/WhatsApp chat IDs to Betsy users and tenants.
 */

import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { SignJWT, jwtVerify } from 'jose';
import { clearConversationHistory, clearPendingConfirmation } from './conversation-memory';
import { readBotInboxReadiness } from '@/lib/feature-flags';
import { getTenantSeatUsageWithClient } from '@/lib/plan-enforcement';
import { createHash } from 'crypto';

function sessionLogRef(platform: string, platformId: string) {
  return createHash('sha256').update(`${platform}:${platformId}`).digest('hex').slice(0, 12);
}

// JWT secret for magic link tokens (lazy-initialized to avoid crashing unrelated imports)
let _botJwtSecret: Uint8Array | null = null;
function getBotJwtSecret(): Uint8Array {
  if (!_botJwtSecret) {
    const val = process.env.BOT_JWT_SECRET || process.env.NEXTAUTH_SECRET || '';
    if (!val && process.env.NODE_ENV === 'production') {
      throw new Error('BOT_JWT_SECRET or NEXTAUTH_SECRET must be set in production');
    }
    _botJwtSecret = new TextEncoder().encode(val || 'dev-only-bot-secret');
  }
  return _botJwtSecret;
}

// Token expiration time (15 minutes)
const TOKEN_EXPIRATION = '15m';

export interface BotSessionData {
  id: string;
  platform: 'telegram' | 'whatsapp';
  platformId: string;
  userId: string | null; // Null for team members without Betsy accounts
  tenantId: string;
  providedName: string | null; // Name provided during setup (for audit)
  displayName: string | null;
  username: string | null;
  isActive: boolean;
  connectedAt: Date;
  accessRole: string | null;
  seatPolicy: string | null;
  grandfatheredAt: Date | null;
  seatOverageAt: Date | null;
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
    .sign(getBotJwtSecret());
  
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
    const { payload } = await jwtVerify(token, getBotJwtSecret());
    return payload as unknown as ConnectionTokenPayload;
  } catch (error) {
    console.error('[BotSession] Token verification failed:', error);
    return null;
  }
}

/**
 * Create or update a bot session
 * Supports both magic link (with userId) and code-based (without userId) connections
 */
export async function createBotSession(
  platform: 'telegram' | 'whatsapp',
  platformId: string,
  userId: string | null,
  tenantId: string,
  metadata?: {
    displayName?: string;
    username?: string;
    providedName?: string;
  }
): Promise<BotSessionData> {
  const rollout = await readBotInboxReadiness(tenantId);
  const result = await prisma.$transaction(async tx => {
    // Serialize bot-seat admission for this tenant. Serializable isolation also
    // makes the count and write one decision instead of a raceable preflight.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bot-seat:${tenantId}`}))`;
    const existing = await tx.botSession.findUnique({
      where: { platform_platformId: { platform, platformId } },
      select: {
        tenantId: true,
        userId: true,
        isActive: true,
        seatPolicy: true,
        grandfatheredAt: true,
      },
    });
    const tenantSwitched = Boolean(existing && existing.tenantId !== tenantId);
    const preservesGrandfathering = userId === null
      && existing?.tenantId === tenantId
      && existing.userId === null
      && existing.isActive
      && (existing.seatPolicy === null || existing.seatPolicy === 'GRANDFATHERED');
    const seatPolicy = userId ? 'LINKED' : preservesGrandfathering ? 'GRANDFATHERED' : 'COUNTED';
    const alreadyConsumesSeat = seatPolicy === 'COUNTED'
      && existing?.tenantId === tenantId
      && existing.userId === null
      && existing.isActive
      && existing.seatPolicy === 'COUNTED';
    let seatOverageAt: Date | null | undefined;
    if (seatPolicy === 'COUNTED' && !alreadyConsumesSeat) {
      const usage = await getTenantSeatUsageWithClient(tx, tenantId);
      const wouldExceed = usage.currentCount >= usage.limit;
      if (wouldExceed && rollout.seatMode === 'enforce') {
        const error = new Error('BOT_SEAT_LIMIT_REACHED');
        error.name = 'BotSeatLimitError';
        throw error;
      }
      seatOverageAt = wouldExceed ? new Date() : null;
    }

    const session = await tx.botSession.upsert({
      where: { platform_platformId: { platform, platformId } },
      create: {
        platform,
        platformId,
        userId,
        tenantId,
        providedName: metadata?.providedName || null,
        displayName: metadata?.displayName || null,
        username: metadata?.username || null,
        isActive: true,
        accessRole: 'BOT_OPERATOR',
        seatPolicy,
        grandfatheredAt: seatPolicy === 'GRANDFATHERED' ? new Date() : null,
        seatOverageAt: seatOverageAt ?? null,
      },
      update: {
        userId,
        tenantId,
        providedName: metadata?.providedName || null,
        displayName: metadata?.displayName || null,
        username: metadata?.username || null,
        isActive: true,
        connectedAt: new Date(),
        accessRole: 'BOT_OPERATOR',
        seatPolicy,
        grandfatheredAt: seatPolicy === 'GRANDFATHERED'
          ? existing?.grandfatheredAt || new Date()
          : null,
        seatOverageAt,
      },
    });
    return { session, tenantSwitched };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  // Only clear old-tenant memory after admission succeeds. A rejected tenant
  // switch must leave the still-active prior session intact.
  if (result.tenantSwitched) {
    console.log('[BotSession] Tenant switch completed; clearing conversation data', { sessionRef: sessionLogRef(platform, platformId) });
    await clearConversationHistory(platform, platformId);
    await clearPendingConfirmation(platform, platformId);
  }
  const session = result.session;
  
  console.log('[BotSession] Created or updated session', { platform, sessionRef: sessionLogRef(platform, platformId), linkedUser: Boolean(userId) });
  
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
    
    console.log('[BotSession] Deactivated session', { platform, sessionRef: sessionLogRef(platform, platformId) });
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
 * Supports sessions with or without linked users (for team members)
 */
export async function getBotSessionWithContext(
  platform: 'telegram' | 'whatsapp',
  platformId: string
) {
  // First get the session to check if user exists
  const session = await prisma.botSession.findUnique({
    where: {
      platform_platformId: {
        platform,
        platformId,
      },
    },
    include: {
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
  
  // For sessions WITHOUT a user (team members via code)
  if (!session.userId) {
    return {
      session,
      user: {
        id: `bot-${session.platformId}`, // Virtual user ID for audit logs
        email: `bot-${session.platformId}@${session.platform}.local`,
        username: session.username || session.platformId,
        name: session.providedName || session.displayName || 'Bot User',
        memberships: [],
      },
      tenant: session.tenant,
      role: session.accessRole || 'BOT_OPERATOR',
    };
  }
  
  // For sessions WITH a user (linked Betsy accounts), fetch user details
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
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
  });
  
  if (!user) {
    // User was deleted but session still exists
    return null;
  }
  
  const membership = user.memberships.find(
    (m) => m.tenantId === session.tenantId
  );
  
  return {
    session,
    user,
    tenant: session.tenant,
    role: membership?.role || 'VIEWER',
  };
}

