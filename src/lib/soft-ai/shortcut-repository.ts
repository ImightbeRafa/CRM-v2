/**
 * Runtime shortcut reads. Missing table fails closed to reserved seeds.
 */

import { prisma } from '@/lib/db'
import { isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import type { AgentIntent } from '@/lib/soft-ai/agent-intents'
import {
  RESERVED_SHORTCUT_SEEDS,
  type RuntimeShortcut,
  type ShortcutKind,
} from '@/lib/soft-ai/shortcuts'

function seedRuntime(): RuntimeShortcut[] {
  return RESERVED_SHORTCUT_SEEDS.map((seed, index) => ({
    ...seed,
    isActive: true,
    sortOrder: index,
  }))
}

export async function listRuntimeShortcuts(
  tenantId: string,
  agentId: string,
): Promise<RuntimeShortcut[]> {
  try {
    const rows = await prisma.chatAgentShortcut.findMany({
      where: { tenantId, agentId },
      orderBy: { sortOrder: 'asc' },
    })
    const fromDb: RuntimeShortcut[] = rows.map((row) => ({
      id: row.id,
      key: row.key,
      title: row.title,
      kind: row.kind as ShortcutKind,
      intents: row.intents as AgentIntent[],
      keywords: row.keywords,
      body: row.body,
      deliveryMode: row.deliveryMode === 'guide' ? 'guide' : 'verbatim',
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    }))
    const keys = new Set(fromDb.map((row) => row.key))
    const missing = seedRuntime().filter((seed) => !keys.has(seed.key))
    return [...fromDb, ...missing]
  } catch (error) {
    if (isMissingRelationError(error)) return seedRuntime()
    throw error
  }
}
