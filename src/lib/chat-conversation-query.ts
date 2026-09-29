import type { Prisma } from '@prisma/client'
import { hashCursorScope } from '@/lib/cursor-pagination'

/** A chat stage key (system or custom). */
export type SoftConversationStatus = string

export interface ChatConversationListQuery {
  platform: string | null
  socialAccountId: string | null
  status: SoftConversationStatus | null
  assigned: 'me' | 'none' | string | null
  tag: string | null
  q: string | null
  /** One chat by id (bell deep link when it is not in the loaded pages). */
  id?: string | null
  /** Only chats snoozed right now (Pospuestos bucket); resolved to ids by the route. */
  snoozed?: boolean
}

export interface ChatConversationChangesQuery extends ChatConversationListQuery {
  afterRevision: bigint
}

const STATUS_KEY = /^[a-z0-9_]{1,40}$/

export function parseConversationListQuery(searchParams: URLSearchParams): ChatConversationListQuery {
  const platform = (searchParams.get('platform') || '').trim() || null
  if (platform && platform !== 'whatsapp' && platform !== 'instagram') {
    throw new Error('Invalid platform')
  }
  const statusRaw = (searchParams.get('status') || '').trim()
  const status = statusRaw
    ? STATUS_KEY.test(statusRaw)
      ? statusRaw
      : (() => {
          throw new Error('Invalid status')
        })()
    : null

  const assignedRaw = (searchParams.get('assigned') || '').trim()
  let assigned: ChatConversationListQuery['assigned'] = null
  if (assignedRaw) {
    if (assignedRaw === 'me' || assignedRaw === 'none') assigned = assignedRaw
    else assigned = assignedRaw
  }

  const tag = (searchParams.get('tag') || '').trim() || null
  const q = (searchParams.get('q') || '').trim() || null
  const socialAccountId = (searchParams.get('socialAccountId') || '').trim() || null
  const idRaw = (searchParams.get('id') || '').trim()
  if (idRaw && !/^[A-Za-z0-9_-]{8,64}$/.test(idRaw)) throw new Error('Invalid id')
  const id = idRaw || null
  const snoozed = searchParams.get('snoozed') === '1'

  return { platform, socialAccountId, status, assigned, tag, q, id, snoozed }
}

export function parseConversationChangesQuery(
  searchParams: URLSearchParams,
): ChatConversationChangesQuery {
  const base = parseConversationListQuery(searchParams)
  const afterRaw = (searchParams.get('afterRevision') || '').trim()
  if (!afterRaw || !/^\d+$/.test(afterRaw)) {
    throw new Error('Invalid afterRevision')
  }
  return { ...base, afterRevision: BigInt(afterRaw) }
}

export function conversationListCursorScope(
  tenantId: string,
  input: ChatConversationListQuery,
): string {
  return hashCursorScope({
    resource: 'chat-conversations',
    tenantId,
    platform: input.platform || '',
    socialAccountId: input.socialAccountId || '',
    status: input.status || '',
    assigned: input.assigned || '',
    tag: input.tag || '',
    q: (input.q || '').toLowerCase(),
    id: input.id || '',
    snoozed: input.snoozed ? '1' : '',
  })
}

export function buildConversationListWhere(args: {
  tenantId: string
  input: ChatConversationListQuery
  viewerUserId: string
  platformAccountIds?: string[] | null
  /** Pre-resolved id set (e.g. snoozed chats of THIS tenant). */
  restrictIds?: string[] | null
}): Prisma.ChatConversationWhereInput {
  const and: Prisma.ChatConversationWhereInput[] = [{ tenantId: args.tenantId }]
  if (args.input.id) and.push({ id: args.input.id })
  if (args.restrictIds) and.push({ id: { in: args.restrictIds } })

  if (args.input.socialAccountId) {
    and.push({ socialAccountId: args.input.socialAccountId })
  } else if (args.input.platform && args.platformAccountIds) {
    and.push({ socialAccountId: { in: args.platformAccountIds } })
  }

  if (args.input.status) and.push({ status: args.input.status })
  if (args.input.tag) and.push({ tags: { has: args.input.tag } })

  if (args.input.assigned === 'me') {
    and.push({ assignedUserId: args.viewerUserId })
  } else if (args.input.assigned === 'none') {
    and.push({ assignedUserId: null })
  } else if (args.input.assigned) {
    and.push({ assignedUserId: args.input.assigned })
  }

  if (args.input.q) {
    const q = args.input.q
    and.push({
      OR: [
        { peerName: { contains: q, mode: 'insensitive' } },
        { peerId: { contains: q, mode: 'insensitive' } },
        { lastMessagePreview: { contains: q, mode: 'insensitive' } },
      ],
    })
  }

  return and.length === 1 ? and[0]! : { AND: and }
}

export function buildConversationChangesWhere(args: {
  tenantId: string
  input: ChatConversationChangesQuery
  viewerUserId: string
  platformAccountIds?: string[] | null
}): Prisma.ChatConversationWhereInput {
  const base = buildConversationListWhere({
    tenantId: args.tenantId,
    input: args.input,
    viewerUserId: args.viewerUserId,
    platformAccountIds: args.platformAccountIds,
  })
  return {
    AND: [base, { revision: { gt: args.input.afterRevision } }],
  }
}

export interface ThreadMessageQuery {
  before: { sentAt: Date; id: string } | null
  after: { sentAt: Date; id: string } | null
  limit: number
}

export function parseThreadMessageQuery(searchParams: URLSearchParams): ThreadMessageQuery {
  const limitRaw = searchParams.get('limit')
  let limit = 50
  if (limitRaw) {
    if (!/^\d+$/.test(limitRaw)) throw new Error('Invalid limit')
    limit = Math.min(Number(limitRaw), 100)
    if (limit < 1) throw new Error('Invalid limit')
  }

  const before = parseCompositeCursor(searchParams.get('before'), 'before')
  const after = parseCompositeCursor(searchParams.get('after'), 'after')
  if (before && after) throw new Error('Use before or after, not both')

  return { before, after, limit }
}

function parseCompositeCursor(
  raw: string | null,
  field: string,
): { sentAt: Date; id: string } | null {
  if (!raw) return null
  const parts = raw.split(',')
  if (parts.length !== 2) throw new Error(`Invalid ${field}`)
  const sentAt = new Date(parts[0]!)
  if (Number.isNaN(sentAt.getTime())) throw new Error(`Invalid ${field}`)
  const id = parts[1]!.trim()
  if (!id) throw new Error(`Invalid ${field}`)
  return { sentAt, id }
}

export function threadMessageCursorScope(conversationId: string, direction: 'before' | 'after') {
  return hashCursorScope({ resource: 'chat-thread', conversationId, direction })
}
