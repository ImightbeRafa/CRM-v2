/**
 * True when a query failed because a table does not exist yet (a gated migration such as 035 not
 * applied). Features built on such tables stay hidden instead of erroring.
 */
import { Prisma } from '@prisma/client'

export function isMissingRelation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2021') return true
    if (error.code === 'P2010') return String((error.meta as { code?: string } | undefined)?.code || '') === '42P01'
  }
  const e = error as { code?: unknown; meta?: { code?: unknown } }
  return String(e?.code || '') === '42P01' || String(e?.meta?.code || '') === '42P01'
}
