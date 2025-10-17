interface RateLimitEntry {
  count: number
  resetTime: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

export interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Maximum requests per window
  message?: string // Custom error message
}

export function createRateLimit(config: RateLimitConfig) {
  const { windowMs, maxRequests, message = 'Too many requests' } = config

  return (identifier: string): { allowed: boolean; remaining: number; resetTime: number } => {
    const now = Date.now()
    const entry = rateLimitStore.get(identifier)

    // Clean up expired entries
    if (entry && now > entry.resetTime) {
      rateLimitStore.delete(identifier)
    }

    const currentEntry = rateLimitStore.get(identifier)

    if (!currentEntry) {
      // First request
      rateLimitStore.set(identifier, {
        count: 1,
        resetTime: now + windowMs
      })
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetTime: now + windowMs
      }
    }

    if (currentEntry.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: currentEntry.resetTime
      }
    }

    // Increment count
    currentEntry.count++
    rateLimitStore.set(identifier, currentEntry)

    return {
      allowed: true,
      remaining: maxRequests - currentEntry.count,
      resetTime: currentEntry.resetTime
    }
  }
}

// Predefined rate limiters
export const authRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 5, // 5 login attempts per 15 minutes
  message: 'Too many login attempts. Please try again later.'
})

export const apiRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100, // 100 requests per 15 minutes
  message: 'Too many API requests. Please slow down.'
})

export const formRateLimit = createRateLimit({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10, // 10 form submissions per minute
  message: 'Too many form submissions. Please wait a moment.'
})

// Cleanup function to remove expired entries
export function cleanupRateLimit() {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key)
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupRateLimit, 5 * 60 * 1000)
