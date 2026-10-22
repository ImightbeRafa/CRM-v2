/**
 * AI provider health + the test budget (wave 2026-10-22, lane D). Called from softAiResponsesCreate (every Soft AI call,
 * live and test). Never throws to the caller except TEST_BUDGET_EXCEEDED (a test call refused before it is made).
 *
 * Provider down: the first quota / 429 / auth / 5xx / not-configured failure of an incident alerts the platform owner
 * once (email + bell, "OpenAI sin crédito / caído"); the first success afterwards sends "volvió". One alert per
 * incident across containers via SQL 061 "AiProviderStatus" (claimed with a conditional UPDATE); without the table,
 * per process.
 *
 * Test budget: Probar / exam / shopper / shadow / test-engine calls (features 'probar', 'agent_test', and every call made
 * inside a test turn) of a business stop at its daily test token cap — never above the platform ceiling
 * AI_TEST_DAILY_TOKEN_CAP (default 2 000 000; env only, the exam scripts' cap raise cannot pass it). 2026-10-22: test
 * runs spent 37.8M tokens on an 800k cap because the scripts raised the cap and grader calls were not counted. Live
 * replies are never checked. The line-activation canary ('agent_activation') keeps its own check. Checked before every
 * test call (cached 3 s); the meter failing to read never blocks.
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
const SUSTAINED_MS = 60_000
const FAILURE_WRITE_INTERVAL_MS = 30_000
let lastFailureWriteAt = 0
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
  // SecureDog INT-216: this process already wrote the open incident in the last minute — no DB write per failure.
  if (now.getTime() - lastFailureWriteAt < FAILURE_WRITE_INTERVAL_MS) return
  lastFailureWriteAt = now.getTime()
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
      // Verifier: no flapping — quota / auth / missing key alert at once; 5xx only once the incident lasted 60 s.
      const sustainedSince = new Date(now.getTime() - (kind === 'server' ? SUSTAINED_MS : 0))
      const claimed = await prisma.$queryRaw<Array<{ downSince: Date }>>`
        UPDATE "AiProviderStatus" SET "alertedAt" = ${now}
         WHERE "provider" = ${PROVIDER} AND "downSince" IS NOT NULL AND "downSince" <= ${sustainedSince} AND "alertedAt" IS NULL
        RETURNING "downSince"`
      // SecureDog INT-216: the alert key is per kind and hour, so a flapping provider mails at most once an hour.
      if (claimed[0]) await alertOwner('down', `${kind}:${now.toISOString().slice(0, 13)}`, kind!)
      return
    }
  } catch (dbError) {
    console.error('[provider-outage] status write failed', dbError instanceof Error ? dbError.name : 'unknown')
  }
  if (kind === 'server' && knownDownSince !== null && now.getTime() - knownDownSince < SUSTAINED_MS) return
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
    // SecureDog INT-216: "volvió" only after a real incident (it lasted 2 min or more), once an hour.
    if (closed[0]?.alertedAt && now.getTime() - new Date(closed[0].downSince).getTime() >= 2 * 60_000) {
      await alertOwner('up', now.toISOString().slice(0, 13))
    }
  } catch (error) {
    console.error('[provider-outage] status close failed', error instanceof Error ? error.name : 'unknown')
  }
}

/* ---------------------------------------------------------------- test budget */

/** Features that are tests (Probar, exams, shoppers, shadow, test engine): never live customer replies. */
export const TEST_AI_FEATURES = new Set(['probar', 'agent_test'])
/** Platform ceiling on a business's daily test tokens: exam scripts may raise the business's own cap, never past this. */
const DEFAULT_TEST_DAILY_TOKEN_CEILING = 2_000_000
const TEST_SPEND_TTL_MS = 3_000
const testSpendCache = new Map<string, { at: number; day: string; tokens: number; cap: number }>()

export class TestBudgetExceededError extends Error {
  constructor() {
    super('TEST_BUDGET_EXCEEDED')
    this.name = 'TestBudgetExceededError'
  }
}

/** Platform ceiling in tokens (env AI_TEST_DAILY_TOKEN_CAP; 0 or invalid = default). Only env changes it. */
export function testDailyTokenCeiling(raw: string | undefined = process.env.AI_TEST_DAILY_TOKEN_CAP): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_TEST_DAILY_TOKEN_CEILING
}

/** The business's cap (testDailyTokenCap, as Agentes shows it) never above the platform ceiling. */
export function effectiveTestCap(businessCap: number, ceiling = testDailyTokenCeiling()): number {
  return Math.min(Number.isFinite(businessCap) && businessCap > 0 ? businessCap : ceiling, ceiling)
}

/** UTC day start, the same day loadDailyTestTokens counts ("pruebas hoy"). */
export function testDayStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * Throws TestBudgetExceededError when the business's test tokens today (every metered test call: agent turns, graders,
 * simulated shoppers, and the calls inside a test turn) reached its cap. Live features are never checked.
 */
export async function assertTestBudget(feature: string | null | undefined, tenantId: string | null = null, now = new Date()): Promise<void> {
  if (!feature || !TEST_AI_FEATURES.has(feature) || !tenantId) return
  const start = testDayStartUtc(now)
  const day = start.toISOString()
  let tokens: number
  let cap: number
  const hit = testSpendCache.get(tenantId)
  if (hit && hit.day === day && now.getTime() - hit.at < TEST_SPEND_TTL_MS) {
    tokens = hit.tokens
    cap = hit.cap
  } else {
    try {
      if (!(await isTableReady('AiUsageEvent'))) return
      const [{ readChatAgentLayerConfig }, { parseChatAgentLayerConfig }] = await Promise.all([
        import('@/lib/feature-flags'),
        import('@/lib/soft-ai/agent-config'),
      ])
      const [rows, layer] = await Promise.all([
        prisma.$queryRaw<Array<{ used: bigint | number | null }>>`
          SELECT COALESCE(SUM("inputTokens" + "outputTokens"), 0)::bigint AS "used"
            FROM "AiUsageEvent"
           WHERE "tenantId" = ${tenantId} AND "feature" IN ('probar', 'agent_test') AND "createdAt" >= ${start}`,
        readChatAgentLayerConfig(tenantId),
      ])
      tokens = Number(rows[0]?.used ?? 0)
      cap = effectiveTestCap(parseChatAgentLayerConfig(layer.config).testDailyTokenCap)
      if (testSpendCache.size > 500) testSpendCache.clear()
      testSpendCache.set(tenantId, { at: now.getTime(), day, tokens, cap })
    } catch (error) {
      console.error('[provider-outage] test spend read failed', error instanceof Error ? error.name : 'unknown')
      return
    }
  }
  if (tokens >= cap) throw new TestBudgetExceededError()
}

/**
 * The feature a call is metered and capped under. Inside a test turn (ambient scope test: true) every call — the payment
 * check, image reading, … — counts as that test's spend, so nothing a test does escapes the cap.
 */
export function testAwareFeature(feature: string, scope: { test?: boolean; feature?: string } | undefined): string {
  if (TEST_AI_FEATURES.has(feature) || !scope?.test) return feature
  return scope.feature && TEST_AI_FEATURES.has(scope.feature) ? scope.feature : 'agent_test'
}
