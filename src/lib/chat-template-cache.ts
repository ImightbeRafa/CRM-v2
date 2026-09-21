/**
 * Per-WABA WhatsApp template cache (Respond.io Phase 4).
 * Upstash when configured; otherwise bounded in-memory Map.
 */

import { Redis } from '@upstash/redis'
import type { WhatsAppTemplateStatusRow } from '@/lib/wa-template-approval'

export const CHAT_TEMPLATE_CACHE_TTL_SECONDS = 300
export const CHAT_TEMPLATE_CACHE_TTL_MS = CHAT_TEMPLATE_CACHE_TTL_SECONDS * 1000
export const CHAT_TEMPLATE_CACHE_KEY_PREFIX = 'chat:wa-templates:v1:'
export const CHAT_TEMPLATE_CACHE_MAX_MEMORY_ENTRIES = 64

type MemoryEntry = {
  expiresAt: number
  value: WhatsAppTemplateStatusRow[]
}

const memoryStore = new Map<string, MemoryEntry>()

let redisClient: Redis | null | undefined

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim()
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim()
  if (!url || !token) {
    redisClient = null
    return null
  }
  try {
    redisClient = new Redis({ url, token })
    return redisClient
  } catch {
    redisClient = null
    return null
  }
}

export function chatTemplateCacheKey(wabaId: string): string {
  return `${CHAT_TEMPLATE_CACHE_KEY_PREFIX}${wabaId.trim()}`
}

function pruneMemoryStore(now = Date.now()) {
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt <= now) memoryStore.delete(key)
  }
  while (memoryStore.size > CHAT_TEMPLATE_CACHE_MAX_MEMORY_ENTRIES) {
    const oldest = memoryStore.keys().next().value as string | undefined
    if (!oldest) break
    memoryStore.delete(oldest)
  }
}

async function readCache(wabaId: string): Promise<WhatsAppTemplateStatusRow[] | null> {
  const key = chatTemplateCacheKey(wabaId)
  const redis = getRedis()
  if (redis) {
    try {
      const value = await redis.get<WhatsAppTemplateStatusRow[]>(key)
      if (Array.isArray(value)) return value
    } catch (error) {
      console.warn('[chat-template-cache] Redis read failed, trying memory', error)
    }
  }
  pruneMemoryStore()
  const entry = memoryStore.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return entry.value
}

async function writeCache(wabaId: string, value: WhatsAppTemplateStatusRow[]): Promise<void> {
  const key = chatTemplateCacheKey(wabaId)
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(key, value, { ex: CHAT_TEMPLATE_CACHE_TTL_SECONDS })
      return
    } catch (error) {
      console.warn('[chat-template-cache] Redis write failed, using memory', error)
    }
  }
  pruneMemoryStore()
  memoryStore.set(key, {
    value,
    expiresAt: Date.now() + CHAT_TEMPLATE_CACHE_TTL_MS,
  })
}

/** Test helper — clears in-memory entries (does not touch Redis). */
export function clearChatTemplateCacheMemoryForTests(): void {
  memoryStore.clear()
}

/** Test helper — expire a key immediately without waiting for TTL. */
export function expireChatTemplateCacheMemoryForTests(wabaId: string): void {
  const key = chatTemplateCacheKey(wabaId)
  const entry = memoryStore.get(key)
  if (entry) memoryStore.set(key, { ...entry, expiresAt: Date.now() - 1 })
}

/**
 * Return APPROVED templates for a WABA, caching fetchFn results for 300s.
 * Different WABA ids use separate keys.
 */
export async function getApprovedTemplates(
  wabaId: string,
  fetchFn: () => Promise<WhatsAppTemplateStatusRow[]>,
): Promise<WhatsAppTemplateStatusRow[]> {
  const id = wabaId.trim()
  if (!id) return fetchFn()

  const cached = await readCache(id)
  if (cached) return cached

  const fresh = await fetchFn()
  await writeCache(id, fresh)
  return fresh
}
