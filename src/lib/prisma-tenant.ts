/**
 * Tenant-Aware Prisma Client
 * 
 * Provides a Prisma client that automatically filters queries by tenantId
 * Use getTenantPrisma() in API routes for automatic tenant isolation
 */

import { prisma as prismaGlobal } from './db';
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

/**
 * Create a Prisma client extension that automatically injects tenantId
 */
export function createTenantPrisma(tenantId: string) {
  if (!tenantId) {
    throw new Error('Tenant ID is required for tenant-isolated queries');
  }

  // Create a single extension that handles all tenant isolation
  return prismaGlobal.$extends({
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
          
          // Create a deep copy of args to avoid mutating the original
          const modifiedArgs = JSON.parse(JSON.stringify(args || {}));
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
                // Only add tenant filter if not explicitly disabled
                if (modifiedArgs.where?.tenantId !== null) {
                  modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
                }
                break;
                
              case 'create':
                modifiedArgs.data = {
                  ...modifiedArgs.data,
                  tenantId: contextTenantId
                };
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
                modifiedArgs.create = {
                  ...modifiedArgs.create,
                  tenantId: contextTenantId
                };
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
              const mutatingOps = new Set(['create','createMany','update','updateMany','delete','deleteMany','upsert']);
              if (mutatingOps.has(operation)) {
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

                await logAudit({
                  action: actionMap[operation] || 'UPDATE',
                  entityType: modelName || 'System',
                  entityId,
                  description: `Performed ${operation} on ${modelName || 'unknown'}`,
                  userId,
                  tenantId: contextTenantId,
                  userRole: (context?.role as any) || 'SYSTEM',
                  userName: context?.userName || 'System',
                  details: {
                    operation,
                    model: modelName,
                    ...(modifiedArgs?.data && { data: modifiedArgs.data })
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
            // Log the error for audit
            try {
              await logAudit({
                action: 'ERROR' as const,
                entityType: modelName || 'unknown',
                entityId: 'n/a',
                userId: userId,
                tenantId: contextTenantId,
                details: {
                  operation,
                  model: modelName,
                  error: error instanceof Error ? error.message : String(error),
                  args: modifiedArgs
                }
              });
            } catch (auditError) {
              console.error('Failed to log error audit:', auditError);
            }
            throw error;
          }
        }
      }
    }
  });
}

/**
 * Get a tenant-aware Prisma client
 * Use this in API routes after extracting tenantId from session
 * 
 * @example
 * const tenantPrisma = getTenantPrisma(session.user.tenantId);
 * const orders = await tenantPrisma.order.findMany(); // Auto-filtered by tenantId
 */
export function getTenantPrisma(tenantId: string) {
  if (!tenantId) {
    throw new TenantError('Tenant ID is required for tenant-isolated queries');
  }
  
  // Log the creation of a tenant-scoped Prisma client
  const context = getTenantContext();
  if (context?.tenantId && context.tenantId !== tenantId) {
    logAudit({
      action: 'SECURITY_WARNING' as const, // Type assertion for custom audit action
      entityType: 'TenantContext',
      entityId: tenantId,
      description: `Tenant context mismatch: ${context.tenantId} != ${tenantId}`,
      userId: context.userId || 'unknown',
      userRole: context.role || 'system', // Use role from context or default to 'system'
      tenantId: context.tenantId,
    });
  }

  return createTenantPrisma(tenantId);
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
export { prismaGlobal };

