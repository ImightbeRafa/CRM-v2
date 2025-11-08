import { PrismaClient } from '@prisma/client';
import { getTenantContext } from './tenantContext';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Create a new Prisma client instance
const basePrisma: PrismaClient = global.prisma || new PrismaClient({
  log: ['error', 'warn'],
  datasourceUrl: process.env.DATABASE_URL,
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
