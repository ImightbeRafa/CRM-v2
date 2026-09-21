/**
 * Chat inbox conversation backfill (PR-1).
 *
 * Dry-run (default — read-only when DB is reachable; planner always safe):
 *   npx tsx scripts/chat-inbox-backfill.ts
 *   npx tsx scripts/chat-inbox-backfill.ts --tenant=<id> --batch-size=1000
 *
 * Apply (requires human gates after 024 is applied):
 *   CHAT_INBOX_BACKFILL_APPLY=1 \
 *   CHAT_INBOX_BACKFILL_CONFIRM_HOST=<exact DIRECT_URL hostname> \
 *   npx tsx scripts/chat-inbox-backfill.ts --apply [--tenant=<id>]
 *
 * Idempotent + resumable via keyset cursor on (sentAt, id). Quarantines
 * peer-less / literal-"unknown" rows (conversationId stays NULL). Marks
 * duplicate providerMessageId rows (earliest wins); never deletes.
 */
import { createHash, randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/db'
import {
  compareMessageOrder,
  computeConversationAggregate,
  deriveConversationPeer,
  extractMessageType,
  extractProviderMessageId,
  mergeBackfillAuditMetadata,
  naturalKeyString,
  parseChatBackfillOptions,
  planDuplicatePatches,
  toMessageDate,
  type ChatInboxBackfillMessage,
  type ConversationNaturalKey,
} from '../src/lib/chat-conversation-foundation'

function asInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue
}

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function newCuidLike(): string {
  const time = Date.now().toString(36)
  const rand = randomBytes(8).toString('hex')
  return `c${time}${rand}`
}

function hostFromDatabaseUrl(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    fail('DATABASE URL is not a valid URL.')
  }
}

const options = parseChatBackfillOptions(process.argv.slice(2), process.env)
const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
if (!dbUrl) fail('DIRECT_URL / DATABASE_URL is missing.')

if (options.apply) {
  if (process.env.CHAT_INBOX_BACKFILL_APPLY !== '1') {
    fail('Apply blocked: set CHAT_INBOX_BACKFILL_APPLY=1 after human approval.')
  }
  if (!options.confirmHost) {
    fail('Apply blocked: set CHAT_INBOX_BACKFILL_CONFIRM_HOST to the exact DB hostname.')
  }
  const host = hostFromDatabaseUrl(dbUrl)
  if (host !== options.confirmHost) {
    fail(`Host mismatch: url has ${host}, confirm host is ${options.confirmHost}.`)
  }
}

type Cursor = { sentAt: Date; id: string }

function parseCursor(): Cursor | null {
  if (!options.afterSentAt || !options.afterId) return null
  return { sentAt: toMessageDate(options.afterSentAt), id: options.afterId }
}

