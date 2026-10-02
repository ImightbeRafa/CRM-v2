/**
 * Guard rails for analytics reads (usage dashboard, scorecard): one aggregate must never be able to
 * hold a database connection for long, and repeated opens are served from a short in-memory cache.
 */
import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

/** Runs one read-only SQL statement with a hard 8 s statement timeout (SET LOCAL ends with the transaction). */
export async function queryWithTimeout<T>(sql: Prisma.Sql): Promise<T> {
  const results = await prisma.$transaction([
    prisma.$executeRaw`SET LOCAL statement_timeout = '8s'`,
    prisma.$queryRaw<T>(sql),
  ])
  return results[1] as T
}

const memo = new Map<string, { at: number; value: unknown }>()
const MEMO_MAX = 200

/** Tiny per-process TTL cache (keys must include tenant + parameters). */
export async function memoTtl<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T
  const value = await load()
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string)
  memo.set(key, { at: Date.now(), value })
  return value
}
