import 'server-only'
import { errorFingerprint } from '@/lib/observability/fingerprint'
import { cleanText, scrubPii } from '@/lib/observability/scrub'
import { isProductionContainer } from '@/lib/ops/runtime'

/**
 * Betsy's own error tracking (replaced Sentry 2026-10-02, free, data stays in our infrastructure).
 *
 * Every report:
 *  1. writes ONE scrubbed JSON line to the console → Cloudflare Workers Logs (searchable, live);
 *  2. counts it in an in-memory group; a flush every 15 s upserts the groups into OpsErrorGroup
 *     (one statement per group, each on its own, so one bad row never hides the others);
 *  3. a NEW server error group emails the platform owner (OPS_ALERT_EMAIL), capped; browser groups
 *     never email (their text comes from the internet).
 *
 * Abuse limits (SecureDog 2026-10-02): browser reports have their own small budget of new groups
 * (per window and per day); only the production container writes to the database (the Railway
 * preview shares it); old groups are purged nightly (purgeErrorGroups).
 * Never throws, never stores request bodies or arguments other than the error itself.
 */
export type ErrorSource = 'server' | 'client' | 'edge' | 'cron' | 'ops'

export type ErrorReport = {
  source: ErrorSource
  name: string
  message: string
  stack?: string
  route?: string | null
}

type Pending = { report: ErrorReport; count: number; firstAt: number; lastAt: number; tries: number }

const FLUSH_MS = 15_000
const MAX_PENDING_GROUPS = 200
const MAX_PENDING_CLIENT_GROUPS = 20
const MAX_NEW_CLIENT_GROUPS_PER_DAY = 200
const MISSING_TABLE_BACKOFF_MS = 10 * 60_000
const MAX_NEW_GROUP_ALERTS_PER_HOUR = 6

const pending = new Map<string, Pending>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let tableMissingUntil = 0
let alertWindowStart = 0
let alertsInWindow = 0
let lastFlushFailureAlertAt = 0
let originalConsoleError: typeof console.error | null = null
let reporting = false

