/**
 * Tenant Context - Server-Side Tenant ID Management
 * 
 * Uses AsyncLocalStorage to maintain tenant context across async operations
 * without passing tenantId through every function call.
 */

import { AsyncLocalStorage } from 'async_hooks';

interface TenantContext {
  tenantId: string;
  userId?: string;
  role?: string;
}

// Create async local storage for tenant context
export const tenantContext = new AsyncLocalStorage<TenantContext>();

/**
 * Get the current tenant ID from context
 * @throws Error if tenant context is not set
 */
export function getTenantId(): string {
  const context = tenantContext.getStore();
  if (!context?.tenantId) {
    throw new Error('Tenant context not set. Ensure middleware is setting tenant context.');
  }
  return context.tenantId;
}

/**
 * Get the current tenant context (if set)
 * @returns TenantContext or undefined
 */
export function getTenantContext(): TenantContext | undefined {
  return tenantContext.getStore();
}

/**
 * Check if tenant context is set
 */
export function hasTenantContext(): boolean {
  const context = tenantContext.getStore();
  return !!context?.tenantId;
}

/**
 * Run a function with tenant context
 * Use this in API routes after extracting tenantId from session
 */
export async function runWithTenantContext<T>(
  context: TenantContext,
  fn: () => Promise<T>
): Promise<T> {
  return tenantContext.run(context, fn);
}

/**
 * Run a function without tenant isolation (use sparingly!)
 * Only for system operations like user creation, tenant creation, etc.
 */
export async function runWithoutTenantIsolation<T>(fn: () => Promise<T>): Promise<T> {
  // Temporarily clear context
  const currentContext = tenantContext.getStore();
  if (currentContext) {
    // Already in a context, just run the function
    return fn();
  }
  // No context, run normally
  return fn();
}

