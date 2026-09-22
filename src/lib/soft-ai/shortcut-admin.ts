/**
 * Shortcut CRUD. Reserved sys_* keys can be edited, not renamed or deleted.
 * Cross-tenant ids return not found.
 */

import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { isChatAgentSchemaReady } from '@/lib/soft-ai/agent-schema'
import { logAuditEvent } from '@/lib/auditLogger'
import {
  RESERVED_SHORTCUT_SEEDS,
  STARTER_SHORTCUT_TEMPLATES,
  isReservedShortcutKey,
  validateShortcutForSave,
  type ShortcutDraft,
} from '@/lib/soft-ai/shortcuts'

async function requireAgent(tenantId: string, agentId: string) {
  const agent = await prisma.chatAgent.findFirst({
    where: { id: agentId, tenantId },
    select: { id: true, name: true },
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')
  return agent
}

export async function listShortcuts(tenantId: string, agentId: string) {
  if (!(await isChatAgentSchemaReady())) return { schemaReady: false as const, shortcuts: [] }
  await requireAgent(tenantId, agentId)
  const shortcuts = await prisma.chatAgentShortcut.findMany({
    where: { tenantId, agentId },
    orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
  })
  return { schemaReady: true as const, shortcuts, templates: STARTER_SHORTCUT_TEMPLATES }
}

export async function ensureReservedShortcuts(input: {
  tenantId: string
  agentId: string
  actorUserId: string
}) {
  if (!(await isChatAgentSchemaReady())) return
  const existing = await prisma.chatAgentShortcut.findMany({
    where: { tenantId: input.tenantId, agentId: input.agentId },
    select: { key: true },
  })
  const have = new Set(existing.map((row) => row.key))
  const missing = RESERVED_SHORTCUT_SEEDS.filter((seed) => !have.has(seed.key))
  if (missing.length === 0) return
  await prisma.chatAgentShortcut.createMany({
    data: missing.map((seed, index) => ({
      tenantId: input.tenantId,
      agentId: input.agentId,
      key: seed.key,
      title: seed.title,
      kind: seed.kind,
      intents: seed.intents,
      keywords: seed.keywords,
      body: seed.body,
      deliveryMode: seed.deliveryMode,
      isActive: true,
      sortOrder: index,
      version: 1,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    })),
  })
}

function assertSave(draft: ShortcutDraft) {
  const result = validateShortcutForSave(draft)
  if (!result.ok) throw new Error(result.code)
}

export async function createShortcut(input: {
  tenantId: string
  agentId: string
  actorUserId: string
  actorName: string
  actorRole: string
  draft: ShortcutDraft
}) {
  if (!(await isChatAgentSchemaReady())) throw new Error('SCHEMA_NOT_READY')
  await requireAgent(input.tenantId, input.agentId)
  if (isReservedShortcutKey(input.draft.key)) throw new Error('SHORTCUT_RESERVED')
  assertSave(input.draft)
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.chatAgentShortcut.create({
      data: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        key: input.draft.key,
        title: input.draft.title.trim(),
        kind: input.draft.kind,
        intents: input.draft.intents,
        keywords: input.draft.keywords,
        body: input.draft.body.trim(),
        deliveryMode: input.draft.deliveryMode,
        isActive: input.draft.isActive !== false,
        sortOrder: input.draft.sortOrder ?? 100,
        createdBy: input.actorUserId,
        updatedBy: input.actorUserId,
      },
    })
    const bumped = await tx.chatAgent.updateMany({
      where: { id: input.agentId, tenantId: input.tenantId },
      data: { version: { increment: 1 }, updatedBy: input.actorUserId },
    })
    if (bumped.count !== 1) throw new Error('AGENT_NOT_FOUND')
    return created
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'CREATE',
    entityType: 'ChatAgentShortcut',
    entityId: row.id,
    entityName: row.key,
    oldValues: null,
    newValues: { key: row.key, body: row.body },
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_agent_shortcut_create',
  })
  return row
}

