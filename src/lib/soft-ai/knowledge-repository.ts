/**
 * Soft Agent Layer A2 — load approved knowledge for prompt assembly / tool search.
 * Only approved, tenant-scoped, agent-bound sources. Overlay filtered by socialAccountId.
 */

import 'server-only'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db'
import { isChatKnowledgeSchemaReady } from '@/lib/soft-ai/knowledge-schema'
import { isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import {
  budgetKnowledgeSlice,
  type ApprovedKnowledgeSlice,
  type KnowledgeKind,
  type KnowledgeSourceDto,
  type KnowledgeVersionRef,
} from '@/lib/soft-ai/knowledge-types'

export function hashKnowledgeBody(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex')
}

function toDto(row: {
  id: string
  tenantId: string
  socialAccountId: string | null
  kind: string
  name: string
  body: string
  status: string
  version: number
  contentHash: string
  metadata: unknown
  approvedBy: string | null
  approvedAt: Date | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}): KnowledgeSourceDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    socialAccountId: row.socialAccountId,
    kind: row.kind as KnowledgeKind,
    name: row.name,
    body: row.body,
    status: row.status as KnowledgeSourceDto['status'],
    version: row.version,
    contentHash: row.contentHash,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function versionRef(dto: KnowledgeSourceDto): KnowledgeVersionRef {
  return {
    sourceId: dto.id,
    kind: dto.kind,
    name: dto.name,
    version: dto.version,
    contentHash: dto.contentHash,
  }
}

/**
 * Latest approved version per (kind, name) among agent-bound sources.
 * Channel overlays require exact socialAccountId match.
 */
export async function loadApprovedKnowledgeForAgent(input: {
  tenantId: string
  agentId: string
  socialAccountId: string
}): Promise<ApprovedKnowledgeSlice> {
  const empty: ApprovedKnowledgeSlice = {
    brandBook: [],
    policies: [],
    faqs: [],
    channelOverlay: [],
    versions: [],
  }
  if (!(await isChatKnowledgeSchemaReady())) return empty

  try {
    const links = await prisma.chatAgentKnowledgeSource.findMany({
      where: { tenantId: input.tenantId, agentId: input.agentId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      select: { sourceId: true, priority: true },
    })
    if (links.length === 0) return empty

    const sources = await prisma.chatKnowledgeSource.findMany({
      where: {
        tenantId: input.tenantId,
        id: { in: links.map((l) => l.sourceId) },
        status: 'approved',
        contentPurgedAt: null,
      },
    })

    // Keep latest version per (kind, name); prefer higher version.
    const latest = new Map<string, (typeof sources)[number]>()
    for (const s of sources) {
      if (s.kind === 'channel_overlay' && s.socialAccountId !== input.socialAccountId) {
        continue
      }
      if (s.kind !== 'channel_overlay' && s.socialAccountId) {
        continue
      }
      const key = `${s.kind}::${s.name}`
      const prev = latest.get(key)
      if (!prev || s.version > prev.version) latest.set(key, s)
    }

    const priority = new Map(links.map((l) => [l.sourceId, l.priority]))
    const ordered = [...latest.values()].sort((a, b) => {
      const pa = priority.get(a.id) ?? 100
      const pb = priority.get(b.id) ?? 100
      if (pa !== pb) return pa - pb
      return a.name.localeCompare(b.name, 'es')
    })

    const brandBook: KnowledgeSourceDto[] = []
    const policies: KnowledgeSourceDto[] = []
    const faqs: KnowledgeSourceDto[] = []
    const channelOverlay: KnowledgeSourceDto[] = []
    const versions: KnowledgeVersionRef[] = []

    for (const row of ordered) {
      const dto = toDto(row)
      versions.push(versionRef(dto))
      switch (dto.kind) {
        case 'brand_book':
          brandBook.push(dto)
          break
        case 'policy':
          policies.push(dto)
          break
        case 'faq':
          faqs.push(dto)
          break
        case 'channel_overlay':
          channelOverlay.push(dto)
          break
        default: {
          const _exhaustive: never = dto.kind
          void _exhaustive
          break
        }
      }
    }

    return { brandBook, policies, faqs, channelOverlay, versions }
  } catch (error) {
    if (isMissingRelationError(error)) return empty
    throw error
  }
}

export async function searchApprovedKnowledge(input: {
  tenantId: string
  agentId: string
  socialAccountId: string
  query: string
  limit?: number
}): Promise<{
  hits: Array<{
    sourceId: string
    kind: KnowledgeKind
    name: string
    version: number
    contentHash: string
    excerpt: string
  }>
}> {
  const q = input.query.trim().toLocaleLowerCase('es').slice(0, 120)
  if (!q) return { hits: [] }
  const slice = budgetKnowledgeSlice(
    await loadApprovedKnowledgeForAgent({
      tenantId: input.tenantId,
      agentId: input.agentId,
      socialAccountId: input.socialAccountId,
    }),
  )
  const all = [
    ...slice.brandBook,
    ...slice.policies,
    ...slice.faqs,
    ...slice.channelOverlay,
  ]
  const hits = []
  for (const s of all) {
    const hay = `${s.name}\n${s.body}`.toLocaleLowerCase('es')
    const idx = hay.indexOf(q)
    if (idx < 0) continue
    const start = Math.max(0, idx - 80)
    const excerpt = s.body.slice(start, start + 400)
    hits.push({
      sourceId: s.id,
      kind: s.kind,
      name: s.name,
      version: s.version,
      contentHash: s.contentHash,
      excerpt,
    })
    if (hits.length >= (input.limit ?? 6)) break
  }
  return { hits }
}
