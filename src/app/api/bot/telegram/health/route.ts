/**
 * Health Check Endpoint
 * Tests if all bot dependencies are available
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checks: Record<string, any> = {
    timestamp: new Date().toISOString(),
    env: {},
    imports: {},
  };

  // Check environment variables
  checks.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ? '✅ Set' : '❌ Missing';
  checks.env.XAI_API_KEY = process.env.XAI_API_KEY ? '✅ Set' : '❌ Missing (required for AI)';
  checks.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ? '✅ Set' : '⚠️ Missing (needed for voice transcription)';
  checks.env.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL ? '✅ Set' : '❌ Missing';
  checks.env.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ? '✅ Set' : '❌ Missing';

  // Check if modules can be imported
  try {
    const { getTelegramBot } = await import('@/lib/bot/telegram');
    checks.imports.telegram = '✅ OK';
  } catch (error: any) {
    checks.imports.telegram = `❌ ${error.message}`;
  }

  try {
    const { processMessage } = await import('@/lib/bot/ai-agent');
    checks.imports.aiAgent = '✅ OK';
  } catch (error: any) {
    checks.imports.aiAgent = `❌ ${error.message}`;
  }

  try {
    const { getBotSessionWithContext } = await import('@/lib/bot/bot-session');
    checks.imports.botSession = '✅ OK';
  } catch (error: any) {
    checks.imports.botSession = `❌ ${error.message}`;
  }

  try {
    const { getConversationHistory } = await import('@/lib/bot/conversation-memory');
    checks.imports.conversationMemory = '✅ OK';
  } catch (error: any) {
    checks.imports.conversationMemory = `❌ ${error.message}`;
  }

  // Check if grammy is available
  try {
    const grammy = await import('grammy');
    checks.imports.grammy = '✅ OK';
  } catch (error: any) {
    checks.imports.grammy = `❌ ${error.message}`;
  }

  // Check if OpenAI is available
  try {
    const openai = await import('openai');
    checks.imports.openai = '✅ OK';
  } catch (error: any) {
    checks.imports.openai = `❌ ${error.message}`;
  }

  // Check if Upstash Redis is available
  try {
    const redis = await import('@upstash/redis');
    checks.imports.upstashRedis = '✅ OK';
  } catch (error: any) {
    checks.imports.upstashRedis = `❌ ${error.message}`;
  }

  console.log('[Health Check] Results:', JSON.stringify(checks, null, 2));

  return NextResponse.json(checks);
}

