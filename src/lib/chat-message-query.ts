/**
 * Pure helpers for Soft Copilot message pagination / peer filtering.
 */

/** Prisma-compatible where clause for messages belonging to one peer thread. */
export function chatMessagesWhereForPeer(params: {
  socialAccountId: string
  recipientId?: string | null
}): Record<string, unknown> {
  const { socialAccountId, recipientId } = params
  const peer = (recipientId || '').trim()
  if (!peer) {
    return { socialAccountId }
  }

  return {
    socialAccountId,
    OR: [
      {
        AND: [
          { direction: 'inbound' },
          { metadata: { path: ['from'], equals: peer } },
        ],
      },
      {
        AND: [
          { direction: 'outbound' },
          { metadata: { path: ['to'], equals: peer } },
        ],
      },
      {
        AND: [
          { direction: 'inbound' },
          { metadata: { path: ['waId'], equals: peer } },
        ],
      },
    ],
  }
}

export function mergeChatMessagesById<T extends { id: string; sentAt?: string | null }>(
  existing: T[],
  incoming: T[],
): T[] {
  const byId = new Map<string, T>()
  for (const msg of existing) byId.set(msg.id, msg)
  for (const msg of incoming) byId.set(msg.id, msg)
  return Array.from(byId.values()).sort((a, b) => {
    const aAt = a.sentAt || ''
    const bAt = b.sentAt || ''
    return aAt.localeCompare(bAt)
  })
}

export type ThreadPagerState = {
  nextCursor?: string
  hasMore: boolean
}

/** After a paginated fetch, compute next pager state from API fields. */
export function nextThreadPager(params: {
  nextCursor?: string | null
  hasMore?: boolean
}): ThreadPagerState {
  const hasMore = Boolean(params.hasMore)
  const nextCursor = params.nextCursor ? String(params.nextCursor) : undefined
  return {
    hasMore,
    nextCursor: hasMore ? nextCursor : undefined,
  }
}
