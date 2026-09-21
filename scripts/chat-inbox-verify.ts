/**
 * Read-only chat inbox parity checks (Phase 1 acceptance).
 *
 *   npx tsx scripts/chat-inbox-verify.ts
 *   npx tsx scripts/chat-inbox-verify.ts --tenant=<id>
 *
 * Does not write. Safe against shared Supabase.
 * Exit 1 when any hard parity check fails.
 *
 * Also reports 025 readiness (duplicate provider pairs / active assets)
 * without applying 025.
 */
import { prisma } from '../src/lib/db'
import {
  compareConversationAggregate,
  computeConversationAggregate,
  deriveConversationPeer,
} from '../src/lib/chat-conversation-foundation'

const tenantArg = process.argv.find((arg) => arg.startsWith('--tenant='))
const tenantId = tenantArg?.slice('--tenant='.length).trim() || null
const sampleLimit = 25

const tenantFilter = tenantId ? { tenantId } : {}

const errors: string[] = []
const warnings: string[] = []

const messages = await prisma.chatMessage.findMany({
  where: tenantFilter,
  select: {
    id: true,
    tenantId: true,
    socialAccountId: true,
    direction: true,
    content: true,
    sentAt: true,
    metadata: true,
    conversationId: true,
    peerId: true,
    providerMessageId: true,
    duplicateOfMessageId: true,
  },
})

let peerless = 0
let linkedOk = 0
let missingConversation = 0
const peerlessSample: string[] = []
const missingSample: string[] = []

const conversationIds = new Set(
  messages.map((row) => row.conversationId).filter((id): id is string => Boolean(id)),
)
const conversations = conversationIds.size
  ? await prisma.chatConversation.findMany({
      where: { id: { in: [...conversationIds] } },
      select: {
        id: true,
        tenantId: true,
        socialAccountId: true,
        peerId: true,
        lastMessageId: true,
        lastMessageAt: true,
        lastMessagePreview: true,
        lastMessageDirection: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        inboundCount: true,
        messageCount: true,
      },
    })
  : []
const conversationById = new Map(conversations.map((row) => [row.id, row]))

for (const message of messages) {
  const peer = deriveConversationPeer(message)
  if (!peer.ok) {
    peerless += 1
    if (peerlessSample.length < sampleLimit) peerlessSample.push(message.id)
    continue
  }
  if (!message.conversationId) {
    missingConversation += 1
    if (missingSample.length < sampleLimit) missingSample.push(message.id)
    continue
  }
  const conversation = conversationById.get(message.conversationId)
  if (!conversation) {
    errors.push(`message ${message.id} points at missing conversation ${message.conversationId}`)
    continue
  }
  if (conversation.tenantId !== message.tenantId) {
    errors.push(`message ${message.id} tenant mismatch vs conversation`)
  }
  if (conversation.socialAccountId !== message.socialAccountId) {
    errors.push(`message ${message.id} socialAccount mismatch vs conversation`)
  }
  if (conversation.peerId !== peer.peerId && conversation.peerId !== message.peerId) {
    errors.push(`message ${message.id} peer mismatch vs conversation`)
  }
  linkedOk += 1
}

const aggregateMismatches: string[] = []
for (const conversation of conversations) {
  const rows = messages.filter((row) => row.conversationId === conversation.id)
  const expected = computeConversationAggregate(rows)
  const actual = {
    lastMessageId: conversation.lastMessageId,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageDirection: conversation.lastMessageDirection,
    lastInboundAt: conversation.lastInboundAt,
    lastOutboundAt: conversation.lastOutboundAt,
    inboundCount: conversation.inboundCount,
    messageCount: conversation.messageCount,
  }
  const diff = compareConversationAggregate(actual, expected)
  if (diff.length > 0 && aggregateMismatches.length < sampleLimit) {
    aggregateMismatches.push(`${conversation.id}: ${diff.join('; ')}`)
  }
}
if (aggregateMismatches.length > 0) {
  errors.push(`aggregate mismatches: ${aggregateMismatches.length} (see sample)`)
}

const duplicateProviderGroups = await prisma.$queryRaw<
  Array<{ socialAccountId: string; providerMessageId: string; cnt: bigint }>
>`
  SELECT "socialAccountId", "providerMessageId", COUNT(*)::bigint AS cnt
  FROM public."ChatMessage"
  WHERE "providerMessageId" IS NOT NULL
    AND (${tenantId}::text IS NULL OR "tenantId" = ${tenantId})
  GROUP BY "socialAccountId", "providerMessageId"
  HAVING COUNT(*) > 1
`

const duplicateActiveAssets = await prisma.$queryRaw<
  Array<{ platform: string; accountId: string; cnt: bigint }>
>`
  SELECT platform, "accountId", COUNT(*)::bigint AS cnt
  FROM public."SocialAccount"
  WHERE "isActive" = true
  GROUP BY platform, "accountId"
  HAVING COUNT(*) > 1
`

const nullProviderCount = await prisma.chatMessage.count({
  where: {
    ...tenantFilter,
    providerMessageId: null,
  },
})

const brokenDuplicateRefs = messages.filter((row) => {
  if (!row.duplicateOfMessageId) return false
  return !messages.some((other) => other.id === row.duplicateOfMessageId)
})

if (missingConversation > 0) {
  errors.push(`${missingConversation} messages with derivable peer lack conversationId`)
}
if (duplicateProviderGroups.length > 0) {
  errors.push(
    `${duplicateProviderGroups.length} duplicate (socialAccountId, providerMessageId) groups (025 not ready)`,
  )
}
if (duplicateActiveAssets.length > 0) {
  warnings.push(
    `${duplicateActiveAssets.length} duplicate active (platform, accountId) assets (025 not ready)`,
  )
}
if (brokenDuplicateRefs.length > 0) {
  errors.push(`${brokenDuplicateRefs.length} duplicateOfMessageId refs point at missing rows`)
}

const report = {
  ok: errors.length === 0,
  tenantId,
  counts: {
    messages: messages.length,
    linkedOk,
    peerless,
    missingConversation,
    conversations: conversations.length,
    nullProviderMessageId: nullProviderCount,
    duplicateProviderGroups: duplicateProviderGroups.length,
    duplicateActiveAssets: duplicateActiveAssets.length,
  },
  errors,
  warnings,
  samples: {
    peerless: peerlessSample,
    missingConversation: missingSample,
    aggregateMismatches,
    duplicateProviderGroups: duplicateProviderGroups.slice(0, sampleLimit).map((row) => ({
      socialAccountId: row.socialAccountId,
      providerMessageId: row.providerMessageId,
      count: Number(row.cnt),
    })),
    duplicateActiveAssets: duplicateActiveAssets.slice(0, sampleLimit).map((row) => ({
      platform: row.platform,
      accountId: row.accountId,
      count: Number(row.cnt),
    })),
  },
  gate025: {
    readyForProviderUnique: duplicateProviderGroups.length === 0,
    readyForActiveAssetUnique: duplicateActiveAssets.length === 0,
  },
}

console.log(JSON.stringify(report, null, 2))
await prisma.$disconnect()
if (errors.length > 0) process.exit(1)
