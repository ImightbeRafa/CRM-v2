/**
 * Conversation Memory for Betsy AI Bot
 * 
 * Uses Upstash Redis to store conversation history per chat.
 * Falls back to in-memory storage if Redis is not configured.
 * 
 * Stores the last 25 messages per conversation to maintain context.
 */

import { Redis } from '@upstash/redis';

// Maximum messages to keep per conversation
const MAX_MESSAGES = 25;

// Message TTL - 7 days
const MESSAGE_TTL_SECONDS = 7 * 24 * 60 * 60;

// Redis client (initialized lazily)
let redisClient: Redis | null = null;

// In-memory fallback storage (for development without Redis)
const memoryStorage = new Map<string, ConversationMessage[]>();
const stateStorage = new Map<string, Record<string, any>>();

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  // Optional: track tool calls for context
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
  }>;
}

/**
 * Get Redis client (or null if not configured)
 */
function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  
  if (url && token) {
    redisClient = new Redis({ url, token });
    console.log('[ConversationMemory] Using Upstash Redis');
  } else {
    console.log('[ConversationMemory] Redis not configured, using in-memory storage');
  }
  
  return redisClient;
}

/**
 * Generate cache key for a conversation
 */
function getConversationKey(platform: string, platformId: string): string {
  return `betsy:conversation:${platform}:${platformId}`;
}

/**
 * Get conversation history for a chat
 */
export async function getConversationHistory(
  platform: string,
  platformId: string
): Promise<ConversationMessage[]> {
  const key = getConversationKey(platform, platformId);
  const redis = getRedisClient();
  
  if (redis) {
    try {
      const messages = await redis.lrange<ConversationMessage>(key, 0, -1);
      return messages || [];
    } catch (error) {
      console.error('[ConversationMemory] Redis read error:', error);
      return [];
    }
  }
  
  // Fallback to in-memory
  return memoryStorage.get(key) || [];
}

/**
 * Add a message to conversation history
 */
export async function addMessage(
  platform: string,
  platformId: string,
  message: Omit<ConversationMessage, 'timestamp'>
): Promise<void> {
  const key = getConversationKey(platform, platformId);
  const fullMessage: ConversationMessage = {
    ...message,
    timestamp: Date.now(),
  };
  
  const redis = getRedisClient();
  
  if (redis) {
    try {
      // Push to end of list
      await redis.rpush(key, fullMessage);
      
      // Trim to keep only last MAX_MESSAGES
      await redis.ltrim(key, -MAX_MESSAGES, -1);
      
      // Set/refresh TTL
      await redis.expire(key, MESSAGE_TTL_SECONDS);
    } catch (error) {
      console.error('[ConversationMemory] Redis write error:', error);
    }
    return;
  }
  
  // Fallback to in-memory
  const existing = memoryStorage.get(key) || [];
  existing.push(fullMessage);
  
  // Keep only last MAX_MESSAGES
  if (existing.length > MAX_MESSAGES) {
    existing.splice(0, existing.length - MAX_MESSAGES);
  }
  
  memoryStorage.set(key, existing);
}

/**
 * Add user message to history
 */
export async function addUserMessage(
  platform: string,
  platformId: string,
  content: string
): Promise<void> {
  await addMessage(platform, platformId, {
    role: 'user',
    content,
  });
}

/**
 * Add assistant message to history
 */
export async function addAssistantMessage(
  platform: string,
  platformId: string,
  content: string,
  toolCalls?: ConversationMessage['toolCalls']
): Promise<void> {
  await addMessage(platform, platformId, {
    role: 'assistant',
    content,
    toolCalls,
  });
}

/**
 * Remove the most recent user message from history.
 * Used when the bot routes a turn into a pending confirmation flow and we
 * don't want the order data to linger in conversation history (so if pending
 * expires, the LLM cannot accidentally re-create the order from the leftover
 * user message). Safe to call even if the last message isn't a user message —
 * it only pops when role === 'user'.
 */