export async function updateShortcut(input: {
  tenantId: string
  agentId: string
  shortcutId: string
  actorUserId: string
  actorName: string
  actorRole: string
  patch: Partial<ShortcutDraft>
}) {
  if (!(await isChatAgentSchemaReady())) throw new Error('SCHEMA_NOT_READY')
  const existing = await prisma.chatAgentShortcut.findFirst({
    where: { id: input.shortcutId, tenantId: input.tenantId, agentId: input.agentId },
  })
  if (!existing) throw new Error('SHORTCUT_NOT_FOUND')
  if (input.patch.key && input.patch.key !== existing.key) {
    throw new Error(isReservedShortcutKey(existing.key) ? 'SHORTCUT_RESERVED' : 'SHORTCUT_KEY_LOCKED')
  }
  const next: ShortcutDraft = {
    key: existing.key,
    title: input.patch.title ?? existing.title,
    kind: (input.patch.kind ?? existing.kind) as ShortcutDraft['kind'],
    intents: (input.patch.intents ?? existing.intents) as ShortcutDraft['intents'],
    keywords: input.patch.keywords ?? existing.keywords,
    body: input.patch.body ?? existing.body,
    deliveryMode: (input.patch.deliveryMode ?? existing.deliveryMode) as ShortcutDraft['deliveryMode'],
  }
  assertSave(next)
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.chatAgentShortcut.update({
      where: { id: existing.id },
      data: {
        title: next.title.trim(),
        kind: next.kind,
        intents: next.intents,
        keywords: next.keywords,
        body: next.body.trim(),
        deliveryMode: next.deliveryMode,
        isActive: input.patch.isActive ?? existing.isActive,
        sortOrder: input.patch.sortOrder ?? existing.sortOrder,
        version: { increment: 1 },
        updatedBy: input.actorUserId,
      },
    })
    const bumped = await tx.chatAgent.updateMany({
      where: { id: input.agentId, tenantId: input.tenantId },
      data: { version: { increment: 1 }, updatedBy: input.actorUserId },
    })
    if (bumped.count !== 1) throw new Error('AGENT_NOT_FOUND')
    return updated
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgentShortcut',
    entityId: row.id,
    entityName: row.key,
    oldValues: { body: existing.body, title: existing.title },
    newValues: { body: row.body, title: row.title },
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_agent_shortcut_update',
  })
  return row
}

export async function deleteShortcut(input: {
  tenantId: string
  agentId: string
  shortcutId: string
  actorUserId: string
  actorName: string
  actorRole: string
}) {
  if (!(await isChatAgentSchemaReady())) throw new Error('SCHEMA_NOT_READY')
  const existing = await prisma.chatAgentShortcut.findFirst({
    where: { id: input.shortcutId, tenantId: input.tenantId, agentId: input.agentId },
  })
  if (!existing) throw new Error('SHORTCUT_NOT_FOUND')
  if (isReservedShortcutKey(existing.key)) throw new Error('SHORTCUT_RESERVED')
  await prisma.$transaction(async (tx) => {
    await tx.chatAgentShortcut.delete({ where: { id: existing.id } })
    const bumped = await tx.chatAgent.updateMany({
      where: { id: input.agentId, tenantId: input.tenantId },
      data: { version: { increment: 1 }, updatedBy: input.actorUserId },
    })
    if (bumped.count !== 1) throw new Error('AGENT_NOT_FOUND')
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'DELETE',
    entityType: 'ChatAgentShortcut',
    entityId: existing.id,
    entityName: existing.key,
    oldValues: { key: existing.key },
    newValues: null,
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_agent_shortcut_delete',
  })
  return { ok: true as const }
}

export async function cloneStarterShortcut(input: {
  tenantId: string
  agentId: string
  templateKey: string
  actorUserId: string
  actorName: string
  actorRole: string
}) {
  const template = STARTER_SHORTCUT_TEMPLATES.find((row) => row.key === input.templateKey)
  if (!template) throw new Error('TEMPLATE_NOT_FOUND')
  return createShortcut({
    ...input,
    draft: template,
  })
}

export function shortcutErrorStatus(error: unknown): { status: number; code: string } | null {
  const code = error instanceof Error ? error.message : ''
  if (code === 'SHORTCUT_NOT_FOUND' || code === 'AGENT_NOT_FOUND' || code === 'TEMPLATE_NOT_FOUND') {
    return { status: 404, code }
  }
  if (code === 'confirmation_wording') return { status: 422, code }
  if (code === 'SCHEMA_NOT_READY') return { status: 503, code }
  if (code.startsWith('shortcut_') || code === 'SHORTCUT_RESERVED' || code === 'SHORTCUT_KEY_LOCKED') {
    return { status: 422, code }
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return { status: 409, code: 'shortcut_exists' }
  }
  return null
}
