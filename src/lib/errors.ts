/**
 * Custom error classes for the application
 */

export class BaseError extends Error {
  public readonly name: string;
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, any>;

  constructor(
    name: string,
    statusCode: number,
    message: string,
    isOperational = true,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      statusCode: this.statusCode,
      message: this.message,
      ...(this.details && { details: this.details }),
      ...(process.env.NODE_ENV === 'development' && { stack: this.stack }),
    };
  }
}

/**
 * Thrown when a tenant-related error occurs
 */
export class TenantError extends BaseError {
  constructor(
    message: string,
    details?: Record<string, any>,
    isOperational = true
  ) {
    super('TenantError', 400, message, isOperational, details);
  }
}

/**
 * Thrown when a resource is not found
 */
export class NotFoundError extends BaseError {
  constructor(resource: string, id?: string | number) {
    const message = id 
      ? `Resource '${resource}' with ID '${id}' not found`
      : `Resource '${resource}' not found`;
      
    super('NotFoundError', 404, message, true, { resource, id });
  }
}

/**
 * Thrown when a user is not authorized to perform an action
 */
export class UnauthorizedError extends BaseError {
  constructor(message = 'Unauthorized', details?: Record<string, any>) {
    super('UnauthorizedError', 401, message, true, details);
  }
}

/**
 * Thrown when a user is forbidden from performing an action
 */
export class ForbiddenError extends BaseError {
  constructor(message = 'Forbidden', details?: Record<string, any>) {
    super('ForbiddenError', 403, message, true, details);
  }
}

/**
 * Thrown when a request is invalid
 */
export class ValidationError extends BaseError {
  constructor(message = 'Validation failed', details?: Record<string, any>) {
    super('ValidationError', 400, message, true, details);
  }
}

/**
 * Thrown when a conflict occurs (e.g., duplicate entry)
 */
export class ConflictError extends BaseError {
  constructor(message = 'Conflict', details?: Record<string, any>) {
    super('ConflictError', 409, message, true, details);
  }
}

/**
 * Thrown when a rate limit is exceeded
 */
export class RateLimitError extends BaseError {
  constructor(
    message = 'Too many requests, please try again later',
    details?: Record<string, any>
  ) {
    super('RateLimitError', 429, message, true, {
      retryAfter: '1m',
      ...details,
    });
  }
}

/**
 * Thrown when an internal server error occurs
 */
export class InternalServerError extends BaseError {
  constructor(
    message = 'An unexpected error occurred',
    details?: Record<string, any>,
    isOperational = false
  ) {
    super('InternalServerError', 500, message, isOperational, details);
  }
}

/**
 * Error handler middleware for generic use
 */
export function handleError(err: unknown) {
  if (err instanceof BaseError) {
    return {
      statusCode: err.statusCode,
      body: JSON.stringify(err.toJSON()),
    };
  }

  // Handle unexpected errors
  const error = new InternalServerError(
    'An unexpected error occurred',
    undefined,
    false
  );

  // Log the full error in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Unhandled error:', err);
  }

  return {
    statusCode: error.statusCode,
    body: JSON.stringify(error.toJSON()),
  };
}

/**
 * Standardized NextResponse error helper
 * Use this in API route handlers to ensure consistent error responses
 * 
 * @example
 * import { errorResponse } from '@/lib/errors';
 * return errorResponse(new UnauthorizedError('Invalid credentials'));
 */
export function errorResponse(err: unknown) {
  // Import NextResponse dynamically to avoid bundling issues
  const { NextResponse } = require('next/server');
  
  if (err instanceof BaseError) {
    // Exclude stack trace in production unless it's a development operational error
    const response = err.toJSON();
    if (process.env.NODE_ENV === 'production' && !err.isOperational) {
      delete response.stack;
    }
    
    return NextResponse.json(response, { 
      status: err.statusCode,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Handle unexpected errors - don't leak internals in production
  const message = process.env.NODE_ENV === 'development'
    ? String(err)
    : 'An unexpected error occurred';
    
  console.error('[API Error]', err);
  
  return NextResponse.json(
    {
      name: 'InternalServerError',
      statusCode: 500,
      message,
      ...(process.env.NODE_ENV === 'development' && { 
        details: err instanceof Error ? { stack: err.stack } : {}
      })
    },
    { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/**
 * Success response helper for consistent API responses
 * 
 * @example
 * return successResponse({ user: userData }, 201);
 */
export function successResponse<T>(data: T, status = 200) {
  const { NextResponse } = require('next/server');
  
  return NextResponse.json(data, {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
