/**
 * Tenant-Aware Prisma Client
 * 
 * Provides a Prisma client that automatically filters queries by tenantId
 * Use getTenantPrisma() in API routes for automatic tenant isolation
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { prisma as globalPrisma } from './db';
import { getTenantContext } from './tenantContext';
import { logAudit } from './auditLogger';
import { TenantError } from './errors';
import { AuditAction as PrismaAuditAction } from '@prisma/client';

// Extend the Prisma AuditAction type to include our custom actions
type AuditAction = PrismaAuditAction | 'SECURITY_WARNING' | 'TENANT_ERROR';

// Enable debug logging
const DEBUG = false;

// Helper type for Prisma middleware params
type PrismaMiddlewareParams = {
  model?: string;
  action: string;
  args: any;
  dataPath: string[];
  runInTransaction: boolean;
  data?: any;
};

type PrismaNextFunction = (params: PrismaMiddlewareParams) => Promise<any>;

// Type guard to check if model is a tenant model (case-insensitive)
function isTenantModel(model: string | undefined): model is string {
  return model ? TENANT_MODELS_LOWER.includes(model.toLowerCase()) : false;
}

// Models that have tenantId field and require tenant isolation
// IMPORTANT: Keep this list in sync with your Prisma schema
const TENANT_MODELS = [
  'order',
  'client',
  'seller',
  'orderStatus',
  'productField',
  'productOptionSet',
  'productOption', // CRITICAL: Added for tenant isolation of shipping method options
  'shippingMethod',
  'shippingConfig',
  'shippingGuia',
  'inventoryItem',
  'inventoryTransaction',
  'auditLog',
  'businessInfo',
  'product',
  'productVariant',
  'category',
  // Do not include models without tenantId (e.g., User) in isolation list
  'membership',
  // 'tenant' has special handling below
  'warehouse',
  'supplier',
  'purchaseOrder',
  'sale',
  'customer',
  'taxRate',
  'discount',
  'priceList',
  'barcode',
  'stockMovement',
  'stockAdjustment',
  'inventoryCount',
  'inventoryTransfer',
  'socialAccount',
  'chatMessage',
] as const;

const TENANT_MODELS_LOWER: readonly string[] = TENANT_MODELS.map((m) => m.toLowerCase());

/**
 * REMOVED: Top-level prismaGlobal.$extends() had no effect (not assigned to variable)
 * Tenant isolation is implemented via:
 * 1. Global extension in db.ts for base isolation
 * 2. createTenantPrisma() below for explicit tenant-scoped clients
 * 
 * This ensures a single, clear tenant isolation strategy without drift.
 */

// Reuse the singleton Prisma client from db.ts for tenant-scoped operations.
// IMPORTANT: Do NOT create a second PrismaClient here — it doubles connection pool usage
// and was the primary cause of Supabase "Max client connections reached" errors.
const basePrismaClient = globalPrisma;

// Export raw Prisma client without ANY middleware for system operations
export const prismaRaw = basePrismaClient;

// Cache tenant-scoped Prisma clients to avoid expensive re-creation
// Use LRU-like behavior: limit cache size and evict oldest entries
const MAX_TENANT_CACHE_SIZE = 50; // Limit to 50 tenant clients max
const tenantPrismaCache = new Map<string, ReturnType<typeof createTenantPrismaUncached>>();
const tenantAccessOrder: string[] = []; // Track access order for LRU

function scheduleAuditLog(data: Parameters<typeof logAudit>[0]) {
  const run = () => {
    void logAudit(data).catch((error) => {
      console.error('Failed to log audit:', error);
    });
  };

  if (typeof setImmediate === 'function') {
    setImmediate(run);
  } else {
    setTimeout(run, 0);
  }
}

/**
 * Create a Prisma client extension that automatically injects tenantId (uncached version)
 */
