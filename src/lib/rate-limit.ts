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
    // Give up on Redis after 1 s (rateLimitAsync then uses the memory limiter) instead of stalling,
    // and remember already-blocked identifiers locally so they skip the Redis round trip.
    timeout: 1000,
    ephemeralCache: new Map(),
  });
}

// --- In-memory fallback for local dev without Redis ---
interface RateLimitEntry {
  count: number;
  resetTime: number;
  /** Max requests for this key's window: entries over it are "blocking" and kept longest. */
  limit: number;
}

const memoryStore = new Map<string, RateLimitEntry>();
const MEMORY_STORE_MAX = 10_000;

/**
 * Keep the map bounded without letting a flood of junk keys evict a live block (e.g. a locked
 * login): expired entries go first, then entries that are not blocking anyone; blocked entries
 * are only dropped if the map is still full of them (then the oldest first).
 */
export function pruneMemoryStore(now: number, store: Map<string, RateLimitEntry> = memoryStore, max = MEMORY_STORE_MAX) {
  if (store.size < max) return;
  for (const [key, entry] of store) {
    if (now > entry.resetTime) store.delete(key);
  }
  const target = Math.floor(max / 2);
  if (store.size >= max) {
    for (const [key, entry] of store) {
      if (store.size <= target) break;
      if (entry.count < entry.limit) store.delete(key);
    }
  }
  if (store.size >= max) {
    for (const key of store.keys()) {
      if (store.size <= target) break;
      store.delete(key);
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
    memoryStore.set(key, { count: 1, resetTime: now + config.windowMs, limit: config.maxRequests });
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

export async function rateLimitAsync(
  identifier: string,
  limiter: Pick<Ratelimit, 'limit'> | null,
  fallbackConfig: { maxRequests: number; windowMs: number; prefix: string }
): Promise<{ allowed: boolean; headers: Record<string, string> }> {
  if (limiter) {
    try {
      const result = await limiter.limit(identifier);
      // On timeout Upstash resolves { success: true, reason: 'timeout' } (fail-open):
      // use the local limiter instead so auth limits keep working during Redis latency.
      if ((result as { reason?: string }).reason === 'timeout') {
        return memoryRateLimit(identifier, fallbackConfig);
      }
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

/** IPv6 clients are bucketed by /64 (one customer network), so rotating addresses inside it does not reset limits. */
export function normalizeClientIp(ip: string): string {
  const value = ip.trim().replace(/^\[|\]$/g, '');
  if (!value.includes(':')) return value;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is an IPv4 client.
  const mapped = /^(?:0*:)*:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped) return mapped[1];
  const [head] = value.split('%');
  const parts = head.split('::');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length > 1 && parts[1] ? parts[1].split(':') : [];
  const groups = parts.length > 1 ? [...left, ...new Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  const canon = (g: string) => {
    const n = parseInt(g || '0', 16);
    return Number.isFinite(n) ? n.toString(16) : '0';
  };
  return `${groups.slice(0, 4).map(canon).join(':')}::/64`;
}

export function rightmostForwarded(xff: string): string {
  const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
  return hops[hops.length - 1] || 'unknown';
}

export function getClientIP(request: Request): string {
  // Set by the deploy (cf-container-worker → cf-connecting-ip). When present, it is the
  // only header we trust: X-Forwarded-For's first entry is client-controlled behind a proxy.
  const trusted = (process.env.TRUSTED_IP_HEADER || '').trim().toLowerCase();
  if (trusted) {
    const value = request.headers.get(trusted)?.split(',')[0]?.trim();
    // Fail closed: when the edge header is missing, never fall back to spoofable headers.
    return value ? normalizeClientIp(value) : 'trusted-header-missing';
  }

  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip');

  // Right-most hop = the one our proxy appended; the first entry is whatever the client sent
  // (SecureDog H1: rotating a fake first entry reset every per-IP limit on the preview).
  if (forwarded) return normalizeClientIp(rightmostForwarded(forwarded));
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
/** Workspace writes (notes, client stage): own bucket, so they never eat the send quota. */
export const workspaceWriteRateLimit = createIdentifierRateLimit({
  windowMs: 60 * 1000,
  maxRequests: 60,
  identifier: 'workspace-write',
});

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

// --- Failure counters (login lockout, 2026-09-28) ---
// Fixed-window counters that only move on failures (a limiter would also count successes).
// Upstash when configured (shared by every container), otherwise this process's memory store.

const COUNTER_TIMEOUT_MS = 1000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('counter_timeout')), COUNTER_TIMEOUT_MS)),
  ]);
}

function memoryCounterGet(key: string): number {
  const entry = memoryStore.get(`fail:${key}`);
  if (!entry || Date.now() > entry.resetTime) return 0;
  return entry.count;
}

function memoryCounterIncr(key: string, windowMs: number, limit: number): number {
  const now = Date.now();
  const k = `fail:${key}`;
  const entry = memoryStore.get(k);
  if (!entry || now > entry.resetTime) {
    pruneMemoryStore(now);
    memoryStore.set(k, { count: 1, resetTime: now + windowMs, limit });
    return 1;
  }
  entry.count++;
  return entry.count;
}

export async function failureCount(key: string): Promise<number> {
  if (redis) {
    try {
      const v = await withTimeout(redis.get<number>(`failcount:${key}`));
      return Math.max(Number(v) || 0, memoryCounterGet(key));
    } catch {
      // fall through
    }
  }
  return memoryCounterGet(key);
}

/**
 * Atomically adds one to the counter and returns the new value. `limit` only tells the memory
 * store which entries are blocking (kept longest when pruning). Redis: the key is created WITH its
 * expiry (SET NX PX) before INCR, so a timeout between two calls can never leave a counter that
 * never expires (SecureDog M5: a permanently locked office IP).
 */
export async function recordFailure(key: string, windowMs: number, limit: number): Promise<number> {
  const local = memoryCounterIncr(key, windowMs, limit);
  if (redis) {
    try {
      const k = `failcount:${key}`;
      await withTimeout(redis.set(k, 0, { nx: true, px: windowMs }));
      const n = await withTimeout(redis.incr(k));
      // Belt and braces: a key without TTL (older code, manual edits) gets one now.
      if (n > 1 && Math.random() < 0.1) {
        const ttl = await withTimeout(redis.pttl(k));
        if (ttl === -1) await withTimeout(redis.pexpire(k, windowMs));
      }
      return Math.max(n, local);
    } catch {
      // memory already counted
    }
  }
  return local;
}

/** Gives back one reserved attempt (a login that turned out to be correct). */
export async function releaseAttempt(key: string): Promise<void> {
  const entry = memoryStore.get(`fail:${key}`);
  if (entry && entry.count > 0) entry.count--;
  if (redis) {
    try {
      const n = await withTimeout(redis.decr(`failcount:${key}`));
      if (n <= 0) await withTimeout(redis.del(`failcount:${key}`));
    } catch {
      // best effort
    }
  }
}

export async function clearFailures(key: string): Promise<void> {
  memoryStore.delete(`fail:${key}`);
  if (redis) {
    try {
      await withTimeout(redis.del(`failcount:${key}`));
    } catch {
      // best effort
    }
  }
}
