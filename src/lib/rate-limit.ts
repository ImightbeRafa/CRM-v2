import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const hasRedis = !!(redisUrl && redisToken);

let redis: Redis | null = null;
if (hasRedis) {
  redis = new Redis({ url: redisUrl!, token: redisToken! });
}

function createRedisLimiter(config: { prefix: string; maxRequests: number; windowMs: number }) {
  if (!redis) return null;

  const windowSec = Math.ceil(config.windowMs / 1000);
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.maxRequests, `${windowSec} s`),
    prefix: `ratelimit:${config.prefix}`,
    analytics: false,
    // Give up on Redis after 1 s (falls back to memory) instead of stalling the request,
    // and remember already-blocked identifiers locally so they skip the Redis round trip.
    timeout: 1000,
    ephemeralCache: new Map(),
  });
}

// --- In-memory fallback for local dev without Redis ---
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, RateLimitEntry>();
const MEMORY_STORE_MAX = 10_000;

/** Drop expired entries (and, if still huge, the oldest ones) so unique IPs cannot grow the map forever. */
function pruneMemoryStore(now: number) {
  if (memoryStore.size < MEMORY_STORE_MAX) return;
  for (const [key, entry] of memoryStore) {
    if (now > entry.resetTime) memoryStore.delete(key);
  }
  if (memoryStore.size >= MEMORY_STORE_MAX) {
    let excess = memoryStore.size - Math.floor(MEMORY_STORE_MAX / 2);
    for (const key of memoryStore.keys()) {
      if (excess-- <= 0) break;
      memoryStore.delete(key);
    }
  }
}

function memoryRateLimit(
  identifier: string,
  config: { maxRequests: number; windowMs: number; prefix?: string }
): { allowed: boolean; headers: Record<string, string> } {
  const now = Date.now();
  const key = config.prefix ? `${config.prefix}:${identifier}` : identifier;

  const entry = memoryStore.get(key);
  if (!entry || now > entry.resetTime) {
    pruneMemoryStore(now);
    memoryStore.set(key, { count: 1, resetTime: now + config.windowMs });
    return {
      allowed: true,
      headers: {
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': (config.maxRequests - 1).toString(),
        'X-RateLimit-Reset': Math.ceil((now + config.windowMs) / 1000).toString(),
      },
    };
  }

  entry.count++;
  const remaining = Math.max(0, config.maxRequests - entry.count);
  return {
    allowed: entry.count <= config.maxRequests,
    headers: {
      'X-RateLimit-Limit': config.maxRequests.toString(),
      'X-RateLimit-Remaining': remaining.toString(),
      'X-RateLimit-Reset': Math.ceil(entry.resetTime / 1000).toString(),
    },
  };
}

// --- Unified rate limit function ---

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  identifier?: string;
}

export function rateLimit(
  identifier: string,
  config: RateLimitConfig
): { allowed: boolean; headers: Record<string, string> } {
  const prefix = config.identifier || 'general';
  return memoryRateLimit(identifier, { ...config, prefix });
}

// --- Async rate limit using Redis when available ---

async function rateLimitAsync(
  identifier: string,
  limiter: Ratelimit | null,
  fallbackConfig: { maxRequests: number; windowMs: number; prefix: string }
): Promise<{ allowed: boolean; headers: Record<string, string> }> {
  if (limiter) {
    try {
      const result = await limiter.limit(identifier);
      return {
        allowed: result.success,
        headers: {
          'X-RateLimit-Limit': result.limit.toString(),
          'X-RateLimit-Remaining': result.remaining.toString(),
          'X-RateLimit-Reset': Math.ceil(result.reset / 1000).toString(),
        },
      };
    } catch {
      // Redis unavailable -- fall through to in-memory
    }
  }
  return memoryRateLimit(identifier, fallbackConfig);
}

// --- Pre-configured limiters ---

const authRedisLimiter = createRedisLimiter({ prefix: 'auth', maxRequests: 5, windowMs: 15 * 60 * 1000 });
const generalRedisLimiter = createRedisLimiter({ prefix: 'general', maxRequests: 100, windowMs: 15 * 60 * 1000 });
const exportRedisLimiter = createRedisLimiter({ prefix: 'export', maxRequests: 10, windowMs: 60 * 60 * 1000 });

export function getClientIP(request: Request): string {
  // Set by the deploy (cf-container-worker → cf-connecting-ip). When present, it is the
  // only header we trust: X-Forwarded-For's first entry is client-controlled behind a proxy.
  const trusted = (process.env.TRUSTED_IP_HEADER || '').trim().toLowerCase();
  if (trusted) {
    const value = request.headers.get(trusted)?.split(',')[0]?.trim();
    if (value) return value;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip');

  if (forwarded) return forwarded.split(',')[0].trim();
  if (realIP) return realIP.trim();
  if (cfConnectingIP) return cfConnectingIP.trim();
  return 'unknown';
}

export function createRateLimit(config: RateLimitConfig) {
  const prefix = config.identifier || 'custom';
  const redisLimiter = createRedisLimiter({ prefix, ...config });

  return async (request: Request) => {
    const ip = getClientIP(request);
    const result = await rateLimitAsync(ip, redisLimiter, { ...config, prefix });

    if (!result.allowed) {
      return Response.json(
        { error: 'Too many requests' },
        { status: 429, headers: result.headers }
      );
    }
    return result.headers;
  };
}

/** Build a limiter for an application-provided stable identifier (for example,
 * a tenant plus API-key hash), with the same Redis-first/local fallback policy. */
export function createIdentifierRateLimit(config: RateLimitConfig) {
  const prefix = config.identifier || 'custom-identifier';
  const redisLimiter = createRedisLimiter({ prefix, ...config });

  return async (identifier: string) => rateLimitAsync(
    identifier,
    redisLimiter,
    { ...config, prefix },
  );
}

export const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  identifier: 'auth',
});

export const generalRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 100,
  identifier: 'general',
});

export const exportRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000,
  maxRequests: 10,
  identifier: 'export',
});

// Lookup and punch traffic must not share a tiny bucket. A normal worker flow
// performs one lookup and one punch, and many workers may share the same NAT.
export const workClockLookupRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 60,
  identifier: 'work-clock-lookup',
});

export const workClockPunchRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 120,
  identifier: 'work-clock-punch',
});

/** Soft Copilot / chats outbound send — per tenant:user. */
export const chatSendRateLimit = createIdentifierRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 30,
  identifier: 'chat-send',
});

/** Public Meta chat webhook — per client IP. */
export const chatWebhookRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 120,
  identifier: 'chat-webhook',
});


/**
 * Invalid Meta webhook signatures only — never apply to HMAC-valid traffic.
 * Keeps abuse off the shared valid-webhook path (Meta IPs are shared/fan-in).
 */
export const chatWebhookInvalidSignatureRateLimit = createRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 60,
  identifier: 'chat-webhook-invalid-signature',
});
