/**
 * Tenant-Aware Prisma Client
 * 
 * Provides a Prisma client that automatically filters queries by tenantId
 * Use getPrismaWithTenant() in API routes for automatic tenant isolation
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from './db';

// Models that have tenantId field
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
  'auditLog',
  'businessInfo',
] as const;

type TenantModel = typeof TENANT_MODELS[number];

/**
 * Create a Prisma client extension that automatically injects tenantId
 */
export function createTenantPrisma(tenantId: string) {
  return prisma.$extends({
    name: 'tenantIsolation',
    query: {
      // Apply to all models
      $allModels: {
        async $allOperations({ operation, model, args, query }) {
          // Check if this model has tenantId
          const modelName = model?.toLowerCase();
          const hasTenantId = modelName && TENANT_MODELS.includes(modelName as TenantModel);

          if (!hasTenantId) {
            // Model doesn't have tenantId, proceed normally
            return query(args);
          }

          // Inject tenantId based on operation type (guard against undefined args.where/data)
          switch (operation) {
            case 'findUnique':
            case 'findFirst':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
              // Add tenantId to where clause
              args.where = {
                ...(args?.where || {}),
                tenantId,
              } as any;
              break;

            case 'create':
              // Add tenantId to data
              args.data = {
                ...(args?.data || {}),
                tenantId: (args as any)?.data?.tenantId ?? tenantId,
              } as any;
              break;

            case 'createMany':
              // Add tenantId to all data items
              if (Array.isArray((args as any).data)) {
                (args as any).data = (args as any).data.map((item: any) => ({
                  ...item,
                  tenantId: item?.tenantId ?? tenantId,
                }));
              } else {
                (args as any).data = {
                  ...((args as any).data || {}),
                  tenantId: (args as any)?.data?.tenantId ?? tenantId,
                };
              }
              break;

            case 'update':
            case 'updateMany':
            case 'delete':
            case 'deleteMany':
              // Add tenantId to where clause
              args.where = {
                ...(args?.where || {}),
                tenantId,
              } as any;
              break;

            case 'upsert':
              // Add tenantId to where and create data
              args.where = {
                ...(args?.where || {}),
                tenantId,
              } as any;
              if ((args as any).create) {
                (args as any).create = {
                  ...((args as any).create || {}),
                  tenantId: (args as any).create?.tenantId ?? tenantId,
                };
              }
              // Do not force tenantId on update (it already exists on the record)
              break;
          }

          return query(args);
        },
      },
    },
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
    throw new Error('Tenant ID is required for tenant-isolated queries');
  }
  return createTenantPrisma(tenantId);
}

/**
 * Helper to extract tenantId from NextAuth session
 */
export function getTenantIdFromSession(session: any): string {
  const tenantId = session?.user?.tenantId;
  if (!tenantId) {
    throw new Error('Session does not contain tenantId');
  }
  return tenantId;
}

/**
 * Use the global prisma client (without tenant isolation)
 * Only for:
 * - User authentication
 * - Tenant creation
 * - Membership management
 * - System operations
 */
export { prisma as prismaGlobal };