function clip(value: string | undefined | null, max: number): string | null {
  if (!value) return null
  // Cut on code points, then clean again: never leave half a surrogate pair (Postgres rejects it).
  const cut = value.length > max ? `${Array.from(value).slice(0, max - 1).join('')}…` : value
  return cleanText(cut)
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

function log(...args: unknown[]) {
  ;(originalConsoleError ?? console.error).call(console, ...args)
}

/** Records one error (log line now, DB group on the next flush). Never throws. */
export function reportError(input: ErrorReport): void {
  if (reporting) return
  reporting = true
  try {
    const report = sanitizeReport(input)
    const id = errorFingerprint(report)
    log(JSON.stringify({ level: 'error', kind: 'betsy.error', id, ...report, stack: report.stack?.split('\n').slice(0, 6).join('\n') }))

    const now = Date.now()
    const existing = pending.get(id)
    if (existing) {
      existing.count += 1
      existing.lastAt = now
    } else {
      const clientPending = report.source === 'client' ? [...pending.values()].filter((p) => p.report.source === 'client').length : 0
      const roomForClient = report.source !== 'client' || clientPending < MAX_PENDING_CLIENT_GROUPS
      if (pending.size < MAX_PENDING_GROUPS && roomForClient) {
        pending.set(id, { report, count: 1, firstAt: now, lastAt: now, tries: 0 })
      }
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

function isMissingTableError(error: unknown): boolean {
  const e = error as { code?: unknown; meta?: { code?: unknown } } | null
  const code = String(e?.meta?.code ?? e?.code ?? '')
  if (code === 'P2021' || code === '42P01') return true
  return /relation "?(public\.)?"?OpsErrorGroup"? does not exist/i.test(error instanceof Error ? error.message : '')
}

/** Writes pending groups. Exported for tests and for graceful shutdown. */
export async function flushErrorGroups(env: Record<string, string | undefined> = process.env): Promise<{ written: number; newGroups: number; failed: number; skipped?: string }> {
  if (pending.size === 0) return { written: 0, newGroups: 0, failed: 0 }
  const batch = [...pending.entries()]
  pending.clear()
  if (!isProductionContainer(env)) return { written: 0, newGroups: 0, failed: 0, skipped: 'not_production' }
  if (Date.now() < tableMissingUntil) return { written: 0, newGroups: 0, failed: 0, skipped: 'table_missing' }

  let written = 0
  let failed = 0
  const fresh: ErrorReport[] = []
  const release = 'prod'
  let prisma: typeof import('@/lib/db').prisma
  try {
    ;({ prisma } = await import('@/lib/db'))
  } catch {
    return { written: 0, newGroups: 0, failed: batch.length, skipped: 'db_unavailable' }
  }

  // Browser groups: only existing ones are counted once the daily budget of new ones is used.
  let clientBudget = 0
  if (batch.some(([, p]) => p.report.source === 'client')) {
    try {
      const [row] = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM public."OpsErrorGroup"
        WHERE "source" = 'client' AND "firstSeen" > now() - interval '1 day'`
      clientBudget = Math.max(0, MAX_NEW_CLIENT_GROUPS_PER_DAY - Number(row?.n ?? 0))
    } catch (error) {
      if (isMissingTableError(error)) {
        tableMissingUntil = Date.now() + MISSING_TABLE_BACKOFF_MS
        return { written: 0, newGroups: 0, failed: 0, skipped: 'table_missing' }
      }
    }
  }

  for (const [id, p] of batch) {
    try {
      const allowInsert = p.report.source !== 'client' || clientBudget > 0
      const rows = allowInsert
        ? await prisma.$queryRaw<Array<{ inserted: boolean }>>`
            INSERT INTO public."OpsErrorGroup" ("id", "source", "route", "name", "message", "stack", "count", "firstSeen", "lastSeen", "release")
            VALUES (${id}, ${p.report.source}, ${p.report.route ?? null}, ${p.report.name}, ${p.report.message},
                    ${p.report.stack ?? null}, ${p.count}, ${new Date(p.firstAt)}, ${new Date(p.lastAt)}, ${release})
            ON CONFLICT ("id") DO UPDATE SET
              "count" = public."OpsErrorGroup"."count" + EXCLUDED."count",
              "lastSeen" = GREATEST(public."OpsErrorGroup"."lastSeen", EXCLUDED."lastSeen"),
              "route" = coalesce(EXCLUDED."route", public."OpsErrorGroup"."route"),
              "status" = CASE WHEN public."OpsErrorGroup"."status" = 'resolved' THEN 'open' ELSE public."OpsErrorGroup"."status" END
            RETURNING (xmax = 0) AS inserted`
        : await prisma.$queryRaw<Array<{ inserted: boolean }>>`
            UPDATE public."OpsErrorGroup"
            SET "count" = "count" + ${p.count}, "lastSeen" = GREATEST("lastSeen", ${new Date(p.lastAt)})
            WHERE "id" = ${id}
            RETURNING false AS inserted`
      written += rows.length
      if (rows[0]?.inserted) {
        if (p.report.source === 'client') clientBudget -= 1
        else fresh.push(p.report)
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        tableMissingUntil = Date.now() + MISSING_TABLE_BACKOFF_MS
        return { written, newGroups: fresh.length, failed, skipped: 'table_missing' }
      }
      failed += 1
      // One retry on the next flush; a row that fails twice is dropped (it stays in Workers Logs).
      if (p.tries < 1 && pending.size < MAX_PENDING_GROUPS && !pending.has(id)) pending.set(id, { ...p, tries: p.tries + 1 })
      log('[observability] group write failed', error instanceof Error ? error.name : 'unknown')
    }
  }
  if (pending.size) scheduleFlush()
  if (fresh.length) await alertNewGroups(fresh)
  if (failed > 0 && written === 0) await alertFlushFailure(failed)
  return { written, newGroups: fresh.length, failed }
}

/** Email lines carry no error text: kind, route and name only (the details are on the Salud page). */
function emailSafe(value: string | null | undefined, max: number): string {
  return (value ?? '-').replace(/https?:\/\/\S+/gi, '[url]').replace(/[^\p{L}\p{N} ._:/()[\]-]/gu, ' ').slice(0, max)
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
      subject: groups.length === 1 ? 'Error nuevo en el servidor' : `${groups.length} errores nuevos en el servidor`,
      lines: [
        ...groups.slice(0, 5).map((g) => `${g.source} · ${emailSafe(g.route, 120)} · ${emailSafe(g.name, 60)}`),
        'Detalle en /super-admin/salud y en Workers Logs.',
      ],
    })
  } catch {
    /* alerts are best effort */
  }
}

async function alertFlushFailure(failed: number) {
  const now = Date.now()
  if (now - lastFlushFailureAlertAt < 60 * 60_000) return
  lastFlushFailureAlertAt = now
  try {
    const { sendOpsAlert } = await import('@/lib/ops/alert-email')
    await sendOpsAlert({
      key: 'error-tracking-down',
      subject: 'El registro de errores no puede escribir en la base de datos',
      lines: [`${failed} grupos no se guardaron. Revisá Workers Logs y la base de datos.`],
    })
  } catch {
    /* best effort */
  }
}

/**
 * Nightly: browser groups unseen for 14 days and server groups unseen for 90 days are removed,
 * and the table never keeps more than 5000 groups (oldest first).
 */
export async function purgeErrorGroups(): Promise<{ deleted: number; skipped?: string }> {
  try {
    const { prisma } = await import('@/lib/db')
    const aged = await prisma.$executeRaw`
      DELETE FROM public."OpsErrorGroup"
      WHERE ("source" = 'client' AND "lastSeen" < now() - interval '14 days')
         OR ("source" <> 'client' AND "lastSeen" < now() - interval '90 days')`
    const capped = await prisma.$executeRaw`
      DELETE FROM public."OpsErrorGroup" WHERE "id" IN (
        SELECT "id" FROM public."OpsErrorGroup" ORDER BY "lastSeen" DESC OFFSET 5000
      )`
    return { deleted: aged + capped }
  } catch (error) {
    if (isMissingTableError(error)) return { deleted: 0, skipped: 'table_missing' }
    throw error
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
    if (reporting) {
      original.apply(console, args as [])
      return
    }
    reporting = true
    try {
      original.apply(console, args as [])
    } finally {
      reporting = false
    }
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
  lastFlushFailureAlertAt = 0
  if (originalConsoleError) console.error = originalConsoleError
  originalConsoleError = null
}

export function pendingGroupCount(): number {
  return pending.size
}