function createTenantPrismaUncached(tenantId: string) {
  if (!tenantId) {
    throw new Error('Tenant ID is required for tenant-isolated queries');
  }

  // Create a single extension that handles all tenant isolation
  // Use clean basePrismaClient to avoid double middleware
  return basePrismaClient.$extends({
    name: 'tenantIsolation',
    query: {
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          const modelName = model?.toLowerCase();
          const isTenantModel = modelName ? TENANT_MODELS_LOWER.includes(modelName) : false;

          // Skip tenant isolation for non-tenant models or system operations
          if (!isTenantModel) {
            return query(args);
          }

          // IMPORTANT: Do NOT JSON-clone args (breaks Buffers for Bytes fields)
          // Make a shallow copy to avoid mutating the original while preserving Buffer types
          const originalArgs: any = args || {};
          const modifiedArgs: any = {
            ...originalArgs,
            where: originalArgs.where ? { ...originalArgs.where } : originalArgs.where,
            data: originalArgs.data ? { ...originalArgs.data } : originalArgs.data,
            create: originalArgs.create ? { ...originalArgs.create } : originalArgs.create,
            update: originalArgs.update ? { ...originalArgs.update } : originalArgs.update,
          };
          const context = getTenantContext();
          const contextTenantId = context?.tenantId || tenantId;
          const userId = context?.userId || 'system';

          // Helper to add tenant ID to where clause
          const addTenantToWhere = (where: any) => {
            if (!where) return { tenantId: contextTenantId };

            // If where has OR conditions, we need to handle them
            if (where.OR) {
              return {
                ...where,
                OR: where.OR.map((cond: any) => ({
                  ...cond,
                  tenantId: contextTenantId
                })),
                tenantId: contextTenantId // Also add at the top level for safety
              };
            }

            // If where has AND conditions, we need to handle them
            if (where.AND) {
              return {
                ...where,
                AND: where.AND.map((cond: any) => ({
                  ...cond,
                  tenantId: cond.tenantId || contextTenantId
                })),
                tenantId: contextTenantId // Also add at the top level for safety
              };
            }

            // Simple case - just add tenantId
            return { ...where, tenantId: contextTenantId };
          };

          // Handle different operation types with strict tenant isolation
          try {
            switch (operation) {
              case 'findUnique':
              case 'findFirst':
                modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
                break;

              case 'findMany':
                // ALWAYS add tenant filter for data isolation
                modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
                break;

              case 'create':
                // Only inject tenantId if tenant relation is not already set
                if (!modifiedArgs.data?.tenant) {
                  modifiedArgs.data = {
                    ...modifiedArgs.data,
                    tenantId: contextTenantId
                  };
                }
                break;

              case 'update':
              case 'updateMany':
                modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
                // Prevent updating tenantId
                if (modifiedArgs.data && 'tenantId' in modifiedArgs.data) {
                  delete modifiedArgs.data.tenantId;
                }
                break;

              case 'delete':
              case 'deleteMany':
                modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
                break;

              case 'upsert':
                modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
                // Only inject tenantId in create if tenant relation is not already set
                if (!modifiedArgs.create?.tenant) {
                  modifiedArgs.create = {
                    ...modifiedArgs.create,
                    tenantId: contextTenantId
                  };
                }
                if (modifiedArgs.update && 'tenantId' in modifiedArgs.update) {
                  delete modifiedArgs.update.tenantId;
                }
                break;

              default:
                // For other operations, ensure tenantId is in the where clause
                if (modifiedArgs.where) {
                  modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
                }
            }

            if (DEBUG) {
              console.log(`[${model}.${operation}] Tenant ${contextTenantId}:`,
                JSON.stringify(modifiedArgs, null, 2));
            }

            // Execute the query
            const result = await query(modifiedArgs);

            // Log only mutating operations to avoid invalid enum values for reads
            try {
              const mutatingOps = new Set(['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
              if (mutatingOps.has(operation)) {
                // Models covered by explicit logBulkDelete / API audit helpers —
                // skip middleware stubs to avoid duplicate empty/partial rows.
                const modelLower = (modelName || '').toLowerCase();
                const explicitAuditModels = new Set([
                  'order',
                  'productfield',
                  'productoption',
                  'productoptionset',
                  'shippingmethod',
                  'seller',
                ]);
                if (explicitAuditModels.has(modelLower)) {
                  // Still allow create/update middleware content for config models that
                  // may lack explicit create logs — but skip delete/deleteMany which
                  // bulkOperations already logs with snapshots.
                  if (
                    operation === 'delete' ||
                    operation === 'deleteMany' ||
                    modelLower === 'order'
                  ) {
                    return result;
                  }
                }

                let entityId = 'unknown';
                if (result && typeof result === 'object' && 'id' in result) {
                  entityId = String((result as { id: unknown }).id);
                } else if (modifiedArgs?.where?.id) {
                  entityId = String(modifiedArgs.where.id);
                } else if (modifiedArgs?.data?.id) {
                  entityId = String(modifiedArgs.data.id);
                } else if (modifiedArgs?.id) {
                  entityId = String(modifiedArgs.id);
                }

                const actionMap: Record<string, AuditAction> = {
                  create: 'CREATE',
                  createMany: 'CREATE',
                  update: 'UPDATE',
                  updateMany: 'BULK_UPDATE',
                  delete: 'DELETE',
                  deleteMany: 'BULK_DELETE',
                  upsert: 'UPDATE',
                } as const;

                const resultSnapshot =
                  result && typeof result === 'object' && !Array.isArray(result)
                    ? result
                    : null;
                const dataSnapshot = modifiedArgs?.data || null;

                // Do not await automatic audit writes here. Interactive transactions
                // keep a DB connection open; awaiting a second audit query can deadlock
                // small pools and expire the transaction before the next business query.
                scheduleAuditLog({
                  action: actionMap[operation] || 'UPDATE',
                  entityType: modelName || 'System',
                  entityId,
                  description: `Performed ${operation} on ${modelName || 'unknown'}`,
                  userId,
                  tenantId: contextTenantId,
                  userRole: (context?.role as any) || 'SYSTEM',
                  userName: context?.userName || 'System',
                  // Persist content so Auditoría can show what changed/created
                  newValues: resultSnapshot || dataSnapshot || undefined,
                  details: {
                    operation,
                    model: modelName,
                    ...(dataSnapshot && { data: dataSnapshot }),
                    ...(resultSnapshot && { result: resultSnapshot }),
                  }
                });
              }
            } catch (auditError) {
              console.error('Failed to log audit:', auditError);
              // Don't fail the main operation if audit logging fails
            }

            return result;

          } catch (error) {
            console.error(`Error in tenant-isolated query (${model}.${operation}):`, error);
            // DO NOT try to audit-log errors here — during connection exhaustion,
            // this creates cascading failures (logging opens more DB connections).
            throw error;
          }
        }
      }
    }
  });
}

