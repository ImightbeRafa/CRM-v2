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
