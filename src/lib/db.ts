import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const getDatabaseUrl = () => {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) return baseUrl;

  const hasParams = baseUrl.includes('?');
  const params: string[] = [];
  const defaultConnectionLimit = process.env.NODE_ENV === 'production' ? '1' : '5';
  const connectionLimit = process.env.PRISMA_CONNECTION_LIMIT || defaultConnectionLimit;
  const poolTimeout = process.env.PRISMA_POOL_TIMEOUT || '30';

  if (!baseUrl.includes('connection_limit')) {
    params.push(`connection_limit=${connectionLimit}`);
  }
  if (!baseUrl.includes('pool_timeout')) {
    params.push(`pool_timeout=${poolTimeout}`);
  }
  if (!baseUrl.includes('pgbouncer') && baseUrl.includes(':6543')) {
    params.push('pgbouncer=true');
  }

  if (params.length === 0) return baseUrl;
  const separator = hasParams ? '&' : '?';
  return `${baseUrl}${separator}${params.join('&')}`;
};

const prismaRaw = globalThis.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
    datasourceUrl: getDatabaseUrl(),
  });

if (!globalThis.prisma) {
  globalThis.prisma = prismaRaw;
}

function withActiveOrder(args: Record<string, any> | undefined) {
  return {
    ...(args || {}),
    where: {
      ...((args || {}).where || {}),
      deletedAt: null,
    },
  };
}

// Soft-deleted regular-tenant orders must disappear consistently from every
// top-level Prisma read and must not be mutated by legacy write paths.
// Raw queries are intentionally explicit: regular-tenant callers must add the
// active-row predicate themselves. The archive service uses prismaRaw with
// explicit tenant predicates to reach archived rows.
const prisma = prismaRaw.$extends({
  name: 'activeOrderReads',
  query: {
    order: {
      findUnique({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      findUniqueOrThrow({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      findFirst({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      findFirstOrThrow({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      findMany({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      count({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      aggregate({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      groupBy({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      update({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      updateMany({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      delete({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      deleteMany({ args, query }) { return query(withActiveOrder(args) as typeof args); },
      upsert({ args, query }) { return query(withActiveOrder(args) as typeof args); },
    },
  },
}) as unknown as PrismaClient;

export { prisma, prismaRaw };
export default prisma;
