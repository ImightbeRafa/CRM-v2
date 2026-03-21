import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const getDatabaseUrl = () => {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) return baseUrl;

  const url = new URL(baseUrl);

  if (!url.searchParams.has('connection_limit')) {
    url.searchParams.set('connection_limit', '15');
  }
  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', '20');
  }
  if (!url.searchParams.has('pgbouncer') && url.port === '6543') {
    url.searchParams.set('pgbouncer', 'true');
  }

  return url.toString();
};

const prisma = globalThis.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
    datasourceUrl: getDatabaseUrl(),
  });

if (!globalThis.prisma) {
  globalThis.prisma = prisma;
}

export { prisma };
export default prisma;
