import 'server-only'
import { errorFingerprint } from '@/lib/observability/fingerprint'
import { scrubPii } from '@/lib/observability/scrub'

/**
 * Betsy's own error tracking (replaced Sentry 2026-10-02, free, data stays in our infrastructure).
 *
 * Every report:
 *  1. writes ONE scrubbed JSON line to the console → Cloudflare Workers Logs (searchable, live);
 *  2. counts it in an in-memory group; a flush every 15 s upserts the groups into OpsErrorGroup
 *     (one statement per group, coalesced, so a burst of errors is a handful of DB writes);
 *  3. a group seen for the first time emails the platform owner (OPS_ALERT_EMAIL), capped.
 *
 * Never throws, never stores request bodies or arguments other than the error itself. Missing
 * table (SQL 040 not applied) → logs only, retried after 10 minutes.
 */
export type ErrorSource = 'server' | 'client' | 'edge' | 'cron' | 'ops'

export type ErrorReport = {
  source: ErrorSource
  name: string
  message: string
  stack?: string
  route?: string | null
}

type Pending = { report: ErrorReport; count: number; firstAt: number; lastAt: number }

const FLUSH_MS = 15_000
const MAX_PENDING_GROUPS = 200
const MISSING_TABLE_BACKOFF_MS = 10 * 60_000
const MAX_NEW_GROUP_ALERTS_PER_HOUR = 6

const pending = new Map<string, Pending>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let tableMissingUntil = 0
let alertWindowStart = 0
let alertsInWindow = 0
let originalConsoleError: typeof console.error | null = null
let reporting = false

function clip(value: string | undefined | null, max: number): string | null {
  if (!value) return null
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Scrubbed, size-capped copy of a report (what is logged and stored). */
export function sanitizeReport(report: ErrorReport): ErrorReport {
  return {
    source: report.source,
    name: clip(scrubPii(report.name || 'Error'), 120) || 'Error',
    message: clip(scrubPii(report.message || ''), 500) || '(no message)',
    stack: clip(report.stack ? scrubPii(report.stack) : undefined, 4000) || undefined,
    route: clip(report.route ? scrubPii(report.route.split('?')[0]!) : null, 300),
  }
}

export function reportFromError(error: unknown, source: ErrorSource, route?: string | null): ErrorReport {
  if (error instanceof Error) {
    return { source, name: error.name, message: error.message, stack: error.stack, route }
  }
  return { source, name: 'NonError', message: typeof error === 'string' ? error : 'Non-error thrown', route }
}

/** Records one error (log line now, DB group on the next flush). Never throws. */
export function reportError(input: ErrorReport): void {
  if (reporting) return
  reporting = true
  try {
    const report = sanitizeReport(input)
    const id = errorFingerprint(report)
    const line = JSON.stringify({ level: 'error', kind: 'betsy.error', id, ...report, stack: report.stack?.split('\n').slice(0, 6).join('\n') })
    ;(originalConsoleError ?? console.error).call(console, line)

    const now = Date.now()
    const existing = pending.get(id)
    if (existing) {
      existing.count += 1
      existing.lastAt = now
    } else if (pending.size < MAX_PENDING_GROUPS) {
      pending.set(id, { report, count: 1, firstAt: now, lastAt: now })
    }
    scheduleFlush()
  } catch {
    /* never let error reporting cause an error */
  } finally {
    reporting = false
  }
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushErrorGroups()
  }, FLUSH_MS)
  ;(flushTimer as { unref?: () => void }).unref?.()
}

