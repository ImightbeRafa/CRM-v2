/**
 * Bot Access Code Generation and Validation
 * 
 * Generates secure, copy-paste friendly codes for team members
 * to connect to Telegram/WhatsApp bots.
 */

import { prisma } from '@/lib/db';
import { randomInt } from 'crypto';

/**
 * Generate a secure bot access code
 * Format: ABC123XYZ789 (12 chars, alphanumeric, uppercase)
 */
export function generateBotAccessCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  
  for (let i = 0; i < 12; i++) {
    code += chars[randomInt(chars.length)];
  }
  
  return code;
}

/**
 * Generate and save a unique bot access code for a tenant
 * Retries if code already exists (very unlikely)
 */
export async function generateUniqueBotAccessCode(tenantId: string): Promise<string> {
  let attempts = 0;
  const maxAttempts = 5;
  
  while (attempts < maxAttempts) {
    const code = generateBotAccessCode();
    
    try {
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { botAccessCode: code },
      });
      
      console.log(`[Bot Access Code] Generated code for tenant ${tenantId}`);
      return code;
    } catch (error: any) {
      // If unique constraint fails, try again
      if (error.code === 'P2002') {
        attempts++;
        console.log(`[Bot Access Code] Code collision, retrying... (${attempts}/${maxAttempts})`);
        continue;
      }
      throw error;
    }
  }
  
  throw new Error('Failed to generate unique bot access code after multiple attempts');
}

/**
 * Validate a bot access code and return the tenant
 */
export async function validateBotAccessCode(code: string) {
  if (!code || code.length !== 12) {
    return null;
  }
  
  const tenant = await prisma.tenant.findUnique({
    where: { botAccessCode: code.toUpperCase() },
    select: {
      id: true,
      name: true,
      isActive: true,
      plan: true,
    },
  });
  
  if (!tenant || !tenant.isActive) {
    return null;
  }
  
  return tenant;
}

/**
 * Regenerate bot access code (e.g., if compromised)
 */
export async function regenerateBotAccessCode(tenantId: string): Promise<string> {
  return generateUniqueBotAccessCode(tenantId);
}