export async function removeLastUserMessage(
  platform: string,
  platformId: string
): Promise<void> {
  const key = getConversationKey(platform, platformId);
  const redis = getRedisClient();

  if (redis) {
    try {
      const last = await redis.lrange<ConversationMessage>(key, -1, -1);
      const lastMsg = last && last[0];
      if (lastMsg && (lastMsg as ConversationMessage).role === 'user') {
        await redis.rpop(key);
      }
    } catch (error) {
      console.error('[ConversationMemory] Failed to remove last user message:', error);
    }
    return;
  }

  // Fallback to in-memory
  const existing = memoryStorage.get(key);
  if (!existing || existing.length === 0) return;
  const lastMsg = existing[existing.length - 1];
  if (lastMsg && lastMsg.role === 'user') {
    existing.pop();
    memoryStorage.set(key, existing);
  }
}

/**
 * Clear conversation history
 */
export async function clearConversationHistory(
  platform: string,
  platformId: string
): Promise<void> {
  const key = getConversationKey(platform, platformId);
  const redis = getRedisClient();
  
  if (redis) {
    try {
      await redis.del(key);
    } catch (error) {
      console.error('[ConversationMemory] Redis delete error:', error);
    }
    return;
  }
  
  // Fallback to in-memory
  memoryStorage.delete(key);
}

/**
 * Format conversation history for AI context
 * Returns messages in the format expected by OpenAI/Vercel AI SDK
 */
export async function getFormattedHistory(
  platform: string,
  platformId: string
): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> {
  const history = await getConversationHistory(platform, platformId);
  
  return history.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

/**
 * Get a summary of recent conversation for system context
 */
export async function getConversationSummary(
  platform: string,
  platformId: string
): Promise<string | null> {
  const history = await getConversationHistory(platform, platformId);
  
  if (history.length === 0) return null;
  
  // Get last 5 messages for quick context
  const recent = history.slice(-5);
  
  const summary = recent
    .map((msg) => {
      const role = msg.role === 'user' ? 'Usuario' : 'Betsy';
      const preview = msg.content.length > 100 
        ? msg.content.slice(0, 100) + '...'
        : msg.content;
      return `${role}: ${preview}`;
    })
    .join('\n');
  
  return summary;
}

/**
 * Store pending confirmation state (for destructive actions)
 */
export async function setPendingConfirmation(
  platform: string,
  platformId: string,
  action: {
    type: string;
    data: Record<string, unknown>;
    expiresAt: number;
  }
): Promise<void> {
  const key = `betsy:pending:${platform}:${platformId}`;
  const redis = getRedisClient();
  
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(action), {
        ex: 120, // 2 minutes expiration
      });
    } catch (error) {
      console.error('[ConversationMemory] Failed to store pending confirmation:', error);
    }
    return;
  }
  
  // For in-memory, just use a temporary map
  memoryStorage.set(`pending:${key}`, [action as any]);
}

/**
 * Get and clear pending confirmation
 */
export async function getPendingConfirmation(
  platform: string,
  platformId: string
): Promise<{ type: string; data: Record<string, unknown> } | null> {
  const key = `betsy:pending:${platform}:${platformId}`;
  const redis = getRedisClient();
  
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        await redis.del(key);
        // Upstash SDK auto-deserializes JSON values, so `raw` may already be
        // an object. Only call JSON.parse when it's still a string.
        return typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
      }
    } catch (error) {
      console.error('[ConversationMemory] Failed to get pending confirmation:', error);
    }
    return null;
  }
  
  // For in-memory
  const pending = memoryStorage.get(`pending:${key}`);
  if (pending && pending.length > 0) {
    memoryStorage.delete(`pending:${key}`);
    return pending[0] as any;
  }
  
  return null;
}

/**
 * Peek at pending confirmation without deleting it.
 * Use this to check for pending data before deciding whether to act on it.
 * Call clearPendingConfirmation separately when the confirmation is consumed.
 */