/**
 * 
 * @param tenantId - The tenant ID to isolate queries to
 * @param bypassIsolation - If true, returns client without tenant isolation (super admin only)
 */
export function getTenantPrisma(tenantId: string, bypassIsolation: boolean = false) {
  if (!tenantId && !bypassIsolation) {
    throw new TenantError('Tenant ID is required for tenant-isolated queries');
  }

  // ⚠️ SECURITY CRITICAL: Super admin bypass - return base client without tenant isolation
  // WARNING: This bypasses ALL tenant filtering. Only use for authorized accounts.
  if (bypassIsolation) {
    console.warn(`🔐 [SECURITY WARNING] Super admin tenant isolation BYPASSED - ALL tenant data accessible`, {
      requestedTenantId: tenantId,
      bypassGranted: true,
      timestamp: new Date().toISOString(),
      stackTrace: new Error().stack?.split('\n')[2]?.trim() // Log caller
    });

    // Return global prisma client without ANY tenant filtering
    return globalPrisma;
  }

  // Check cache first for performance
  const cached = tenantPrismaCache.get(tenantId);
  if (cached) {
    // Update access order for LRU
    const index = tenantAccessOrder.indexOf(tenantId);
    if (index > -1) {
      tenantAccessOrder.splice(index, 1);
    }
    tenantAccessOrder.push(tenantId);
    return cached;
  }

  // Log the creation of a tenant-scoped Prisma client (only on first creation)
  const context = getTenantContext();
  if (context?.tenantId && context.tenantId !== tenantId) {
    logAudit({
      action: 'SECURITY_WARNING' as const,
      entityType: 'TenantContext',
      entityId: tenantId,
      description: `Tenant context mismatch: ${context.tenantId} != ${tenantId}`,
      userId: context.userId || 'unknown',
      userRole: context.role || 'system',
      tenantId: context.tenantId,
    });
  }

  // Implement LRU eviction if cache is full
  if (tenantPrismaCache.size >= MAX_TENANT_CACHE_SIZE) {
    const oldestTenantId = tenantAccessOrder.shift();
    if (oldestTenantId) {
      tenantPrismaCache.delete(oldestTenantId);
      console.log(`[Prisma Cache] Evicted tenant client: ${oldestTenantId} (cache full)`);
    }
  }

  // Create and cache the client
  const client = createTenantPrismaUncached(tenantId);
  tenantPrismaCache.set(tenantId, client);
  tenantAccessOrder.push(tenantId);

  return client;
}

/**
 * Helper to extract tenantId from NextAuth session
 * @throws {TenantError} If tenant ID is missing
 */
export function getTenantIdFromSession(session: any): string {
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    throw new TenantError('Session does not contain tenantId');
  }
  return tenantId;
}

// Re-export TenantError from errors module

/**
 * Use the global prisma client (without tenant isolation)
 * Only for:
 * - User authentication
 * - Tenant creation
 * - Membership management
 * - System operations
 */
export { globalPrisma };

