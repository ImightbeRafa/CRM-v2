/**
 * AI provider health + the test budget (wave 2026-10-22, lane D). Called from softAiResponsesCreate (every Soft AI call,
 * live and test). Never throws to the caller except TEST_BUDGET_EXCEEDED (a test call refused before it is made).
 *
 * Provider down: the first quota / 429 / auth / 5xx / not-configured failure of an incident alerts the platform owner
 * once (email + bell, "OpenAI sin crédito / caído"); the first success afterwards sends "volvió". One alert per
 * incident across containers via SQL 060 "AiProviderStatus" (claimed with a conditional UPDATE); without the table,
 * per process.
 *
 * Test budget: Probar / exam / shopper / test-engine calls (features 'probar', 'agent_test') stop at a hard platform
 * daily cap in USD (AI_TEST_DAILY_USD_CAP, default 15; Costa Rica day), so exam runs can never drain the credit live
 * replies need. Checked before every test call (cached a few seconds); the meter failing to read never blocks.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { alertsOwner, classifyProviderFailure, type ProviderFailureKind } from '@/lib/soft-ai/provider-outage-core'

const TABLE = 'AiProviderStatus'
const PROVIDER = 'openai'
/** Per-process view of the incident, so a healthy provider costs no DB write per call. */
let knownDownSince: number | null = null
let localAlertedAt = 0
const LOCAL_ALERT_COOLDOWN_MS = 60 * 60_000
const OK_CHECK_INTERVAL_MS = 60_000
let lastOkCheckAt = 0

const KIND_TEXT: Record<string, string> = {
  quota: 'sin crédito (cuota agotada)',
  rate_limit: 'limitando pedidos (429)',
  auth: 'rechaza la clave (401/403)',
  server: 'con errores del servidor (5xx)',
  not_configured: 'sin clave configurada',
}

async function alertOwner(kind: 'down' | 'up', incident: string, failure?: ProviderFailureKind): Promise<void> {
  try {
    const { sendOpsAlert } = await import('@/lib/ops/alert-email')
    const { notifyOwners } = await import('@/lib/ai-usage-admin/budgets')
    await sendOpsAlert({
      key: `ai-provider:${kind}:${incident}`,
      subject: kind === 'down' ? `OpenAI ${KIND_TEXT[failure || ''] || 'caído'}` : 'OpenAI volvió',
      lines:
        kind === 'down'
          ? [
              `La IA no puede responder: OpenAI está ${KIND_TEXT[failure || ''] || 'fallando'}.`,
              'Los chats se reintentan solos (2, 5, 15, 30 y 60 min); si sigue caído, cada chat pasa al equipo con el aviso "IA sin servicio".',
              'Si es crédito: recargá la cuenta de OpenAI. Las pruebas (Probar / exámenes) tienen su propio tope diario.',
            ]
          : ['OpenAI responde de nuevo. Los chats que estaban esperando se responden en sus próximos reintentos.'],
    })
    await notifyOwners(`ai_budget:provider:${kind}:${incident}`)
  } catch (error) {
    console.error('[provider-outage] alert failed', error instanceof Error ? error.name : 'unknown')
  }
}

/** A Soft AI call failed. Alerts the owner on the first provider-side failure of an incident. Never throws. */
export async function noteProviderFailure(error: unknown, now = new Date()): Promise<void> {
  const kind = classifyProviderFailure(error)
  if (!alertsOwner(kind)) return
  if (knownDownSince === null) knownDownSince = now.getTime()
  try {
    if (await isTableReady(TABLE)) {
      // Open (or keep) the incident, then claim the alert: only the container that flips alertedAt sends it.
      await prisma.$executeRaw`
        INSERT INTO "AiProviderStatus" ("provider", "downSince", "lastKind", "updatedAt")
        VALUES (${PROVIDER}, ${now}, ${kind}, ${now})
        ON CONFLICT ("provider") DO UPDATE SET
          "downSince" = COALESCE("AiProviderStatus"."downSince", EXCLUDED."downSince"),
          "lastKind" = EXCLUDED."lastKind",
          "updatedAt" = EXCLUDED."updatedAt"`
      const claimed = await prisma.$queryRaw<Array<{ downSince: Date }>>`
        UPDATE "AiProviderStatus" SET "alertedAt" = ${now}
         WHERE "provider" = ${PROVIDER} AND "downSince" IS NOT NULL AND "alertedAt" IS NULL
        RETURNING "downSince"`
      if (claimed[0]) await alertOwner('down', new Date(claimed[0].downSince).toISOString(), kind!)
      return
    }
  } catch (dbError) {
    console.error('[provider-outage] status write failed', dbError instanceof Error ? dbError.name : 'unknown')
  }
  if (now.getTime() - localAlertedAt >= LOCAL_ALERT_COOLDOWN_MS) {
    localAlertedAt = now.getTime()
    await alertOwner('down', now.toISOString().slice(0, 13), kind!)
  }
}

