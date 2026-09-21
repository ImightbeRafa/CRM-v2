/**
 * Soft Agent Layer A2 — knowledge admin (CRUD, approve/reject, bind).
 * Audit AFTER commit — never nest logAuditEvent inside interactive $transaction.
 */

import 'server-only'
import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { requireTenantSocialAccount } from '@/lib/soft-ai/agent-admin'
import { isChatKnowledgeSchemaReady } from '@/lib/soft-ai/knowledge-schema'
import { hashKnowledgeBody } from '@/lib/soft-ai/knowledge-repository'
import {
  KNOWLEDGE_BODY_MAX,
  KNOWLEDGE_NAME_MAX,
  isKnowledgeKind,
  type KnowledgeKind,
  type KnowledgeSourceDto,
} from '@/lib/soft-ai/knowledge-types'
import { Prisma } from '@prisma/client'

export type KnowledgeAdminHttpError = {
  status: number
  body: {
    success: false
    error: string
    code?: string
    schemaReady?: boolean
  }
}

export function mapKnowledgeAdminError(error: unknown): KnowledgeAdminHttpError | null {
  if (!(error instanceof Error)) return null
  if (error.message === 'KNOWLEDGE_SCHEMA_NOT_READY') {
    return {
      status: 503,
      body: {
        success: false,
        error: 'SQL 028 aún no aplicado — conocimiento no disponible',
        code: 'KNOWLEDGE_SCHEMA_NOT_READY',
        schemaReady: false,
      },
    }
  }
  if (error.message === 'SOURCE_NOT_FOUND') {
    return { status: 404, body: { success: false, error: 'No encontrado', code: 'SOURCE_NOT_FOUND' } }
  }
  if (error.message === 'SOCIAL_ACCOUNT_NOT_FOUND') {
    return {
      status: 404,
      body: {
        success: false,
        error: 'Cuenta social no encontrada',
        code: 'SOCIAL_ACCOUNT_NOT_FOUND',
      },
    }
  }
  if (error.message === 'SOURCE_NOT_APPROVED') {
    return {
      status: 409,
      body: {
        success: false,
        error: 'Solo se pueden vincular fuentes aprobadas',
        code: 'SOURCE_NOT_APPROVED',
      },
    }
  }
  if (error.message === 'AGENT_NOT_FOUND') {
    return { status: 404, body: { success: false, error: 'Agente no encontrado', code: 'AGENT_NOT_FOUND' } }
  }
  if (error.message === 'BODY_TOO_LONG') {
    return {
      status: 400,
      body: {
        success: false,
        error: `El texto supera ${KNOWLEDGE_BODY_MAX} caracteres`,
        code: 'BODY_TOO_LONG',
      },
    }
  }
  if (error.message === 'INVALID_KIND') {
    return { status: 400, body: { success: false, error: 'Tipo de conocimiento inválido', code: 'INVALID_KIND' } }
  }
  if (error.message === 'OVERLAY_ACCOUNT_REQUIRED') {
    return {
      status: 400,
      body: {
        success: false,
        error: 'channel_overlay requiere socialAccountId',
        code: 'OVERLAY_ACCOUNT_REQUIRED',
      },
    }
  }
  if (error.message === 'NOT_DRAFT') {
    return {
      status: 409,
      body: {
        success: false,
        error: 'Solo se puede aprobar o editar un borrador',
        code: 'NOT_DRAFT',
      },
    }
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
    return {
      status: 503,
      body: {
        success: false,
        error: 'La operación tardó demasiado. Reintentá en unos segundos.',
        code: 'P2028',
      },
    }
  }
  return null
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

async function requireReady() {
  if (!(await isChatKnowledgeSchemaReady())) throw new Error('KNOWLEDGE_SCHEMA_NOT_READY')
}

async function bumpAgentsBoundToSource(tenantId: string, sourceId: string) {
  const links = await prisma.chatAgentKnowledgeSource.findMany({
    where: { tenantId, sourceId },
    select: { agentId: true },
  })
  if (links.length === 0) return
  await prisma.chatAgent.updateMany({
    where: { tenantId, id: { in: links.map((l) => l.agentId) } },
    data: { version: { increment: 1 } },
  })
}

export async function listKnowledgeSources(input: {
  tenantId: string
  kind?: KnowledgeKind
  status?: string
  agentId?: string
}) {
  await requireReady()
  let sourceIds: string[] | undefined
  if (input.agentId) {
    const links = await prisma.chatAgentKnowledgeSource.findMany({
      where: { tenantId: input.tenantId, agentId: input.agentId },
      select: { sourceId: true },
    })
    sourceIds = links.map((l) => l.sourceId)
  }
  const rows = await prisma.chatKnowledgeSource.findMany({
    where: {
      tenantId: input.tenantId,
      ...(input.kind ? { kind: input.kind } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(sourceIds ? { id: { in: sourceIds } } : {}),
    },
    orderBy: [{ kind: 'asc' }, { name: 'asc' }, { version: 'desc' }],
    take: 200,
  })
  return rows.map(toDto)
}

export async function getKnowledgeSource(tenantId: string, id: string) {
  await requireReady()
  const row = await prisma.chatKnowledgeSource.findFirst({
    where: { id, tenantId },
  })
  if (!row) throw new Error('SOURCE_NOT_FOUND')
  return toDto(row)
}

export async function createKnowledgeSource(input: {
  tenantId: string
  actorUserId: string
  actorName: string
  actorRole: string
  kind: string
  name: string
  body: string
  socialAccountId?: string | null
  metadata?: Record<string, unknown> | null
}) {
  await requireReady()
  if (!isKnowledgeKind(input.kind)) throw new Error('INVALID_KIND')
  const name = input.name.trim().slice(0, KNOWLEDGE_NAME_MAX)
  const body = input.body.trim()
  if (!name || !body) throw new Error('NAME_OR_BODY_REQUIRED')
  if (body.length > KNOWLEDGE_BODY_MAX) throw new Error('BODY_TOO_LONG')
  if (input.kind === 'channel_overlay' && !input.socialAccountId) {
    throw new Error('OVERLAY_ACCOUNT_REQUIRED')
  }
  if (input.kind !== 'channel_overlay' && input.socialAccountId) {
    throw new Error('OVERLAY_ACCOUNT_REQUIRED')
  }

  // SD58-01 — never trust client-supplied socialAccountId across tenants.
  let socialAccountId: string | null = null
  if (input.kind === 'channel_overlay' && input.socialAccountId) {
    const owned = await requireTenantSocialAccount(
      input.tenantId,
      input.socialAccountId,
    )
    socialAccountId = owned.id
  }

  const maxVersion = await prisma.chatKnowledgeSource.aggregate({
    where: {
      tenantId: input.tenantId,
      kind: input.kind,
      name,
    },
    _max: { version: true },
  })
  const version = (maxVersion._max.version || 0) + 1
  const contentHash = hashKnowledgeBody(body)

  const row = await prisma.chatKnowledgeSource.create({
    data: {
      tenantId: input.tenantId,
      kind: input.kind,
      name,
      body,
      status: 'draft',
      version,
      contentHash,
      socialAccountId,
      metadata: input.metadata
        ? (input.metadata as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      createdBy: input.actorUserId,
    },
  })

  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'CREATE',
    entityType: 'ChatKnowledgeSource',
    entityId: row.id,
    entityName: row.name,
    oldValues: null,
    newValues: toDto(row),
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_knowledge_create',
  })
  return toDto(row)
}

/** Edit creates a new draft version when source is approved; mutates draft body in place. */
export async function updateKnowledgeDraft(input: {
  tenantId: string
  sourceId: string
  actorUserId: string
  actorName: string
  actorRole: string
  body?: string
  name?: string
}) {
  await requireReady()
  const existing = await prisma.chatKnowledgeSource.findFirst({
    where: { id: input.sourceId, tenantId: input.tenantId },
  })
  if (!existing) throw new Error('SOURCE_NOT_FOUND')

  if (existing.status === 'approved' || existing.status === 'archived') {
    // Create next draft version from approved/archived snapshot.
    const body = (input.body ?? existing.body).trim()
    if (body.length > KNOWLEDGE_BODY_MAX) throw new Error('BODY_TOO_LONG')
    const name = (input.name ?? existing.name).trim().slice(0, KNOWLEDGE_NAME_MAX)
    const maxVersion = await prisma.chatKnowledgeSource.aggregate({
      where: {
        tenantId: input.tenantId,
        kind: existing.kind,
        name: existing.name,
      },
      _max: { version: true },
    })
    const row = await prisma.chatKnowledgeSource.create({
      data: {
        tenantId: input.tenantId,
        kind: existing.kind,
        name,
        body,
        status: 'draft',
        version: (maxVersion._max.version || existing.version) + 1,
        contentHash: hashKnowledgeBody(body),
        socialAccountId: existing.socialAccountId,
        metadata: existing.metadata === null ? Prisma.JsonNull : (existing.metadata as Prisma.InputJsonValue),
        createdBy: input.actorUserId,
      },
    })
    await logAuditEvent({
      tenantId: input.tenantId,
      action: 'CREATE',
      entityType: 'ChatKnowledgeSource',
      entityId: row.id,
      entityName: row.name,
      oldValues: toDto(existing),
      newValues: toDto(row),
      userId: input.actorUserId,
      userName: input.actorName,
      userRole: input.actorRole,
      reason: 'chat_knowledge_new_draft_version',
    })
    return toDto(row)
  }

  if (existing.status !== 'draft') throw new Error('NOT_DRAFT')
  const body = input.body !== undefined ? input.body.trim() : existing.body
  if (body.length > KNOWLEDGE_BODY_MAX) throw new Error('BODY_TOO_LONG')
  const name =
    input.name !== undefined
      ? input.name.trim().slice(0, KNOWLEDGE_NAME_MAX)
      : existing.name

  const row = await prisma.chatKnowledgeSource.update({
    where: { id: existing.id },
    data: {
      body,
      name,
      contentHash: hashKnowledgeBody(body),
    },
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatKnowledgeSource',
    entityId: row.id,
    entityName: row.name,
    oldValues: toDto(existing),
    newValues: toDto(row),
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_knowledge_update_draft',
  })
  return toDto(row)
}

export async function approveKnowledgeSource(input: {
  tenantId: string
  sourceId: string
  actorUserId: string
  actorName: string
  actorRole: string
}) {
  await requireReady()
  const existing = await prisma.chatKnowledgeSource.findFirst({
    where: { id: input.sourceId, tenantId: input.tenantId },
  })
  if (!existing) throw new Error('SOURCE_NOT_FOUND')
  if (existing.status !== 'draft') throw new Error('NOT_DRAFT')

  // Short sequential writes — no interactive txn with nested audit.
  await prisma.chatKnowledgeSource.updateMany({
    where: {
      tenantId: input.tenantId,
      kind: existing.kind,
      name: existing.name,
      status: 'approved',
      id: { not: existing.id },
    },
    data: { status: 'archived' },
  })

  const row = await prisma.chatKnowledgeSource.update({
    where: { id: existing.id },
    data: {
      status: 'approved',
      approvedBy: input.actorUserId,
      approvedAt: new Date(),
    },
  })

  await bumpAgentsBoundToSource(input.tenantId, row.id)

  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatKnowledgeSource',
    entityId: row.id,
    entityName: row.name,
    oldValues: toDto(existing),
    newValues: toDto(row),
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_knowledge_approve',
  })
  return toDto(row)
}

