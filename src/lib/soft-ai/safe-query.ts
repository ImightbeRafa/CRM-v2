/**
 * Guard rails for analytics reads (usage dashboard, scorecard): one aggregate must never be able to
 * hold a database connection for long, and repeated opens are served from a short in-memory cache.
 */
import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

// At most 2 analytics statements hold a pooled connection at once per process: dashboards must never starve
// webhooks, the inbox or agent turns (the pool is only 6–8 connections per container).
const ANALYTICS_MAX_CONCURRENT = 2
let analyticsActive = 0
const analyticsWaiters: Array<() => void> = []

const ANALYTICS_MAX_WAITING = 20

/** Thrown when too many dashboard reads are already queued: the route answers 503 instead of piling up. */
export class AnalyticsBusyError extends Error {
  constructor() {
    super('ANALYTICS_BUSY')
    this.name = 'AnalyticsBusyError'
  }
}

async function acquireAnalyticsSlot(): Promise<void> {
  if (analyticsActive < ANALYTICS_MAX_CONCURRENT) {
    analyticsActive += 1
    return
  }
  if (analyticsWaiters.length >= ANALYTICS_MAX_WAITING) throw new AnalyticsBusyError()
  await new Promise<void>((resolve) => analyticsWaiters.push(resolve))
}

function releaseAnalyticsSlot(): void {
  const next = analyticsWaiters.shift()
  if (next) next()
  else analyticsActive = Math.max(0, analyticsActive - 1)
}

/** Runs one read-only SQL statement with a hard 8 s statement timeout (SET LOCAL ends with the transaction). */
export async function queryWithTimeout<T>(sql: Prisma.Sql): Promise<T> {
  await acquireAnalyticsSlot()
  try {
    const results = await prisma.$transaction([
      prisma.$executeRaw`SET LOCAL statement_timeout = '8s'`,
      prisma.$queryRaw<T>(sql),
    ])
    return results[1] as T
  } finally {
    releaseAnalyticsSlot()
  }
}

const memo = new Map<string, { at: number; value: unknown }>()
const inflight = new Map<string, Promise<unknown>>()
const MEMO_MAX = 200

/** Tiny per-process TTL cache (keys must include tenant + parameters); concurrent misses share one load. */
export async function memoTtl<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T
  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>
  const run = (async () => {
    try {
      const value = await load()
      if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string)
      memo.set(key, { at: Date.now(), value })
      return value
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, run)
  return run
}
