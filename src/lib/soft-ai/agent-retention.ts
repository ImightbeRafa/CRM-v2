/**
 * Soft Agent Layer 90-day outputText retention purge.
 * Cron can call purgeChatAgentOutputs; schema ships outputPurgedAt in 027.
 */

import { prisma } from '@/lib/db'
import { OUTPUT_RETENTION_DAYS } from '@/lib/soft-ai/agent-types'
import { isChatAgentSchemaReady, isMissingRelationError } from '@/lib/soft-ai/agent-schema'

export async function purgeChatAgentOutputs(input?: {
  olderThanDays?: number
  batchSize?: number
  now?: Date
}): Promise<{ purged: number; skipped: boolean }> {
  const ready = await isChatAgentSchemaReady()
  if (!ready) return { purged: 0, skipped: true }

  const days = input?.olderThanDays ?? OUTPUT_RETENTION_DAYS
  const batchSize = input?.batchSize ?? 1_000
  const now = input?.now ?? new Date()
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60_000)

  try {
    // Batch via findMany + updateMany to keep lock footprint small.
    const ids = await prisma.chatAgentTurn.findMany({
      where: {
        createdAt: { lt: cutoff },
        outputText: { not: null },
      },
      select: { id: true },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    })
    if (ids.length === 0) return { purged: 0, skipped: false }

    const result = await prisma.chatAgentTurn.updateMany({
      where: { id: { in: ids.map((r) => r.id) }, outputText: { not: null } },
      data: {
        outputText: null,
        outputPurgedAt: now,
      },
    })
    return { purged: result.count, skipped: false }
  } catch (error) {
    if (isMissingRelationError(error)) return { purged: 0, skipped: true }
    throw error
  }
}
