/**
 * Tenant stage / tag lists from the database, defaults when the business never customized them or
 * migration 035 is not applied. Cached 60 s per process; writes clear the cache.
 */
import 'server-only'
import { prisma } from '@/lib/db'
import { isMissingRelation } from '@/lib/db-missing-relation'
import {
  DEFAULT_CHAT_TAGS,
  defaultStages,
  type StageCategory,
  type StageDef,
  type StagePipeline,
  type TagDef,
} from '@/lib/crm-stages'

const TTL_MS = 60_000
const stageCache = new Map<string, { at: number; stages: StageDef[]; customized: boolean }>()
const tagCache = new Map<string, { at: number; tags: TagDef[]; customized: boolean }>()

export function forgetTenantStages(tenantId: string) {
  for (const k of stageCache.keys()) if (k.startsWith(`${tenantId}|`)) stageCache.delete(k)
  tagCache.delete(tenantId)
}

export async function loadStages(tenantId: string, pipeline: StagePipeline): Promise<{ stages: StageDef[]; customized: boolean; available: boolean }> {
  const key = `${tenantId}|${pipeline}`
  const hit = stageCache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return { stages: hit.stages, customized: hit.customized, available: true }
  try {
    const rows = await prisma.crmStage.findMany({
      where: { tenantId, pipeline },
      orderBy: { position: 'asc' },
    })
    const stages: StageDef[] = rows.length
      ? rows.map((r) => ({
          key: r.key,
          label: r.label,
          color: r.color,
          position: r.position,
          category: (r.category as StageCategory) || 'open',
          targetMinutes: r.targetMinutes,
          isSystem: r.isSystem,
          archived: Boolean(r.archivedAt),
        }))
      : defaultStages(pipeline)
    stageCache.set(key, { at: Date.now(), stages, customized: rows.length > 0 })
    return { stages, customized: rows.length > 0, available: true }
  } catch (error) {
    if (isMissingRelation(error)) return { stages: defaultStages(pipeline), customized: false, available: false }
    throw error
  }
}

export async function saveStages(tenantId: string, pipeline: StagePipeline, stages: StageDef[], userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.crmStage.findMany({ where: { tenantId, pipeline }, select: { key: true } })
    const keep = new Set(stages.map((s) => s.key))
    // Stages removed from the list are archived, never deleted: chats / clients may still use them.
    const gone = existing.filter((e) => !keep.has(e.key)).map((e) => e.key)
    if (gone.length) {
      await tx.crmStage.updateMany({ where: { tenantId, pipeline, key: { in: gone }, archivedAt: null }, data: { archivedAt: new Date() } })
    }
    for (const s of stages) {
      await tx.crmStage.upsert({
        where: { tenantId_pipeline_key: { tenantId, pipeline, key: s.key } },
        create: {
          tenantId,
          pipeline,
          key: s.key,
          label: s.label,
          color: s.color,
          position: s.position,
          category: s.category,
          targetMinutes: s.targetMinutes,
          isSystem: s.isSystem,
          archivedAt: s.archived ? new Date() : null,
          createdByUserId: userId,
        },
        update: {
          label: s.label,
          color: s.color,
          position: s.position,
          category: s.category,
          targetMinutes: s.targetMinutes,
          archivedAt: s.archived ? new Date() : null,
        },
      })
    }
  })
  forgetTenantStages(tenantId)
}

export async function loadTags(tenantId: string): Promise<{ tags: TagDef[]; customized: boolean; available: boolean }> {
  const hit = tagCache.get(tenantId)
  if (hit && Date.now() - hit.at < TTL_MS) return { tags: hit.tags, customized: hit.customized, available: true }
  try {
    const rows = await prisma.crmTag.findMany({ where: { tenantId }, orderBy: { position: 'asc' } })
    const tags: TagDef[] = rows.length
      ? rows.map((r) => ({ key: r.key, label: r.label, color: r.color, position: r.position, isSystem: r.isSystem, archived: Boolean(r.archivedAt) }))
      : DEFAULT_CHAT_TAGS.map((t) => ({ ...t }))
    tagCache.set(tenantId, { at: Date.now(), tags, customized: rows.length > 0 })
    return { tags, customized: rows.length > 0, available: true }
  } catch (error) {
    if (isMissingRelation(error)) return { tags: DEFAULT_CHAT_TAGS.map((t) => ({ ...t })), customized: false, available: false }
    throw error
  }
}

export async function saveTags(tenantId: string, tags: TagDef[], userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.crmTag.findMany({ where: { tenantId }, select: { key: true } })
    const keep = new Set(tags.map((t) => t.key))
    const gone = existing.filter((e) => !keep.has(e.key)).map((e) => e.key)
    if (gone.length) {
      await tx.crmTag.updateMany({ where: { tenantId, key: { in: gone }, archivedAt: null }, data: { archivedAt: new Date() } })
    }
    for (const t of tags) {
      await tx.crmTag.upsert({
        where: { tenantId_key: { tenantId, key: t.key } },
        create: { tenantId, key: t.key, label: t.label, color: t.color, position: t.position, isSystem: t.isSystem, archivedAt: t.archived ? new Date() : null, createdByUserId: userId },
        update: { label: t.label, color: t.color, position: t.position, archivedAt: t.archived ? new Date() : null },
      })
    }
  })
  forgetTenantStages(tenantId)
}

/** Whether a chat stage key may be set on a conversation (exists and not archived). */
export async function isAllowedChatStage(tenantId: string, key: string): Promise<boolean> {
  const { stages } = await loadStages(tenantId, 'chat')
  return stages.some((s) => s.key === key && !s.archived)
}