async function fetchBatch(cursor: Cursor | null, batchSize: number) {
  const rows = await prisma.chatMessage.findMany({
    where: {
      conversationId: null,
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      ...(cursor
        ? {
            OR: [
              { sentAt: { gt: cursor.sentAt } },
              { sentAt: cursor.sentAt, id: { gt: cursor.id } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      tenantId: true,
      socialAccountId: true,
      direction: true,
      content: true,
      sentAt: true,
      metadata: true,
      providerMessageId: true,
      peerId: true,
      conversationId: true,
      duplicateOfMessageId: true,
      messageType: true,
    },
    orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    take: batchSize,
  })
  return rows as ChatInboxBackfillMessage[]
}

async function ensureConversation(
  key: ConversationNaturalKey,
  seed: {
    peerName: string | null
    lastMessageId: string
    lastMessageAt: Date
    lastMessagePreview: string
    lastMessageDirection: string
    lastInboundAt: Date | null
    lastOutboundAt: Date | null
  },
  cache: Map<string, string>,
): Promise<{ id: string; created: boolean }> {
  const cacheKey = naturalKeyString(key)
  const cached = cache.get(cacheKey)
  if (cached) return { id: cached, created: false }

  const existing = await prisma.chatConversation.findUnique({
    where: {
      tenantId_socialAccountId_peerId: {
        tenantId: key.tenantId,
        socialAccountId: key.socialAccountId,
        peerId: key.peerId,
      },
    },
    select: { id: true },
  })
  if (existing) {
    cache.set(cacheKey, existing.id)
    return { id: existing.id, created: false }
  }

  if (!options.apply) {
    const dryId = `dry_${createHash('sha1').update(cacheKey).digest('hex').slice(0, 24)}`
    cache.set(cacheKey, dryId)
    return { id: dryId, created: true }
  }

  try {
    const created = await prisma.chatConversation.create({
      data: {
        id: newCuidLike(),
        tenantId: key.tenantId,
        socialAccountId: key.socialAccountId,
        peerId: key.peerId,
        peerName: seed.peerName,
        status: 'nuevo',
        tags: [],
        lastMessageId: seed.lastMessageId,
        lastMessageAt: seed.lastMessageAt,
        lastMessagePreview: seed.lastMessagePreview,
        lastMessageDirection: seed.lastMessageDirection,
        lastInboundAt: seed.lastInboundAt,
        lastOutboundAt: seed.lastOutboundAt,
        inboundCount: 0,
        messageCount: 0,
      },
      select: { id: true },
    })
    cache.set(cacheKey, created.id)
    return { id: created.id, created: true }
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: string }).code) : ''
    if (code !== 'P2002') throw error
    const again = await prisma.chatConversation.findUnique({
      where: {
        tenantId_socialAccountId_peerId: {
          tenantId: key.tenantId,
          socialAccountId: key.socialAccountId,
          peerId: key.peerId,
        },
      },
      select: { id: true },
    })
    if (!again) throw error
    cache.set(cacheKey, again.id)
    return { id: again.id, created: false }
  }
}

async function recomputeAggregates(conversationIds: string[]) {
  const unique = [...new Set(conversationIds)].filter((id) => !id.startsWith('dry_'))
  for (const conversationId of unique) {
    const messages = await prisma.chatMessage.findMany({
      where: { conversationId },
      select: {
        id: true,
        tenantId: true,
        socialAccountId: true,
        direction: true,
        content: true,
        sentAt: true,
        duplicateOfMessageId: true,
      },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    })
    const aggregate = computeConversationAggregate(messages)
    if (!options.apply) continue
    if (!aggregate.lastMessageAt) continue
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: {
        lastMessageId: aggregate.lastMessageId,
        lastMessageAt: aggregate.lastMessageAt,
        lastMessagePreview: aggregate.lastMessagePreview,
        lastMessageDirection: aggregate.lastMessageDirection,
        lastInboundAt: aggregate.lastInboundAt,
        lastOutboundAt: aggregate.lastOutboundAt,
        inboundCount: aggregate.inboundCount,
        messageCount: aggregate.messageCount,
      },
    })
  }
}

async function markDuplicates(tenantId: string | null) {
  const grouped = await prisma.$queryRaw<
    Array<{ socialAccountId: string; providerMessageId: string; cnt: bigint }>
  >`
    SELECT "socialAccountId", "providerMessageId", COUNT(*)::bigint AS cnt
    FROM public."ChatMessage"
    WHERE "providerMessageId" IS NOT NULL
      AND (${tenantId}::text IS NULL OR "tenantId" = ${tenantId})
    GROUP BY "socialAccountId", "providerMessageId"
    HAVING COUNT(*) > 1
  `

  let marked = 0
  const sample: Array<{ providerMessageId: string; duplicates: number }> = []

  for (const group of grouped) {
    const rows = await prisma.chatMessage.findMany({
      where: {
        socialAccountId: group.socialAccountId,
        providerMessageId: group.providerMessageId,
      },
      select: {
        id: true,
        tenantId: true,
        socialAccountId: true,
        direction: true,
        content: true,
        sentAt: true,
        metadata: true,
        providerMessageId: true,
      },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    })
    const withProvider = rows
      .map((row) => ({
        ...row,
        providerMessageId: row.providerMessageId || group.providerMessageId,
      }))
      .filter((row) => row.providerMessageId)
    const patches = planDuplicatePatches(withProvider)
    if (sample.length < 20) {
      sample.push({ providerMessageId: group.providerMessageId, duplicates: patches.length })
    }
    if (!options.apply) {
      marked += patches.length
      continue
    }
    for (const patch of patches) {
      await prisma.chatMessage.update({
        where: { id: patch.id },
        data: {
          duplicateOfMessageId: patch.duplicateOfMessageId,
          providerMessageId: null,
          metadata: asInputJson(patch.metadata),
        },
      })
      marked += 1
    }
  }

  return { duplicateGroups: grouped.length, markedDuplicates: marked, sample }
}

