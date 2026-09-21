import { prisma } from '@/lib/db'
import type { ConversationRow } from '@/lib/chat-conversation-api'
import { conversationSelect } from '@/lib/chat-conversation-api'
import type { ChatConversationListQuery } from '@/lib/chat-conversation-query'

const listSelect = {
  ...conversationSelect(),
  readStates: {
    select: { readInboundCount: true },
    take: 1,
  },
} as const

export async function platformAccountIdsForFilter(
  tenantId: string,
  platform: string,
): Promise<string[]> {
  const rows = await prisma.socialAccount.findMany({
    where: { tenantId, platform },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export async function isActiveTenantMember(tenantId: string, userId: string): Promise<boolean> {
  const membership = await prisma.membership.findFirst({
    where: {
      tenantId,
      userId,
      isActive: true,
      user: { active: true },
    },
    select: { id: true },
  })
  return Boolean(membership)
}

type RawConversationRow = {
  readStates: Array<{ readInboundCount: number }>
  socialAccount: ConversationRow['socialAccount']
} & Omit<ConversationRow, 'readInboundCount' | 'socialAccount'>

export function mapRawConversationRow(row: RawConversationRow): ConversationRow {
  const { readStates, socialAccount, ...rest } = row
  return {
    ...rest,
    socialAccount: socialAccount
      ? {
          ...socialAccount,
          phoneNumberId: socialAccount.platform === 'whatsapp' ? socialAccount.accountId : null,
        }
      : null,
    readInboundCount: readStates[0]?.readInboundCount ?? 0,
  }
}

export async function loadConversationForTenant(args: {
  conversationId: string
  tenantId: string
  viewerUserId: string
}): Promise<ConversationRow | null> {
  const row = await prisma.chatConversation.findFirst({
    where: { id: args.conversationId, tenantId: args.tenantId },
    select: {
      ...listSelect,
      readStates: { ...listSelect.readStates, where: { userId: args.viewerUserId } },
    },
  })
  if (!row) return null
  return mapRawConversationRow(row as RawConversationRow)
}

export async function resolveListPlatformIds(
  tenantId: string,
  input: ChatConversationListQuery,
): Promise<string[] | null> {
  if (!input.platform) return null
  return platformAccountIdsForFilter(tenantId, input.platform)
}

export { listSelect }
