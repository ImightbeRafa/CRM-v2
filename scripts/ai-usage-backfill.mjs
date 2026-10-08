#!/usr/bin/env node
/**
 * One-off: copy past inbox-agent model usage (ChatAgentTurn) into "AiUsageEvent" (SQL 048) so the owner AI
 * dashboard shows history from before the meter existed. Idempotent: sourceKey = 'turn:<id>' with
 * ON CONFLICT DO NOTHING. Only turns BEFORE the meter cutover are copied (the first metered inbox/probar call,
 * or --until=YYYY-MM-DD), so nothing is counted twice. Only turns that used tokens are copied.
 *
 * Required:
 *   AI_USAGE_BACKFILL_CONFIRM_HOST=<exact DIRECT_URL hostname>
 * Usage:
 *   AI_USAGE_BACKFILL_CONFIRM_HOST=db.xxxx.supabase.co node --env-file=.env.local scripts/ai-usage-backfill.mjs [--dry-run]
 *
 * Writes only "AiUsageEvent" rows (ids, model, tokens, cost, timing — no customer text). Never deletes anything.
 */
import postgres from 'postgres'

function fail(message) {
  console.error(`ai-usage-backfill: ${message}`)
  process.exit(1)
}

const url = process.env.DIRECT_URL || ''
const confirmHost = process.env.AI_USAGE_BACKFILL_CONFIRM_HOST
if (!url) fail('DIRECT_URL is not set.')
if (!confirmHost) fail('Set AI_USAGE_BACKFILL_CONFIRM_HOST to the exact database hostname.')
let parsed
try {
  parsed = new URL(url)
} catch {
  fail('DIRECT_URL is not a valid URL.')
}
if (parsed.hostname !== confirmHost) fail(`Host mismatch: url has ${parsed.hostname}, confirm host is ${confirmHost}.`)
if (parsed.port && parsed.port !== '5432') fail(`Refusing pooler/non-direct port ${parsed.port}. Use DIRECT_URL on 5432.`)

const dryRun = process.argv.includes('--dry-run')
const untilArg = process.argv.find((a) => a.startsWith('--until='))?.slice('--until='.length)
if (untilArg && !/^\d{4}-\d{2}-\d{2}$/.test(untilArg)) fail('--until must be YYYY-MM-DD.')

const sql = postgres(url, { ssl: 'require', max: 1 })

try {
  const [{ ok }] = await sql`SELECT to_regclass('public."AiUsageEvent"') IS NOT NULL AS ok`
  if (!ok) fail('AiUsageEvent does not exist yet (apply SQL 048 first).')

  // Meter start = first LIVE-metered inbox call (backfilled 'turn:' rows excluded). Read as UTC text so the
  // operator's local time zone can never shift it (createdAt is a UTC timestamp without time zone).
  const [first] = await sql`
    SELECT to_char(MIN("createdAt"), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
      FROM "AiUsageEvent"
     WHERE "feature" IN ('inbox_agent', 'probar', 'shortcut_import') AND "sourceKey" NOT LIKE 'turn:%'`
  const meterStart = first?.at ? new Date(first.at) : null
  let cutover
  if (untilArg) {
    cutover = new Date(`${untilArg}T00:00:00Z`)
    if (meterStart && cutover > meterStart && !process.argv.includes('--force')) {
      fail(`--until ${untilArg} is after the meter start (${meterStart.toISOString()}): that would count usage twice. Use --force only if you are sure.`)
    }
  } else {
    cutover = meterStart ?? new Date()
  }
  console.log(`Cutover: copying ChatAgentTurn rows created before ${cutover.toISOString()}`)

  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n FROM "ChatAgentTurn"
     WHERE "createdAt" < ${cutover} AND ("inputTokens" > 0 OR "outputTokens" > 0)`
  console.log(`Candidate turns: ${n}`)
  if (dryRun) {
    console.log('Dry run: nothing written.')
  } else {
    const result = await sql`
      INSERT INTO "AiUsageEvent"
        ("id", "sourceKey", "tenantId", "feature", "provider", "model", "keyLabel", "agentId", "conversationId",
         "inputTokens", "cachedTokens", "outputTokens", "reasoningTokens", "units", "costMicros", "pricingVersion",
         "latencyMs", "status", "errorCode", "createdAt")
      SELECT
        gen_random_uuid()::text,
        'turn:' || t."id",
        t."tenantId",
        CASE WHEN t."automationDeliveryKey" LIKE 'shortcut-import:%' THEN 'shortcut_import'
             WHEN t."mode" = 'test' THEN 'probar'
             ELSE 'inbox_agent' END,
        CASE WHEN t."model" LIKE 'gpt-%' THEN 'openai' ELSE 'xai' END,
        t."model",
        CASE WHEN t."model" LIKE 'gpt-%' THEN 'SOFT_AI_OPENAI_API_KEY' ELSE 'XAI_API_KEY' END,
        t."agentId",
        t."conversationId",
        COALESCE(t."inputTokens", 0),
        COALESCE(t."cachedInputTokens", 0),
        COALESCE(t."outputTokens", 0),
        COALESCE(t."reasoningTokens", 0),
        1,
        COALESCE(t."estimatedCostMicros", 0),
        'backfill-' || COALESCE(t."pricingVersion", 'unknown'),
        t."latencyMs",
        CASE WHEN t."status" = 'failed' THEN 'error' ELSE 'ok' END,
        t."errorCode",
        t."createdAt"
      FROM "ChatAgentTurn" t
      WHERE t."createdAt" < ${cutover} AND (t."inputTokens" > 0 OR t."outputTokens" > 0)
      ON CONFLICT ("sourceKey") DO NOTHING`
    console.log(`Inserted: ${result.count} (already present rows were skipped)`)
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
