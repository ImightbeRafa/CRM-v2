/**
 * Soft Agent Layer 90-day retention purge.
 * Turns (027) + suggestions/pending-action args (028) when schema present.
 */

import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { OUTPUT_RETENTION_DAYS } from '@/lib/soft-ai/agent-types'
import { isChatAgentSchemaReady, isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import { isChatSuggestionSchemaReady } from '@/lib/soft-ai/knowledge-schema'

export async function purgeChatAgentOutputs(input?: {
  olderThanDays?: number
  batchSize?: number
  now?: Date
}): Promise<{
  purged: number
  skipped: boolean
  suggestionsPurged?: number
  actionsPurged?: number
}> {
  const ready = await isChatAgentSchemaReady()
  if (!ready) return { purged: 0, skipped: true }

  const days = input?.olderThanDays ?? OUTPUT_RETENTION_DAYS
  const batchSize = input?.batchSize ?? 1_000
  const now = input?.now ?? new Date()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60_000)

  try {
    const ids = await prisma.chatAgentTurn.findMany({
      where: {
        createdAt: { lt: cutoff },
        outputText: { not: null },
      },
      select: { id: true },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    })
    let purged = 0
    if (ids.length > 0) {
      const result = await prisma.chatAgentTurn.updateMany({
        where: { id: { in: ids.map((r) => r.id) }, outputText: { not: null } },
        data: {
          outputText: null,
          decisionTrace: Prisma.DbNull,
          outputPurgedAt: now,
        },
      })
      purged = result.count
    }

    let suggestionsPurged = 0
    let actionsPurged = 0
    if (await isChatSuggestionSchemaReady()) {
      try {
        const sugIds = await prisma.chatAgentSuggestion.findMany({
          where: {
            createdAt: { lt: cutoff },
            contentPurgedAt: null,
            status: { in: ['accepted', 'edited', 'dismissed', 'expired'] },
          },
          select: { id: true },
          take: batchSize,
        })
        if (sugIds.length > 0) {
          const r = await prisma.chatAgentSuggestion.updateMany({
            where: { id: { in: sugIds.map((s) => s.id) } },
            data: { content: '[purged]', contentPurgedAt: now },
          })
          suggestionsPurged = r.count
        }
        const actIds = await prisma.chatAgentPendingAction.findMany({
          where: {
            createdAt: { lt: cutoff },
            argumentsPurgedAt: null,
            status: { in: ['executed', 'rejected', 'expired', 'failed'] },
          },
          select: { id: true },
          take: batchSize,
        })
        if (actIds.length > 0) {
          const r = await prisma.chatAgentPendingAction.updateMany({
            where: { id: { in: actIds.map((a) => a.id) } },
            data: {
              arguments: {},
              argumentsPurgedAt: now,
            },
          })
          actionsPurged = r.count
        }
      } catch (error) {
        if (!isMissingRelationError(error)) throw error
      }
    }

    return { purged, skipped: false, suggestionsPurged, actionsPurged }
  } catch (error) {
    if (isMissingRelationError(error)) return { purged: 0, skipped: true }
    throw error
  }
}