/** Reject = archive draft + metadata decision (no rejected status in enum). */
export async function rejectKnowledgeSource(input: {
  tenantId: string
  sourceId: string
  actorUserId: string
  actorName: string
  actorRole: string
  reason?: string
}) {
  await requireReady()
  const existing = await prisma.chatKnowledgeSource.findFirst({
    where: { id: input.sourceId, tenantId: input.tenantId },
  })
  if (!existing) throw new Error('SOURCE_NOT_FOUND')
  if (existing.status !== 'draft') throw new Error('NOT_DRAFT')

  const prevMeta =
    existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {}
  const row = await prisma.chatKnowledgeSource.update({
    where: { id: existing.id },
    data: {
      status: 'archived',
      metadata: {
        ...prevMeta,
        rejectedAt: new Date().toISOString(),
        rejectedBy: input.actorUserId,
        rejectReason: (input.reason || '').slice(0, 400) || null,
      } as Prisma.InputJsonValue,
    },
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatKnowledgeSource',
    entityId: row.id,
    entityName: row.name,
    oldValues: toDto(existing),
    newValues: toDto(row),
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_knowledge_reject',
  })
  return toDto(row)
}

export async function archiveKnowledgeSource(input: {
  tenantId: string
  sourceId: string
  actorUserId: string
  actorName: string
  actorRole: string
}) {
  await requireReady()
  const existing = await prisma.chatKnowledgeSource.findFirst({
    where: { id: input.sourceId, tenantId: input.tenantId },
  })
  if (!existing) throw new Error('SOURCE_NOT_FOUND')
  const row = await prisma.chatKnowledgeSource.update({
    where: { id: existing.id },
    data: { status: 'archived' },
  })
  await bumpAgentsBoundToSource(input.tenantId, row.id)
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatKnowledgeSource',
    entityId: row.id,
    entityName: row.name,
    oldValues: toDto(existing),
    newValues: toDto(row),
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_knowledge_archive',
  })
  return toDto(row)
}

