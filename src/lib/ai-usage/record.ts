/**
 * recordAiUsage — append one row to "AiUsageEvent" (SQL 048) for every AI provider call in Betsy.
 * Fire-and-forget: never throws, never awaits in the caller's path, silently skipped while the table is missing.
 * No customer text is ever recorded (ids, model, tokens, cost, timing only).
 * Must not import from the staff bot or the inbox agent: both import this.
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { currentAiUsageContext } from '@/lib/ai-usage/context'
import { AI_PRICING_VERSION, aiProviderFor, estimateAiCostMicros } from '@/lib/ai-usage/rate-card'

export type AiUsageFeature =
  | 'inbox_agent'
  | 'probar'
  | 'agent_test'
  | 'agent_import'
  | 'shortcut_import'
  | 'vision'
  | 'transcription'
  | 'customer_paste'
  | 'staff_bot'
  | 'staff_bot_voice'
  | 'template'
  | 'other'

export type AiUsageEventInput = {
  feature?: AiUsageFeature
  model: string
  tenantId?: string | null
  provider?: string
  keyLabel?: string | null
  agentId?: string | null
  conversationId?: string | null
  userId?: string | null
  inputTokens?: number
  cachedTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  audioSeconds?: number | null
  units?: number
  latencyMs?: number | null
  status?: 'ok' | 'error'
  errorCode?: string | null
  /** Stable key for idempotent writes (backfill / retries). Random when omitted. */
  sourceKey?: string
}

const TABLE_TTL_READY_MS = 5 * 60_000
const TABLE_TTL_MISSING_MS = 30_000
let tableState: { at: number; ready: boolean } | null = null

async function tableReady(): Promise<boolean> {
  if (tableState && Date.now() - tableState.at < (tableState.ready ? TABLE_TTL_READY_MS : TABLE_TTL_MISSING_MS)) {
    return tableState.ready
  }
  let ready = false
  try {
    const rows = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT to_regclass('public."AiUsageEvent"') IS NOT NULL AS "ok"`
    ready = rows[0]?.ok === true
  } catch {
    ready = false
  }
  tableState = { at: Date.now(), ready }
  return ready
}

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0)
const short = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** Exported for tests: the row that would be written. */
export function buildAiUsageRow(input: AiUsageEventInput) {
  const scope = currentAiUsageContext()
  const model = short(input.model, 80) || 'unknown'
  const audioSeconds =
    typeof input.audioSeconds === 'number' && Number.isFinite(input.audioSeconds) && input.audioSeconds > 0
      ? Math.round(input.audioSeconds * 100) / 100
      : null
  const row = {
    id: randomUUID(),
    sourceKey: short(input.sourceKey, 200) || `evt:${randomUUID()}`,
    tenantId: input.tenantId !== undefined ? input.tenantId : (scope?.tenantId ?? null),
    feature: short(input.feature || scope?.feature, 40) || 'other',
    provider: short(input.provider, 20) || aiProviderFor(model),
    model,
    keyLabel: short(input.keyLabel, 40),
    agentId: short(input.agentId, 64),
    conversationId: short(input.conversationId ?? scope?.conversationId ?? null, 64),
    userId: short(input.userId ?? scope?.userId ?? null, 64),
    inputTokens: int(input.inputTokens),
    cachedTokens: int(input.cachedTokens),
    outputTokens: int(input.outputTokens),
    reasoningTokens: int(input.reasoningTokens),
    audioSeconds,
    units: Math.max(1, int(input.units) || 1),
    costMicros: estimateAiCostMicros({
      model,
      inputTokens: input.inputTokens,
      cachedTokens: input.cachedTokens,
      outputTokens: input.outputTokens,
      audioSeconds,
    }),
    pricingVersion: AI_PRICING_VERSION,
    latencyMs: input.latencyMs != null ? int(input.latencyMs) : null,
    status: input.status === 'error' ? 'error' : 'ok',
    errorCode: short(input.errorCode, 80),
  }
  return row
}

async function write(input: AiUsageEventInput): Promise<void> {
  if (!(await tableReady())) return
  const r = buildAiUsageRow(input)
  await prisma.$executeRaw`
    INSERT INTO "AiUsageEvent"
      ("id", "sourceKey", "tenantId", "feature", "provider", "model", "keyLabel", "agentId", "conversationId",
       "userId", "inputTokens", "cachedTokens", "outputTokens", "reasoningTokens", "audioSeconds", "units",
       "costMicros", "pricingVersion", "latencyMs", "status", "errorCode")
    VALUES (${r.id}, ${r.sourceKey}, ${r.tenantId}, ${r.feature}, ${r.provider}, ${r.model}, ${r.keyLabel},
            ${r.agentId}, ${r.conversationId}, ${r.userId}, ${r.inputTokens}, ${r.cachedTokens}, ${r.outputTokens},
            ${r.reasoningTokens}, ${r.audioSeconds}, ${r.units}, ${r.costMicros}, ${r.pricingVersion},
            ${r.latencyMs}, ${r.status}, ${r.errorCode})
    ON CONFLICT ("sourceKey") DO NOTHING`
}

/** Record one AI call. Never throws and never delays the caller. */
export function recordAiUsage(input: AiUsageEventInput): void {
  try {
    void write(input).catch(() => {})
  } catch {
    /* metering must never break a caller */
  }
}

/** Short error label for the meter (never the provider's full message). */
export function aiErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { status?: unknown; code?: unknown; name?: unknown }
    if (typeof e.status === 'number') return `http_${e.status}`
    if (typeof e.code === 'string') return e.code.slice(0, 60)
    if (typeof e.name === 'string') return e.name.slice(0, 60)
  }
  return 'error'
}
