import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const getDatabaseUrl = () => {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) return baseUrl;

  const hasParams = baseUrl.includes('?');
  const separator = hasParams ? '&' : '?';

  if (!baseUrl.includes('connection_limit')) {
    return `${baseUrl}${separator}connection_limit=5&pool_timeout=20`;
  }

  return baseUrl;
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
