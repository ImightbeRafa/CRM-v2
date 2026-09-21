/**
 * Seed ChatConversationReadState for active tenant members (unread baseline at cutover).
 *
 * Dry-run (default):
 *   npx tsx scripts/chat-inbox-v2-cutover.ts --tenant=cmhsibjue0004js04gie724nx
 *
 * Apply:
 *   npx tsx scripts/chat-inbox-v2-cutover.ts --tenant=<id> --apply
 */
import { prisma } from '../src/lib/db'

function fail(message: string): never {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

async function main() {
  const argv = process.argv.slice(2)
  const apply = argv.includes('--apply')
  const tenantArg = argv.find((a) => a.startsWith('--tenant='))
  const tenantId = tenantArg?.slice('--tenant='.length).trim()
  if (!tenantId) fail('--tenant=<tenantId> is required')

  const members = await prisma.membership.findMany({
    where: { tenantId, isActive: true, user: { active: true } },
    select: { userId: true },
  })
  const conversations = await prisma.chatConversation.findMany({
    where: { tenantId },
    select: { id: true, inboundCount: true, lastMessageId: true },
  })

  let upserts = 0
  for (const conversation of conversations) {
    for (const member of members) {
      upserts += 1
      if (!apply) continue
      await prisma.chatConversationReadState.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: member.userId,
          },
        },
        create: {
          tenantId,
          conversationId: conversation.id,
          userId: member.userId,
          readInboundCount: conversation.inboundCount,
          lastReadAt: new Date(),
          lastReadMessageId: conversation.lastMessageId,
        },
        update: {
          readInboundCount: conversation.inboundCount,
          lastReadAt: new Date(),
          lastReadMessageId: conversation.lastMessageId,
        },
      })
    }
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        dryRun: !apply,
        members: members.length,
        conversations: conversations.length,
        readStateUpserts: upserts,
      },
      null,
      2,
    ),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