export async function bindKnowledgeToAgent(input: {
  tenantId: string
  agentId: string
  sourceId: string
  priority?: number
  actorUserId: string
  actorName: string
  actorRole: string
}) {
  await requireReady()
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')
  const source = await prisma.chatKnowledgeSource.findFirst({
    where: { id: input.sourceId, tenantId: input.tenantId },
  })
  if (!source) throw new Error('SOURCE_NOT_FOUND')
  if (source.status !== 'approved') throw new Error('SOURCE_NOT_APPROVED')

  const link = await prisma.chatAgentKnowledgeSource.upsert({
    where: {
      agentId_sourceId: { agentId: input.agentId, sourceId: input.sourceId },
    },
    create: {
      tenantId: input.tenantId,
      agentId: input.agentId,
      sourceId: input.sourceId,
      priority: input.priority ?? 100,
    },
    update: {
      priority: input.priority ?? 100,
    },
  })
  await prisma.chatAgent.update({
    where: { id: agent.id },
    data: { version: { increment: 1 }, updatedBy: input.actorUserId },
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgentKnowledgeSource',
    entityId: link.id,
    entityName: `${agent.name}←${source.name}`,
    oldValues: null,
    newValues: {
      agentId: input.agentId,
      sourceId: input.sourceId,
      priority: link.priority,
    },
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_knowledge_bind',
  })
  return link
}