async function main() {
  const conversationCache = new Map<string, string>()
  let cursor = parseCursor()
  let batches = 0
  let scanned = 0
  let linked = 0
  let conversationsCreated = 0
  let quarantined = 0
  const quarantineSample: Array<{ messageId: string; reason: string }> = []
  const touched = new Set<string>()

  for (;;) {
    const batch = await fetchBatch(cursor, options.batchSize)
    if (batch.length === 0) break
    batches += 1
    scanned += batch.length

    const ordered = [...batch].sort(compareMessageOrder)
    for (const message of ordered) {
      const peer = deriveConversationPeer(message)
      if (!peer.ok) {
        quarantined += 1
        if (quarantineSample.length < 50) {
          quarantineSample.push({ messageId: message.id, reason: peer.reason })
        }
        if (options.apply) {
          await prisma.chatMessage.update({
            where: { id: message.id },
            data: {
              metadata: asInputJson(
                mergeBackfillAuditMetadata(message.metadata, {
                  quarantineReason: peer.reason,
                  quarantinedAt: new Date().toISOString(),
                }),
              ),
              providerMessageId: extractProviderMessageId(message),
              messageType: extractMessageType(message),
            },
          })
        }
        continue
      }

      const sentAt = toMessageDate(message.sentAt)
      const inbound = message.direction === 'inbound'
      const seed = {
        peerName: peer.peerName,
        lastMessageId: message.id,
        lastMessageAt: sentAt,
        lastMessagePreview: message.content.replace(/\s+/g, ' ').trim().slice(0, 120),
        lastMessageDirection: String(message.direction),
        lastInboundAt: inbound ? sentAt : null,
        lastOutboundAt: inbound ? null : sentAt,
      }
      const key = {
        tenantId: message.tenantId,
        socialAccountId: message.socialAccountId,
        peerId: peer.peerId,
      }
      const conversation = await ensureConversation(key, seed, conversationCache)
      if (conversation.created) conversationsCreated += 1
      touched.add(conversation.id)

      if (options.apply) {
        await prisma.chatMessage.update({
          where: { id: message.id },
          data: {
            conversationId: conversation.id,
            peerId: peer.peerId,
            providerMessageId: extractProviderMessageId(message),
            messageType: extractMessageType(message),
          },
        })
      }
      linked += 1
    }

    const last = ordered[ordered.length - 1]
    cursor = { sentAt: toMessageDate(last.sentAt), id: last.id }
    if (batch.length < options.batchSize) break
  }

  if (options.apply && touched.size > 0) {
    await recomputeAggregates([...touched])
  }

  const duplicateReport = await markDuplicates(options.tenantId)
  if (options.apply && touched.size > 0) {
    // Recompute again after duplicate marking so aggregates exclude dups.
    const convIds = await prisma.chatMessage.findMany({
      where: {
        duplicateOfMessageId: { not: null },
        conversationId: { not: null },
        ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      },
      select: { conversationId: true },
      distinct: ['conversationId'],
    })
    await recomputeAggregates(
      convIds.map((row) => row.conversationId!).filter(Boolean),
    )
  }

  const report = {
    mode: options.apply ? 'APPLY' : 'DRY_RUN',
    tenantId: options.tenantId,
    batchSize: options.batchSize,
    batches,
    scanned,
    linked,
    conversationsCreated,
    quarantined,
    quarantineSample,
    nextCursor: cursor
      ? { sentAt: cursor.sentAt.toISOString(), id: cursor.id }
      : null,
    duplicates: duplicateReport,
    note: options.apply
      ? 'Writes applied. Re-run is safe (idempotent).'
      : 'No writes. Pass --apply with CHAT_INBOX_BACKFILL_APPLY=1 and CONFIRM_HOST to write.',
  }
  console.log(JSON.stringify(report, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await prisma.$disconnect()
    } catch {
      /* ignore */
    }
  })
