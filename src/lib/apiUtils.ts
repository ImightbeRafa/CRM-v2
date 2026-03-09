import { NextResponse } from 'next/server'

export interface ApiResponse<T = any> {
  status: 'success' | 'error'
  data?: T
  error?: string
  message?: string
}

export class ApiError extends Error {
  public statusCode: number
  public isOperational: boolean

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = isOperational
    Error.captureStackTrace(this, this.constructor)
  }
}

export function createSuccessResponse<T>(data: T, message?: string): NextResponse {
  const response: ApiResponse<T> = {
    status: 'success',
    data,
    ...(message && { message })
  }
  return NextResponse.json(response)
}

export function createErrorResponse(
  error: string | Error, 
  statusCode: number = 500,
  message?: string
): NextResponse {
  const errorMessage = error instanceof Error ? error.message : error
  
  const response: ApiResponse = {
    status: 'error',
    error: errorMessage,
    ...(message && { message })
  }
  
  return NextResponse.json(response, { status: statusCode })
}

export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error)
  
  if (error instanceof ApiError) {
    return createErrorResponse(error.message, error.statusCode)
  }
  
  if (error instanceof Error) {
    // Handle Prisma errors
    if (error.message.includes('does not exist') || error.message.includes('no such table')) {
      return createErrorResponse('Database table not found', 404)
    }
    
    if (error.message.includes('Unique constraint')) {
      return createErrorResponse('Duplicate entry', 409)
    }
    
    if (error.message.includes('Foreign key constraint')) {
      return createErrorResponse('Invalid reference', 400)
    }
    
    // Handle specific Prisma error codes
    if (error.message.includes('P2002')) {
      return createErrorResponse('This key already exists. Please choose a different key.', 409)
    }
    
    if (error.message.includes('P2025')) {
      return createErrorResponse('Record not found', 404)
    }
    
    if (error.message.includes('P2003')) {
      return createErrorResponse('Invalid reference to related record', 400)
    }
    
    return createErrorResponse(error.message, 500)
  }
  
  return createErrorResponse('Internal server error', 500)
}

export function validateRequiredFields(data: any, requiredFields: string[]): string | null {
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      return `Field '${field}' is required`
    }
  }
  return null
}

export function validatePassword(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long'
  }
  return null
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, '')
}

/**
 * Performance timing utility for API routes
 * Use: const timer = createApiTimer('/api/orders GET'); ... timer.end();
 */
export function createApiTimer(routeName: string) {
  const start = Date.now();
  const isDev = process.env.NODE_ENV === 'development';
  
  return {
    /** Log an intermediate checkpoint */
    checkpoint(label: string) {
      if (isDev) {
        console.log(`[PERF] ${routeName} | ${label}: ${Date.now() - start}ms`);
      }
    },
    /** End the timer and log total duration */
    end(additionalInfo?: Record<string, any>) {
      const duration = Date.now() - start;
      // Log slow requests (>500ms) even in production
      if (duration > 500 || isDev) {
        console.log(`[PERF] ${routeName} | Total: ${duration}ms${duration > 500 ? ' ⚠️ SLOW' : ''}`, additionalInfo || '');
      }
      return duration;
    }
  };
}

/**
 * Wrapper for API handlers that adds timing and error handling
 */
export function withTiming<T extends (...args: any[]) => Promise<NextResponse>>(
  routeName: string,
  handler: T
): T {
  return (async (...args: Parameters<T>) => {
    const timer = createApiTimer(routeName);
    try {
      const result = await handler(...args);
      timer.end();
      return result;
    } catch (error) {
      timer.end({ error: true });
      throw error;
    }
  }) as T;
}