/** A Soft AI call succeeded. Closes an open incident ("volvió" once). Cheap when healthy (no DB access). Never throws. */
export async function noteProviderOk(now = new Date()): Promise<void> {
  // Another container may have opened the incident: look at the shared row at most once a minute while healthy.
  if (knownDownSince === null && now.getTime() - lastOkCheckAt < OK_CHECK_INTERVAL_MS) return
  knownDownSince = null
  lastOkCheckAt = now.getTime()
  try {
    if (!(await isTableReady(TABLE))) return
    const closed = await prisma.$queryRaw<Array<{ alertedAt: Date | null; downSince: Date }>>`
      UPDATE "AiProviderStatus" s SET "downSince" = NULL, "alertedAt" = NULL, "recoveredAt" = ${now}, "updatedAt" = ${now}
        FROM (SELECT "alertedAt", "downSince" FROM "AiProviderStatus" WHERE "provider" = ${PROVIDER} FOR UPDATE) old
       WHERE s."provider" = ${PROVIDER} AND s."downSince" IS NOT NULL
      RETURNING old."alertedAt", old."downSince"`
    if (closed[0]?.alertedAt) await alertOwner('up', new Date(closed[0].downSince).toISOString())
  } catch (error) {
    console.error('[provider-outage] status close failed', error instanceof Error ? error.name : 'unknown')
  }
}

/* ---------------------------------------------------------------- test budget */

/** Features that are tests (Probar, exams, shoppers, test engine): never live customer replies. */
export const TEST_AI_FEATURES = new Set(['probar', 'agent_test'])
const DEFAULT_TEST_DAILY_USD = 15
const TEST_SPEND_TTL_MS = 5_000
let testSpendCache: { at: number; day: string; micros: number } | null = null

export class TestBudgetExceededError extends Error {
  constructor() {
    super('TEST_BUDGET_EXCEEDED')
    this.name = 'TestBudgetExceededError'
  }
}

/** Platform daily cap for test AI spend in micro-USD (env AI_TEST_DAILY_USD_CAP; 0 or invalid = default). */
export function testDailyCapMicros(raw: string | undefined = process.env.AI_TEST_DAILY_USD_CAP): number {
  const usd = Number(raw)
  return Math.round((Number.isFinite(usd) && usd > 0 ? usd : DEFAULT_TEST_DAILY_USD) * 1_000_000)
}

/** Costa Rica (UTC-6, no DST) day start in UTC. */
export function costaRicaDayStartUtc(now: Date): Date {
  const cr = new Date(now.getTime() - 6 * 3_600_000)
  return new Date(Date.UTC(cr.getUTCFullYear(), cr.getUTCMonth(), cr.getUTCDate(), 6))
}

/** Throws TestBudgetExceededError when today's test spend reached the cap. Live features are never checked. */
export async function assertTestBudget(feature: string | null | undefined, now = new Date()): Promise<void> {
  if (!feature || !TEST_AI_FEATURES.has(feature)) return
  const start = costaRicaDayStartUtc(now)
  const day = start.toISOString()
  let micros: number
  if (testSpendCache && testSpendCache.day === day && now.getTime() - testSpendCache.at < TEST_SPEND_TTL_MS) {
    micros = testSpendCache.micros
  } else {
    try {
      if (!(await isTableReady('AiUsageEvent'))) return
      const rows = await prisma.$queryRaw<Array<{ spent: bigint | number | null }>>`
        SELECT COALESCE(SUM("costMicros"), 0)::bigint AS "spent"
          FROM "AiUsageEvent"
         WHERE "feature" IN ('probar', 'agent_test') AND "createdAt" >= ${start}`
      micros = Number(rows[0]?.spent ?? 0)
      testSpendCache = { at: now.getTime(), day, micros }
    } catch (error) {
      console.error('[provider-outage] test spend read failed', error instanceof Error ? error.name : 'unknown')
      return
    }
  }
  if (micros >= testDailyCapMicros()) throw new TestBudgetExceededError()
}
