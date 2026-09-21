/**
 * Soft AI ChatAutomationJob durable queue contracts (Phase 4).
 * Source + pure-function checks — no shared-DB mutations, no bot imports.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  LEASE_MS,
  MAX_ATTEMPTS,
  retryDelayMs,
  softAiInboundDeliveryKey,
} from '../soft-ai/automation-queue'
import { hashSoftAiDeliveryContent } from '../soft-ai/automation-delivery'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..', '..')

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8')
}

describe('ChatAutomationJob durable Soft AI queue', () => {
  it('026 migration is additive Soft-only with lease + delivery + media columns', () => {
    const sql = read('supabase/migrations/026_chat_automation_jobs.sql')
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAutomationJob"/)
    assert.match(sql, /CREATE TABLE IF NOT EXISTS public\."ChatAutomationDelivery"/)
    assert.match(sql, /"kind".*'soft_ai_inbound'/)
    assert.match(
      sql,
      /CHECK \("status" IN \('pending', 'processing', 'retry', 'completed', 'failed', 'ambiguous'\)\)/,
    )
    assert.match(sql, /UNIQUE \("deliveryKey"\)/)
    assert.match(sql, /ChatAutomationJob_status_availableAt_createdAt_idx/)
    assert.match(sql, /ChatAutomationJob_tenantId_status_idx/)
    assert.match(sql, /ChatAutomationJob_conversationId_status_createdAt_idx/)
    assert.match(sql, /"mediaBlobPath"/)
    assert.match(sql, /"mediaCacheStatus"/)
    assert.match(sql, /service_role_bypass/)
    assert.match(sql, /CHECK \("status" IN \('ready', 'sending', 'sent', 'ambiguous'\)\)/)
    assert.doesNotMatch(sql, /BotInbox/)
    assert.doesNotMatch(sql, /(^|\n)\s*(DROP|TRUNCATE|DELETE)\s/im)
  })

  it('manifest registers 026 but keeps it gated out of DEFAULT_APPLY_FILES', async () => {
    const manifestUrl = pathToFileURL(
      join(root, 'scripts/lib/betsy-v2-additive-manifest.mjs'),
    ).href
    const manifest = await import(manifestUrl)
    assert.equal(manifest.FILES['026'], '026_chat_automation_jobs.sql')
    assert.deepEqual(manifest.EXPECTED_TABLES['026'], [
      'ChatAutomationJob',
      'ChatAutomationDelivery',
    ])
    assert.ok(
      manifest.EXPECTED_COLUMNS['026'].some(
        ([t, c]: [string, string]) => t === 'ChatMessage' && c === 'mediaBlobPath',
      ),
    )
    assert.ok(manifest.EXPECTED_INDEXES_026.includes('ChatAutomationJob_status_availableAt_createdAt_idx'))
    assert.equal(manifest.DEFAULT_APPLY_FILES, '018,019,020,021,022,023,024')
    assert.ok(!manifest.DEFAULT_APPLY_FILES.includes('025'))
    assert.ok(!manifest.DEFAULT_APPLY_FILES.includes('026'))
  })

  it('claim uses FOR UPDATE SKIP LOCKED, 45s lease, and per-conversation ordering', () => {
    const queue = read('src/lib/soft-ai/automation-queue.ts')
    assert.match(queue, /FOR UPDATE SKIP LOCKED/)
    assert.match(queue, /LEASE_MS = 45_000/)
    assert.equal(LEASE_MS, 45_000)
    assert.match(queue, /older\."conversationId" = current\."conversationId"/)
    assert.match(queue, /NOT EXISTS/)
    assert.match(queue, /soft_tenant_ai_v1/)
    assert.match(queue, /leaseExpiresAt/)
    assert.match(queue, /MAX_ATTEMPTS = 5/)
    assert.equal(MAX_ATTEMPTS, 5)
    assert.match(queue, /status: ambiguous \? 'ambiguous' : terminal \? 'failed' : 'retry'/)
    // Expired processing lease is reclaimable (retry after kill mid-run)
    assert.match(
      queue,
      /current\."status" = 'processing' AND current\."leaseExpiresAt" <= CURRENT_TIMESTAMP/,
    )
  })

  it('claim concurrency: concurrent claimants skip locked rows via SKIP LOCKED', () => {
    const queue = read('src/lib/soft-ai/automation-queue.ts')
    // Candidate CTE + SKIP LOCKED is the concurrency contract
    assert.match(queue, /WITH candidate AS/)
    assert.match(queue, /FOR UPDATE SKIP LOCKED/)
    assert.match(queue, /LIMIT \$\{limit\}/)
    // Per-conversation serialization prevents two Soft AI replies racing one peer
    assert.match(
      queue,
      /older\."status" IN \('pending', 'retry', 'processing'\)/,
    )
  })

  it('deliverOnce enforces unique deliveryKey exactly-once (ready→sending→sent / ambiguous)', () => {
    const delivery = read('src/lib/soft-ai/automation-delivery.ts')
    assert.match(delivery, /status: 'ready'/)
    assert.match(delivery, /status: 'sending'/)
    assert.match(delivery, /status: 'sent'/)
    assert.match(delivery, /status: 'ambiguous'/)
    assert.match(delivery, /SOFT_AI_OUTBOUND_AMBIGUOUS/)
    assert.match(delivery, /SOFT_AI_OUTBOUND_CONTENT_CONFLICT/)
    assert.match(delivery, /existing\.status === 'sent'/)
    assert.match(delivery, /P2002/)
    assert.match(delivery, /jobId_deliveryKey/)
    // Never auto-resend sent or ambiguous
    assert.match(delivery, /ready \/ sending \/ ambiguous — never auto-resend/)
    const hash = hashSoftAiDeliveryContent('hola')
    assert.equal(hash.length, 64)
    assert.equal(softAiInboundDeliveryKey('msg_1'), 'soft_ai_inbound:msg_1')
  })

  it('retry after kill mid-run: expired lease reclaim + late complete + backoff', () => {
    const queue = read('src/lib/soft-ai/automation-queue.ts')
    const processor = read('src/lib/soft-ai/automation-processor.ts')
    assert.match(queue, /leaseExpiresAt" <= CURRENT_TIMESTAMP/)
    assert.match(queue, /completeLateJob/)
    assert.match(processor, /ChatAutomationTimeoutError/)
    assert.match(processor, /completeLateJob\(row\)/)
    assert.match(processor, /void work\.then/)
    assert.equal(retryDelayMs(1), 5_000)
    assert.equal(retryDelayMs(2), 10_000)
    assert.equal(retryDelayMs(10), 15 * 60_000)
  })

  it('Soft AI queue modules never import staff bot paths', () => {
    const files = [
      'src/lib/soft-ai/automation-queue.ts',
      'src/lib/soft-ai/automation-delivery.ts',
      'src/lib/soft-ai/automation-processor.ts',
      'src/lib/soft-ai/inbound-hook.ts',
      'src/app/api/cron/chat-automation/route.ts',
      'src/app/api/chat/webhook/route.ts',
    ]
    for (const file of files) {
      const src = read(file)
      assert.doesNotMatch(src, /from ['"]@\/lib\/bot\//)
      assert.doesNotMatch(src, /from ['"]@\/app\/api\/bot\//)
      assert.doesNotMatch(src, /BotInboxMessage|BotInboxDelivery|deliverBotOutputOnce|claimBotInbox/)
    }
  })

  it('webhook persists job before 200 and voids processJobById; cron is separate safety net', () => {
    const webhook = read('src/app/api/chat/webhook/route.ts')
    const cron = read('src/app/api/cron/chat-automation/route.ts')
    const vercel = read('vercel.json')
    assert.match(webhook, /enqueueSoftAiAfterInbound/)
    assert.match(webhook, /processJobById/)
    const enqueueAt = webhook.indexOf('enqueueSoftAiAfterInbound')
    const returnAt = webhook.lastIndexOf('return NextResponse.json')
    const voidAt = webhook.indexOf('void processJobById')
    assert.ok(enqueueAt > 0 && returnAt > enqueueAt)
    assert.ok(voidAt > enqueueAt)
    assert.match(cron, /CRON_SECRET/)
    assert.match(cron, /Bearer/)
    assert.match(cron, /claimBatch\(2\)/)
    assert.match(cron, /maxDuration = 60/)
    assert.match(vercel, /\/api\/cron\/chat-automation/)
    assert.match(vercel, /\*\/1 \* \* \* \*/)
  })

  it('prisma schema mirrors ChatAutomationJob + media columns + Tenant relation', () => {
    const schema = read('prisma/schema.prisma')
    assert.match(schema, /model ChatAutomationJob/)
    assert.match(schema, /model ChatAutomationDelivery/)
    assert.match(schema, /chatAutomationJobs ChatAutomationJob\[\]/)
    assert.match(schema, /mediaBlobPath\s+String\?/)
    assert.match(schema, /mediaCacheStatus\s+String\?/)
    assert.match(schema, /deliveryKey\s+String\s+@unique/)
    assert.match(schema, /@@index\(\[conversationId, status, createdAt\]\)/)
  })
})
