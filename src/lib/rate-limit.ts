/**
 * Simple in-memory rate limiter for development/testing.
 * In production, use Vercel KV or Upstash Redis for distributed rate limiting.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const memoryStore = new Map<string, RateLimitEntry>();

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  identifier?: string; // Optional identifier override
}

/**
 * Check if a request should be rate limited
 * @param identifier Unique identifier (IP address, user ID, etc.)
 * @param config Rate limit configuration
 * @returns Object with allowed status and headers
 */
export function rateLimit(
  identifier: string,
  config: RateLimitConfig
): { allowed: boolean; headers: Record<string, string> } {
  const now = Date.now();
  const key = config.identifier ? `${config.identifier}:${identifier}` : identifier;
  
  // Clean up expired entries
  for (const [k, entry] of memoryStore.entries()) {
    if (now > entry.resetTime) {
      memoryStore.delete(k);
    }
  }
  
  // Get or create entry
  let entry = memoryStore.get(key);
  if (!entry || now > entry.resetTime) {
    entry = { count: 0, resetTime: now + config.windowMs };
    memoryStore.set(key, entry);
  }
  
  // Increment counter
  entry.count++;
  
  // Calculate remaining requests and reset time
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const resetTime = Math.ceil(entry.resetTime / 1000);
  
  const headers = {
    'X-RateLimit-Limit': config.maxRequests.toString(),
    'X-RateLimit-Remaining': remaining.toString(),
    'X-RateLimit-Reset': resetTime.toString(),
  };
  
  // Check if exceeded
  const allowed = entry.count <= config.maxRequests;
  
  return { allowed, headers };
}

/**
 * Extract client IP from request
 */
export function getClientIP(request: Request): string {
  // Try various headers for real IP
  const forwarded = request.headers.get('x-forwarded-for');
  const realIP = request.headers.get('x-real-ip');
  const cfConnectingIP = request.headers.get('cf-connecting-ip'); // Cloudflare
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  if (realIP) {
    return realIP.trim();
  }
  
  if (cfConnectingIP) {
    return cfConnectingIP.trim();
  }
  
  // Fallback to a default
  return 'unknown';
}

/**
 * Rate limit middleware for API routes
 */
export function createRateLimit(config: RateLimitConfig) {
  return (request: Request, response?: Response) => {
    const identifier = getClientIP(request);
    const result = rateLimit(identifier, config);
    
    if (!result.allowed) {
      return Response.json(
        { error: 'Too many requests' },
        { 
          status: 429,
          headers: result.headers
        }
      );
    }
    
    // Return headers to be added to successful response
    return result.headers;
  };
}

// Pre-configured rate limiters
export const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 attempts per 15 minutes
});

export const generalRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100, // 100 requests per 15 minutes
});

export const exportRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 10, // 10 exports per hour
});
