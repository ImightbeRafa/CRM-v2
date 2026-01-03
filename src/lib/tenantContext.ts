/**
 * Tenant Context - Server-Side Tenant ID Management
 * 
 * Uses AsyncLocalStorage to maintain tenant context across async operations
 * without passing tenantId through every function call.
 * 
 * CRITICAL: Uses AsyncLocalStorage for proper request-scoped isolation.
 * This prevents tenant context from mixing between concurrent requests.
 */

import { TenantError } from './errors';

// AsyncLocalStorage is only available in Node.js server environment
let AsyncLocalStorage: any = null;
let asyncLocalStorage: any = null;

// Initialize AsyncLocalStorage only in server environment
if (typeof window === 'undefined') {
  try {
    const asyncHooks = require('async_hooks');
    AsyncLocalStorage = asyncHooks.AsyncLocalStorage;
    asyncLocalStorage = new AsyncLocalStorage();
  } catch (e) {
    console.warn('AsyncLocalStorage not available, falling back to global context');
  }
}

export interface TenantContext {
  tenantId: string;
  userId?: string;
  role?: string;
  userRole?: 'ADMIN' | 'USER' | 'SYSTEM' | string;
  userName?: string;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  [key: string]: any; // Allow additional properties
}

// Fallback global context for browser environment
let globalContext: TenantContext | undefined = undefined;

/**
 * Get the current tenant ID from context
 * @throws {TenantError} if tenant context is not set
 */
export function getTenantId(): string {
  let context: TenantContext | undefined;
  
  if (asyncLocalStorage) {
    context = asyncLocalStorage.getStore();
  } else {
    context = globalContext;
  }
  
  if (!context?.tenantId) {
    throw new TenantError('Tenant context not set. Ensure middleware is setting tenant context.');
  }
  return context.tenantId;
}

/**
 * Get the current tenant context (if set)
 * @returns TenantContext or undefined
 */
export function getTenantContext(): TenantContext | undefined {
  if (asyncLocalStorage) {
    return asyncLocalStorage.getStore();
  } else {
    return globalContext;
  }
}

/**
 * Check if tenant context is set
 */
export function hasTenantContext(): boolean {
  if (asyncLocalStorage) {
    const context = asyncLocalStorage.getStore();
    return !!context?.tenantId;
  } else {
    return !!globalContext?.tenantId;
  }
}

/**
 * Run a function with tenant context
 * Use this in API routes after extracting tenantId from session
 * 
 * @example
 * await withTenantContext({ tenantId, userId }, async () => {
 *   // Your code here
 * });
 */
export async function withTenantContext<T>(
  context: Omit<TenantContext, 'requestId' | 'ipAddress' | 'userAgent'>,
  fn: () => Promise<T>
): Promise<T> {
  if (!context.tenantId) {
    throw new TenantError('Tenant ID is required');
  }

  // Create a properly typed context with all required fields
  const enhancedContext: TenantContext = {
    tenantId: context.tenantId,
    userId: context.userId,
    role: context.role,
    userRole: context.userRole,
    userName: context.userName,
    requestId: crypto.randomUUID(),
  };

  // Run the function within AsyncLocalStorage context
  if (asyncLocalStorage) {
    return asyncLocalStorage.run(enhancedContext, fn);
  } else {
    // Fallback for browser - use global context
    const previousContext = globalContext;
    globalContext = enhancedContext;
    try {
      return await fn();
    } finally {
      globalContext = previousContext;
    }
  }
}

/**
 * Run a function with request context
 * Automatically extracts common request data
 */
export async function withRequestContext<T>(
  request: Request,
  context: Omit<TenantContext, 'requestId' | 'ipAddress' | 'userAgent'>,
  fn: () => Promise<T>
): Promise<T> {
  if (!context.tenantId) {
    throw new TenantError('Tenant ID is required');
  }

  const ipAddress = request.headers.get('x-forwarded-for') || 
                   request.headers.get('x-real-ip') || 
                   'unknown';
  
  // Create a properly typed context with all required fields
  const enhancedContext: TenantContext = {
    tenantId: context.tenantId,
    userId: context.userId,
    role: context.role,
    userRole: context.userRole,
    userName: context.userName,
    requestId: crypto.randomUUID(),
    ipAddress,
    userAgent: request.headers.get('user-agent') || 'unknown',
  };

  // Run the function within AsyncLocalStorage context
  if (asyncLocalStorage) {
    return asyncLocalStorage.run(enhancedContext, fn);
  } else {
    // Fallback for browser - use global context
    const previousContext = globalContext;
    globalContext = enhancedContext;
    try {
      return await fn();
    } finally {
      globalContext = previousContext;
    }
  }
}

/**
 * Run a function without tenant isolation (use sparingly!)
 * Only for system operations like user creation, tenant creation, etc.
 */
export async function withoutTenantIsolation<T>(fn: () => Promise<T>): Promise<T> {
  const currentCtx = getTenantContext();
  
  // Log when running without tenant isolation
  if (currentCtx) {
    console.warn('⚠️ Running without tenant isolation in a tenant context', {
      tenantId: currentCtx.tenantId,
      userId: currentCtx.userId,
    });
  }

  // Create a system context
  const systemContext: TenantContext = {
    tenantId: 'system',
    userId: 'system',
    userRole: 'SYSTEM',
    userName: 'System',
    requestId: crypto.randomUUID(),
  };
  
  // Run the function with system context in AsyncLocalStorage
  if (asyncLocalStorage) {
    return asyncLocalStorage.run(systemContext, fn);
  } else {
    // Fallback for browser - use global context
    const previousContext = globalContext;
    globalContext = systemContext;
    try {
      return await fn();
    } finally {
      globalContext = previousContext;
    }
  }
}

/**
 * Get the current request ID for logging
 */
export function getRequestId(): string {
  return getTenantContext()?.requestId || 'no-request-id';
}