/** Writes pending groups. Exported for tests and for graceful shutdown. */
export async function flushErrorGroups(): Promise<{ written: number; newGroups: number; skipped?: string }> {
  if (pending.size === 0) return { written: 0, newGroups: 0 }
  const batch = [...pending.entries()]
  pending.clear()
  if (Date.now() < tableMissingUntil) return { written: 0, newGroups: 0, skipped: 'table_missing' }

  let written = 0
  const fresh: ErrorReport[] = []
  try {
    const { prisma } = await import('@/lib/db')
    for (const [id, p] of batch) {
      const rows = await prisma.$queryRaw<Array<{ inserted: boolean }>>`
        INSERT INTO public."OpsErrorGroup" ("id", "source", "route", "name", "message", "stack", "count", "firstSeen", "lastSeen")
        VALUES (${id}, ${p.report.source}, ${p.report.route ?? null}, ${p.report.name}, ${p.report.message},
                ${p.report.stack ?? null}, ${p.count}, ${new Date(p.firstAt)}, ${new Date(p.lastAt)})
        ON CONFLICT ("id") DO UPDATE SET
          "count" = public."OpsErrorGroup"."count" + EXCLUDED."count",
          "lastSeen" = GREATEST(public."OpsErrorGroup"."lastSeen", EXCLUDED."lastSeen"),
          "route" = coalesce(EXCLUDED."route", public."OpsErrorGroup"."route"),
          "status" = CASE WHEN public."OpsErrorGroup"."status" = 'resolved' THEN 'open' ELSE public."OpsErrorGroup"."status" END
        RETURNING (xmax = 0) AS inserted`
      written += 1
      if (rows[0]?.inserted) fresh.push(p.report)
    }
  } catch (error) {
    const code = (error as { code?: string; meta?: { code?: string } } | null)?.meta?.code ?? (error as { code?: string } | null)?.code
    if (code === 'P2021' || code === '42P01' || /42P01|does not exist/.test(error instanceof Error ? error.message : '')) {
      tableMissingUntil = Date.now() + MISSING_TABLE_BACKOFF_MS
      return { written, newGroups: 0, skipped: 'table_missing' }
    }
    ;(originalConsoleError ?? console.error).call(console, '[observability] flush failed', error instanceof Error ? error.name : 'unknown')
    return { written, newGroups: 0, skipped: 'error' }
  }
  if (fresh.length) await alertNewGroups(fresh)
  return { written, newGroups: fresh.length }
}

async function alertNewGroups(groups: ErrorReport[]) {
  const now = Date.now()
  if (now - alertWindowStart > 60 * 60_000) {
    alertWindowStart = now
    alertsInWindow = 0
  }
  if (alertsInWindow >= MAX_NEW_GROUP_ALERTS_PER_HOUR) return
  alertsInWindow += 1
  try {
    const { sendOpsAlert } = await import('@/lib/ops/alert-email')
    await sendOpsAlert({
      key: `new-errors:${Math.floor(now / 60_000)}`,
      subject: groups.length === 1 ? `Error nuevo: ${groups[0]!.name}` : `${groups.length} errores nuevos`,
      lines: [
        ...groups.slice(0, 5).map((g) => `${g.source} · ${g.route ?? '-'} · ${g.name}: ${g.message.slice(0, 200)}`),
        'Detalle en /super-admin/salud y en Workers Logs.',
      ],
    })
  } catch {
    /* alerts are best effort */
  }
}

/**
 * Also captures the many existing `console.error(..., error)` calls in routes that catch their own
 * errors (Next's onRequestError never sees those). Only the Error object is recorded, never the
 * other arguments (they can contain customer data). Idempotent.
 */
export function installConsoleErrorCapture(): void {
  if (originalConsoleError) return
  originalConsoleError = console.error
  const original = originalConsoleError
  console.error = (...args: unknown[]) => {
    original.apply(console, args as [])
    if (reporting) return
    const err = args.find((a): a is Error => a instanceof Error)
    if (!err) return
    const label = typeof args[0] === 'string' && args[0].length <= 120 ? args[0] : null
    reportError({ source: 'server', name: err.name, message: err.message, stack: err.stack, route: label })
  }
}

/** For tests. */
export function resetObservabilityForTests(): void {
  pending.clear()
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = null
  tableMissingUntil = 0
  alertsInWindow = 0
  alertWindowStart = 0
  if (originalConsoleError) console.error = originalConsoleError
  originalConsoleError = null
}

export function pendingGroupCount(): number {
  return pending.size
}
