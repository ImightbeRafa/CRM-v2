import { PrismaClient } from '@prisma/client';
import { getTenantContext } from './tenantContext';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Create a new Prisma client instance with connection pooling via URL parameters
// Add connection pool settings to DATABASE_URL: ?connection_limit=20&pool_timeout=20
const getDatabaseUrl = () => {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) return baseUrl;
  
  // Check if URL already has query params
  const hasParams = baseUrl.includes('?');
  const separator = hasParams ? '&' : '?';
  
  // Add connection pool parameters if not already present
  if (!baseUrl.includes('connection_limit')) {
    return `${baseUrl}${separator}connection_limit=20&pool_timeout=20`;
  }
  
  return baseUrl;
};

const basePrisma: PrismaClient = global.prisma || new PrismaClient({
  log: ['error', 'warn'],
  datasourceUrl: getDatabaseUrl(),
});

// Attach a global tenant isolation extension so all consumers are scoped
const prisma = basePrisma.$extends({
  name: 'globalTenantIsolation',
  query: {
    $allModels: {
      async $allOperations({ operation, model, args, query }) {
        const modelName = model?.toLowerCase();

        // Models requiring tenant isolation (lowercased)
        const tenantModels = new Set([
          'order',
          'client',
          'seller',
          'orderstatus',
          'productfield',
          'productoptionset',
          'shippingmethod',
          'shippingconfig',
          'shippingguia',
          'inventoryitem',
          'auditlog',
          'businessinfo',
          'socialaccount',
          'chatmessage',
        ]);

        if (!modelName || !tenantModels.has(modelName)) {
          return query(args);
        }

        const context = getTenantContext();
        const tenantIdFromContext = context?.tenantId;
        const extractTenantId = (input: any): string | undefined => {
          if (!input) return undefined;
          if (input.where?.tenantId) return input.where.tenantId as string;
          if (input.data?.tenantId) return input.data.tenantId as string;
          if (input.create?.tenantId) return input.create.tenantId as string;
          // For createMany, check first item in data array
          if (Array.isArray(input.data) && input.data.length > 0 && input.data[0]?.tenantId) {
            return input.data[0].tenantId as string;
          }
          return undefined;
        };
        const tenantIdFromArgs = extractTenantId(args);
        const tenantId = tenantIdFromContext || tenantIdFromArgs;

        if (!tenantId && modelName !== 'tenant') {
          if (operation === 'findMany') return [];
          if (operation === 'findFirst' || operation === 'findUnique') return null;
          throw new Error('Tenant context is required for this operation');
        }

        const modifiedArgs = JSON.parse(JSON.stringify(args || {}));

        const addTenantToWhere = (where: any) => {
          if (!tenantId) return where;
          if (!where) return { tenantId };
          if (where.OR) {
            return { ...where, OR: where.OR.map((c: any) => ({ ...c, tenantId })), tenantId };
          }
          if (where.AND) {
            return { ...where, AND: where.AND.map((c: any) => ({ ...c, tenantId: c.tenantId || tenantId })), tenantId };
          }
          return { ...where, tenantId };
        };

        switch (operation) {
          case 'findUnique':
          case 'findFirst':
            modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
            break;
          case 'findMany':
            if (modifiedArgs.where?.tenantId !== null) {
              modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
            }
            break;
          case 'create':
            if (tenantId) modifiedArgs.data = { ...modifiedArgs.data, tenantId };
            break;
          case 'createMany':
            // Handle createMany by adding tenantId to each item in the data array
            if (tenantId && Array.isArray(modifiedArgs.data)) {
              modifiedArgs.data = modifiedArgs.data.map((item: any) => ({
                ...item,
                tenantId: item.tenantId || tenantId
              }));
            }
            break;
          case 'update':
          case 'updateMany':
          case 'delete':
          case 'deleteMany':
            modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
            if (modifiedArgs.data && 'tenantId' in modifiedArgs.data) delete modifiedArgs.data.tenantId;
            break;
          case 'upsert':
            modifiedArgs.where = addTenantToWhere(modifiedArgs.where);
            if (tenantId) modifiedArgs.create = { ...modifiedArgs.create, tenantId };
            if (modifiedArgs.update && 'tenantId' in modifiedArgs.update) delete modifiedArgs.update.tenantId;
            break;
        }

        return query(modifiedArgs);
      },
    },
  },
});

if (process.env.NODE_ENV !== 'production') {
  // Assign extended client globally for dev hot-reload
  (global as any).prisma = prisma;
}

export { prisma };
export default prisma;
