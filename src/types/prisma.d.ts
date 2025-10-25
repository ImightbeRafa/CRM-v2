import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
  
  // Extend PrismaClient to include $use method
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Prisma {
    interface PrismaClient<T = any> {
      $use(params: any): any;
    }
  }
}

export {};