export async function peekPendingConfirmation(
  platform: string,
  platformId: string
): Promise<{ type: string; data: Record<string, unknown> } | null> {
  const key = `betsy:pending:${platform}:${platformId}`;
  const redis = getRedisClient();

  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw) {
        return typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
      }
    } catch (error) {
      console.error('[ConversationMemory] Failed to peek pending confirmation:', error);
    }
    return null;
  }

  const pending = memoryStorage.get(`pending:${key}`);
  if (pending && pending.length > 0) {
    return pending[0] as any;
  }

  return null;
}

/**
 * Clear pending confirmation
 */
export async function clearPendingConfirmation(
  platform: string,
  platformId: string
): Promise<void> {
  const key = `betsy:pending:${platform}:${platformId}`;
  const redis = getRedisClient();
  
  if (redis) {
    try {
      await redis.del(key);
    } catch (error) {
      console.error('[ConversationMemory] Failed to clear pending confirmation:', error);
    }
    return;
  }
  
  memoryStorage.delete(`pending:${key}`);
}

/**
 * Store conversation state (for multi-step flows like bot setup)
 */
export async function setConversationState(
  platform: string,
  platformId: string,
  state: Record<string, any>
): Promise<void> {
  const key = `betsy:state:${platform}:${platformId}`;
  const redis = getRedisClient();
  
  if (redis) {
    try {
      const stateJson = JSON.stringify(state);
      console.log(`[ConversationMemory] Storing state for ${key}:`, stateJson);
      await redis.set(key, stateJson, {
        ex: 600, // 10 minutes expiration
      });
      console.log(`[ConversationMemory] State stored successfully`);
    } catch (error) {
      console.error('[ConversationMemory] Failed to store conversation state:', error);
    }
    return;
  }
  
  // For in-memory
  console.log(`[ConversationMemory] Storing state in memory for ${key}`);
  stateStorage.set(`state:${key}`, state);
}

/**
 * Get conversation state
 */
export async function getConversationState(
  platform: string,
  platformId: string
): Promise<Record<string, any> | null> {
  const key = `betsy:state:${platform}:${platformId}`;
  const redis = getRedisClient();
  
  if (redis) {
    try {
      const data = await redis.get(key);
      console.log(`[ConversationMemory] Retrieved raw data for ${key}:`, typeof data, data);
      
      if (!data) {
        console.log(`[ConversationMemory] No state found for ${key}`);
        return null;
      }
      
      // Handle if data is already an object (some Redis clients auto-parse)
      if (typeof data === 'object' && data !== null) {
        console.log(`[ConversationMemory] Data is already an object, returning directly`);
        return data as Record<string, any>;
      }
      
      // Handle if data is a string
      if (typeof data === 'string') {
        // Check if it's the problematic "[object Object]" string
        if (data === '[object Object]') {
          console.error(`[ConversationMemory] Found corrupted state "[object Object]", clearing it`);
          await redis.del(key);
          return null;
        }
        
        console.log(`[ConversationMemory] Parsing JSON string`);
        return JSON.parse(data);
      }
      
      console.warn(`[ConversationMemory] Unexpected data type: ${typeof data}`);
      return null;
      
    } catch (error: any) {
      console.error('[ConversationMemory] Failed to get conversation state:', error);
      console.error('[ConversationMemory] Error details:', error.message);
      // Clear corrupted state
      try {
        await redis.del(key);
        console.log(`[ConversationMemory] Cleared corrupted state`);
      } catch (delError) {
        console.error(`[ConversationMemory] Failed to clear corrupted state:`, delError);
      }
    }
    return null;
  }
  
  // For in-memory
  const state = stateStorage.get(`state:${key}`);
  if (state) return state;
  
  return null;
}

/**
 * Clear conversation state
 */
export async function clearConversationState(
  platform: string,
  platformId: string
): Promise<void> {
  const key = `betsy:state:${platform}:${platformId}`;
  const redis = getRedisClient();
  
  if (redis) {
    try {
      await redis.del(key);
    } catch (error) {
      console.error('[ConversationMemory] Failed to clear conversation state:', error);
    }
    return;
  }
  
  stateStorage.delete(`state:${key}`);
}

