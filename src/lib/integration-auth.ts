import { createHash, randomBytes } from 'crypto';
import { prisma } from './db';

export async function validateApiKey(apiKey: string): Promise<string | null> {
  try {
    const keyHash = hashApiKey(apiKey);
    
    const apiKeyRecord = await prisma.apiKey.findFirst({
      where: {
        keyHash,
        active: true,
      },
      select: {
        tenantId: true,
      },
    });
    
    return apiKeyRecord?.tenantId || null;
  } catch (error) {
    console.error('[validateApiKey] Error:', error);
    return null;
  }
}

export async function getTenantFromApiKey(apiKey: string): Promise<string | null> {
  return validateApiKey(apiKey);
}

export function generateApiKey(): string {
  return 'bts_' + randomBytes(45).toString('base64url');
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

export async function createApiKey(tenantId: string, name: string): Promise<{ apiKey: string; id: string }> {
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);

  const record = await prisma.apiKey.create({
    data: {
      tenantId,
      keyHash,
      name,
      active: true,
    },
  });

  return {
    apiKey, // Return the plain key only once
    id: record.id,
  };
}

export async function revokeApiKey(keyId: string, tenantId: string): Promise<boolean> {
  try {
    await prisma.apiKey.update({
      where: {
        id: keyId,
        tenantId, // Ensure tenant can only revoke their own keys
      },
      data: {
        active: false,
      },
    });
    return true;
  } catch (error) {
    console.error('Error revoking API key:', error);
    return false;
  }
}

export async function listApiKeys(tenantId: string) {
  return prisma.apiKey.findMany({
    where: {
      tenantId,
    },
    select: {
      id: true,
      name: true,
      active: true,
      lastUsed: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });
}

export async function updateApiKeyLastUsed(apiKey: string): Promise<void> {
  try {
    const keyHash = hashApiKey(apiKey);
    
    await prisma.apiKey.update({
      where: {
        keyHash,
      },
      data: {
        lastUsed: new Date(),
      },
    });
  } catch (error) {
    console.error('Error updating API key last used:', error);
  }
}
