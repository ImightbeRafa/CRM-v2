import { Prisma } from '@prisma/client'

/**
 * Database connection trouble (incident 2026-10-23: a heavy checkpoint made Postgres slow to accept
 * connections for ~20 min). Pure helpers, no prisma import, so any route and the tests can use them.
 *
 * - `isTransientDbError`: the database could not be reached / no connection was free. A request that
 *   failed this way should answer 503 so its sender (Meta) retries, instead of losing the work.
 * - `isRetryableDbError`: the subset where nothing was applied (connect failed, pool slot or
 *   transaction start timed out, or Postgres rolled the transaction back on a deadlock), so running it
 *   again cannot double-apply anything. P1017 (connection closed mid-query) is transient but never
 *   retried: a write may already have committed.
 * - `withDbRetry`: explicit, entry-point retry (never a global query extension: a retry inside an
 *   interactive or batch transaction is not valid). Bounded by a total deadline.
 */

/** Init errors carry `errorCode`; request errors carry `code`. */
function prismaCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const e = error as { code?: unknown; errorCode?: unknown }
  if (typeof e.code === 'string') return e.code
  if (typeof e.errorCode === 'string') return e.errorCode
  return null
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : ''
}

/**
 * Safe to run again: the statement never ran (connect / pool slot), or Postgres rolled the whole
 * transaction back (P2034 write conflict / deadlock — two messages of one chat taking the conversation
 * row lock in opposite order). Callers retry whole units only (a full transaction or a single read).
 */
const RETRYABLE_CODES = new Set(['P1001', 'P1002', 'P2024', 'P2034'])
const TRANSIENT_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034'])
/** P2028 is also "Transaction already closed" (the body may have run): only the start timeout is retryable. */
const TX_START_TIMEOUT = /unable to start a transaction in the given time/i
/** Raw-query errors (P2010 / unknown) wrap the Postgres text. */
const DEADLOCK_TEXT = /deadlock detected|could not serialize access|\b40P01\b|\b40001\b/i
const CONNECTION_TEXT =
  /can't reach database server|connection (?:refused|reset|terminated)|server has closed the connection|timed out fetching a new connection|could not accept ssl connection|ECONNRESET|ETIMEDOUT/i

/**
 * Text is only read for raw-query / unknown errors: a validation error's message embeds the query
 * arguments (a customer's text could say "connection refused" and would then be retried forever).
 */
function rawErrorText(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientValidationError) return null
  const code = prismaCode(error)
  if (code && code !== 'P2010') return null
  return message(error)
}

export function isRetryableDbError(error: unknown): boolean {
  const code = prismaCode(error)
  if (code && RETRYABLE_CODES.has(code)) return true
  if (code === 'P2028') return TX_START_TIMEOUT.test(message(error))
  const text = rawErrorText(error)
  return text !== null && DEADLOCK_TEXT.test(text)
}

export function isTransientDbError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientValidationError) return false
  if (isRetryableDbError(error)) return true
  const code = prismaCode(error)
  if (code && TRANSIENT_CODES.has(code)) return true
  if (error instanceof Prisma.PrismaClientInitializationError) return true
  if (error instanceof Prisma.PrismaClientRustPanicError) return true
  const text = rawErrorText(error)
  return text !== null && CONNECTION_TEXT.test(text)
}

// ---------------------------------------------------------------------------
// Rolling 5-minute counter of connection trouble seen by this process (resets on restart).
// Read by /api/health (bearer only) so the watchdog can warn before a full outage.
// ---------------------------------------------------------------------------

const WINDOW_MS = 5 * 60_000
const MAX_STAMPS = 1_000
const stamps: number[] = []

export function recordDbConnError(now = Date.now()): void {
  stamps.push(now)
  if (stamps.length > MAX_STAMPS) stamps.splice(0, stamps.length - MAX_STAMPS)
}

export function dbConnErrors5m(now = Date.now()): number {
  while (stamps.length && stamps[0] <= now - WINDOW_MS) stamps.shift()
  return stamps.length
}

/** Test hook. */
export function resetDbConnErrors(): void {
  stamps.length = 0
}

export type DbRetryOptions = {
  /** Extra attempts after the first (default 2). */
  retries?: number
  /** Stop retrying once this much time has passed since the first attempt (default 8 s). */
  deadlineMs?: number
  /** Which errors to retry (default: statement never ran). */
  retryOn?: (error: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const BACKOFF_MS = [250, 1_000, 2_000]

export function dbRetryDelay(attempt: number, random = Math.random()): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
  return Math.round(base + base * 0.4 * random)
}

export async function withDbRetry<T>(fn: () => Promise<T>, opts: DbRetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 2
  const deadlineMs = opts.deadlineMs ?? 8_000
  const retryOn = opts.retryOn ?? isRetryableDbError
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const started = now()
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (isTransientDbError(error)) recordDbConnError()
      const delay = dbRetryDelay(attempt)
      if (attempt >= retries || !retryOn(error) || now() - started + delay > deadlineMs) throw error
      await sleep(delay)
    }
  }
}
