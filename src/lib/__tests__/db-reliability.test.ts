/**
 * Incident 2026-10-23 (Postgres slow to accept connections for ~20 min): no message lost, no false alarms.
 * - transient DB errors are classified (init errors carry `errorCode`, request errors `code`);
 * - only "never ran" errors are retried, within a deadline;
 * - the chat webhook answers 503 (Meta re-delivers) instead of a 200 that dropped the message;
 * - a duplicate / conversation race never queries the aborted transaction;
 * - runtime-created lm_* tables get row-level security, without an exclusive lock on every request.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Prisma } from '@prisma/client'
import {
  dbConnErrors5m,
  isRetryableDbError,
  isTransientDbError,
  recordDbConnError,
  resetDbConnErrors,
  withDbRetry,
} from '../db-retry'
import { rlsGuardSql } from '../lm-runtime-rls'

const read = (p: string) => readFileSync(p, 'utf8')

function known(code: string, msg = 'x', meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError(msg, { code, clientVersion: '6.19.3', meta })
}

test('classifier: init errors (errorCode) and request errors (code); P1017 transient but never retried', () => {
  const unreachable = new Prisma.PrismaClientInitializationError("Can't reach database server", '6.19.3', 'P1001')
  assert.equal(unreachable.errorCode, 'P1001')
  assert.equal(isRetryableDbError(unreachable), true)
  assert.equal(isTransientDbError(unreachable), true)
  assert.equal(isRetryableDbError(known('P2024', 'Timed out fetching a new connection from the connection pool')), true)
  assert.equal(isRetryableDbError(known('P2028', 'Transaction API error: Unable to start a transaction in the given time.')), true)
  assert.equal(isRetryableDbError(known('P2028', 'Transaction already closed')), false, 'the body may have run')
  assert.equal(isTransientDbError(known('P2028', 'Transaction already closed')), true)
  assert.equal(isRetryableDbError(known('P1017', 'Server has closed the connection.')), false, 'a write may have committed')
  assert.equal(isTransientDbError(known('P1017', 'Server has closed the connection.')), true)
  assert.equal(isTransientDbError(known('P2002')), false)
  assert.equal(isTransientDbError(new Error('Raw query failed. Code: `XX000`. Message: `could not accept SSL connection`')), true)
  assert.equal(isTransientDbError(new Error('Invalid value for argument')), false)
  // Deadlock / write conflict: Postgres rolled the whole transaction back → safe to rerun (two bubbles of one chat).
  assert.equal(isRetryableDbError(known('P2034', 'Transaction failed due to a write conflict or a deadlock')), true)
  assert.equal(isRetryableDbError(known('P2010', 'Raw query failed. Code: `40P01`. Message: `deadlock detected`')), true)
  assert.equal(isRetryableDbError(new Error('ERROR: deadlock detected')), true)
  // Text is never read from validation / known errors: a customer's message can contain these words.
  const validation = new Prisma.PrismaClientValidationError('Invalid `create()` … content: "connection refused ETIMEDOUT deadlock detected"', { clientVersion: '6.19.3' })
  assert.equal(isTransientDbError(validation), false)
  assert.equal(isRetryableDbError(validation), false)
  assert.equal(isTransientDbError(known('P2000', 'value too long: "could not accept SSL connection"')), false)
})

test('Soft AI queue: null (→ 503) only when the database was unreachable; any other failure is a skip (→ 200)', () => {
  const hook = read('src/lib/soft-ai/inbound-hook.ts')
  assert.match(hook, /return isTransientDbError\(error\) \? null : \{ skippedReason: 'enqueue_failed' \}/)
})

test('withDbRetry: retries never-ran errors with backoff, stops at the deadline, never retries other errors', async () => {
  resetDbConnErrors()
  const waits: number[] = []
  let calls = 0
  const value = await withDbRetry(
    async () => {
      calls += 1
      if (calls < 3) throw known('P2024')
      return 'ok'
    },
    { sleep: async (ms) => void waits.push(ms) },
  )
  assert.equal(value, 'ok')
  assert.equal(calls, 3)
  assert.equal(waits.length, 2)
  assert.ok(waits[0] >= 250 && waits[0] <= 350 && waits[1] >= 1000 && waits[1] <= 1400)
  assert.equal(dbConnErrors5m(), 2, 'each transient failure is counted for the watchdog')

  let other = 0
  await assert.rejects(
    withDbRetry(async () => {
      other += 1
      throw known('P2002')
    }, { sleep: async () => {} }),
  )
  assert.equal(other, 1, 'a unique violation is never retried')

  // Deadline: a slow failure (pool_timeout) uses the budget up, no second wait.
  let t = 0
  let slow = 0
  await assert.rejects(
    withDbRetry(
      async () => {
        slow += 1
        t += 30_000
        throw known('P2024')
      },
      { sleep: async () => {}, now: () => t, deadlineMs: 8_000 },
    ),
  )
  assert.equal(slow, 1)
})

test('connection-error counter keeps only the last 5 minutes', () => {
  resetDbConnErrors()
  recordDbConnError(1_000)
  recordDbConnError(200_000)
  assert.equal(dbConnErrors5m(250_000), 2)
  assert.equal(dbConnErrors5m(1_000 + 5 * 60_000), 1)
})

test('chat write: duplicate / conversation race never query the aborted transaction; transient is its own reason', () => {
  const src = read('src/lib/chat-conversation-write.ts')
  const ensure = src.slice(src.indexOf('async function ensureConversation'), src.indexOf('/** Customer messages (non-duplicate)'))
  assert.doesNotMatch(ensure, /catch \(error\) \{[\s\S]*?tx\.chatConversation\.findUnique/, 'no lookup on the aborted tx')
  const write = src.slice(src.indexOf('export async function dualWriteChatMessage'), src.indexOf('/**\n * Update outbound row after Graph call'))
  assert.doesNotMatch(write, /isP2002\(error\) && providerMessageId\) \{\s+const dup = await findExistingByProviderId\(\s+tx,/)
  assert.match(write, /result = await withDbRetry\(writeOnce\)/)
  assert.match(write, /if \(!isConversationRace\(error\)\) throw error/)
  assert.match(write, /findExistingByProviderId\(prisma as unknown as Prisma\.TransactionClient/, 'duplicate lookup outside the tx')
  assert.match(write, /reason: transient \? 'transient' : 'error'/)
  assert.match(write, /\}, DUAL_WRITE_TX_OPTIONS\)/)
  assert.match(src, /const DUAL_WRITE_TX_OPTIONS = \{ maxWait: 5_000, timeout: 10_000 \} as const/)
  // The hot SocialAccount row is no longer written inside every message transaction.
  assert.doesNotMatch(write, /await tx\.socialAccount\.update\(/)
  assert.match(write, /touchSocialAccountActivity\(input\.socialAccountId, input\.direction\)/)
  assert.match(src, /\{ lastErrorCode: \{ not: null \} \}/, 'a flagged line is always stamped so channel-silence can clear it')
})

test('conversation race is told apart from a duplicate message by the unique target', async () => {
  const { isConversationRace } = await import('../chat-conversation-write')
  assert.equal(isConversationRace(known('P2002', 'u', { target: ['tenantId', 'socialAccountId', 'peerId'] })), true)
  assert.equal(isConversationRace(known('P2002', 'u', { target: 'ChatConversation_tenantId_socialAccountId_peerId_key' })), true)
  assert.equal(isConversationRace(known('P2002', 'u', { target: ['socialAccountId', 'providerMessageId'] })), false)
  assert.equal(isConversationRace(known('P2002', 'u', { target: 'ChatMessage_socialAccountId_providerMessageId_uidx' })), false)
  assert.equal(isConversationRace(known('P2024')), false)
})

test('chat webhook: 503 when the database was unreachable (Meta re-delivers), never a 200 that drops the message', () => {
  const src = read('src/app/api/chat/webhook/route.ts')
  assert.match(src, /transient: result\.reason === 'transient'/)
  assert.match(src, /let transientFailure = results\.some\(\(result\) => 'transient' in result && result\.transient\)/)
  assert.match(src, /if \(transientFailure\) \{[\s\S]*?status: 503/)
  assert.ok(src.indexOf('if (transientFailure) {') < src.lastIndexOf('ignoredReasons: parsed.ignoredReasons'), '503 before the 200')
  // Queue write failed for a stored message → 503; the retry (a duplicate) queues it, recent messages only.
  assert.match(src, /if \(enqueued === null\) \{\s+transientFailure = true/)
  assert.match(src, /const RETRY_ENQUEUE_MAX_AGE_MS = 30 \* 60_000/)
  assert.match(src, /if \('jobId' in enqueued && !\(isRetry && enqueued\.duplicate\)\)/, 'an existing job is not dispatched twice')
  // The audit row can no longer turn a stored message into a 500.
  assert.match(src, /webhookLog\.create\([\s\S]*?\}\)\.catch\(\(\) => \{/)
  assert.match(src, /await withDbRetry\(\(\) => resolveWebhookSocialAccount\(prisma as any, event\)\)/)
})

test('runtime lm_* tables: RLS only when off (no exclusive lock per request), once per process', () => {
  const sql = rlsGuardSql('lm_retiro_stock')
  assert.match(sql, /WHERE n\.nspname = 'public' AND c\.relname = 'lm_retiro_stock' AND c\.relkind = 'r';/)
  assert.match(sql, /IF rls IS FALSE THEN\s+EXECUTE 'ALTER TABLE public\.lm_retiro_stock ENABLE ROW LEVEL SECURITY'/, 'only when off (missing table → NULL → no-op)')
  assert.doesNotMatch(sql, /::regclass/)
  assert.doesNotMatch(sql, /FORCE/)
  assert.throws(() => rlsGuardSql('users; drop table x'))
  assert.throws(() => rlsGuardSql('Order'))

  // Every table the app creates at runtime is covered.
  for (const file of ['src/lib/retiro-stock.ts', 'src/app/api/logistics/private-delivery/route.ts']) {
    const src = read(file)
    const created = [...src.matchAll(/CREATE TABLE IF NOT EXISTS (lm_[a-z0-9_]+)/g)].map((m) => m[1])
    assert.ok(created.length > 0, file)
    for (const t of created) assert.ok(src.includes(`'${t}'`), `${file}: ${t} missing from ensureRlsEnabled`)
  }
  const pd = read('src/app/api/logistics/private-delivery/route.ts')
  assert.match(pd, /if \(!ensurePromise\) \{\s+ensurePromise = createPrivateDeliveryTable\(\)/, 'DDL once per process, not per request')
})