export async function unbindKnowledgeFromAgent(input: {
  tenantId: string
  agentId: string
  sourceId: string
  actorUserId: string
  actorName: string
  actorRole: string
}) {
  await requireReady()
  const link = await prisma.chatAgentKnowledgeSource.findFirst({
    where: {
      tenantId: input.tenantId,
      agentId: input.agentId,
      sourceId: input.sourceId,
    },
  })
  if (!link) throw new Error('SOURCE_NOT_FOUND')
  await prisma.chatAgentKnowledgeSource.delete({ where: { id: link.id } })
  await prisma.chatAgent.updateMany({
    where: { id: input.agentId, tenantId: input.tenantId },
    data: { version: { increment: 1 }, updatedBy: input.actorUserId },
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'DELETE',
    entityType: 'ChatAgentKnowledgeSource',
    entityId: link.id,
    entityName: `${input.agentId}←${input.sourceId}`,
    oldValues: { agentId: input.agentId, sourceId: input.sourceId },
    newValues: null,
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_knowledge_unbind',
  })
}

export async function knowledgeChecklistStatus(tenantId: string) {
  const ready = await isChatKnowledgeSchemaReady()
  if (!ready) {
    return {
      schemaReady: false as const,
      rows: [] as Array<{
        kind: string
        status: string
        name: string
        _count: { _all: number }
      }>,
    }
  }
  const rows = await prisma.chatKnowledgeSource.groupBy({
    by: ['kind', 'status', 'name'],
    where: { tenantId },
    _count: { _all: true },
  })
  return { schemaReady: true as const, rows }
}
