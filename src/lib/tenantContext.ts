/**
 * Tenant Context - Server-Side Tenant ID Management
 * 
 * Uses AsyncLocalStorage to maintain tenant context across async operations
 * without passing tenantId through every function call.
 */

// import { AsyncLocalStorage } from 'async_hooks';
import { TenantError } from './errors';

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

// Simple context store for tenant context (Edge Runtime compatible)
let currentContext: TenantContext | undefined;

/**
 * Get the current tenant ID from context
 * @throws {TenantError} if tenant context is not set
 */
export function getTenantId(): string {
  if (!currentContext?.tenantId) {
    throw new TenantError('Tenant context not set. Ensure middleware is setting tenant context.');
  }
  return currentContext.tenantId;
}

/**
 * Get the current tenant context (if set)
 * @returns TenantContext or undefined
 */
export function getTenantContext(): TenantContext | undefined {
  return currentContext;
}

/**
 * Check if tenant context is set
 */
export function hasTenantContext(): boolean {
  return !!currentContext?.tenantId;
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

  // Set the context and run the function
  const previousContext = currentContext;
  currentContext = enhancedContext;
  
  try {
    return await fn();
  } finally {
    // Restore previous context
    currentContext = previousContext;
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

  // Set the context and run the function
  const previousContext = currentContext;
  currentContext = enhancedContext;
  
  try {
    return await fn();
  } finally {
    // Restore previous context
    currentContext = previousContext;
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

  // Save the current context
  const previousContext = currentContext;
  
  try {
    // Set a system context
    currentContext = {
      tenantId: 'system',
      userId: 'system',
      userRole: 'SYSTEM',
      userName: 'System',
      requestId: crypto.randomUUID(),
    };
    
    // Run the function with system context
    return await fn();
  } finally {
    // Restore previous context
    currentContext = previousContext;
  }
}

/**
 * Get the current request ID for logging
 */
export function getRequestId(): string {
  return getTenantContext()?.requestId || 'no-request-id';
}

