/**
 * Soft Agent Layer admin — CRUD, panic, audit, Probar.
 * OWNER/ADMIN (update_config) for mutations; view_config for reads.
 */

import 'server-only'

import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  A1_TOOL_NAMES,
  AGENT_INSTRUCTIONS_MAX,
  AGENT_NAME_MAX,
  DEFAULT_FORGE_VOICE,
  FORGE_WA_SOCIAL_ACCOUNT_ID,
  isAllowedChatAgentModel,
  isA1ToolName,
  type ChatAgentOperationMode,
  type ChatAgentStatus,
  type ChatAgentTonePreset,
} from '@/lib/soft-ai/agent-types'
import {
  chatAgentLayerConfigToJson,
  parseChatAgentLayerConfig,
  CHAT_AGENT_LAYER_V1_FLAG,
} from '@/lib/soft-ai/agent-config'
import { isChatAgentSchemaReady, isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import { runAgentTestTurn } from '@/lib/soft-ai/agent-turn'
import { logAuditEvent } from '@/lib/auditLogger'

/** Interactive txn options if a multi-write admin path needs `$transaction` again. */
export const CHAT_AGENT_ADMIN_TX = {
  maxWait: 20_000,
  timeout: 20_000,
} as const

export type ChatAgentAdminHttpError = {
  status: number
  body: { success: false; error: string; schemaReady?: false; code?: string }
}

/**
 * Map admin thrown codes / Prisma errors to clear Spanish API payloads.
 * Prefer this over a generic "Error al crear agente".
 */
export function mapChatAgentAdminError(error: unknown): ChatAgentAdminHttpError | null {
  const msg = error instanceof Error ? error.message : ''
  if (msg === 'SCHEMA_NOT_READY') {
    return {
      status: 503,
      body: {
        success: false,
        error: 'SQL 027 aún no aplicado — no se pueden crear agentes todavía',
        schemaReady: false,
        code: 'SCHEMA_NOT_READY',
      },
    }
  }
  if (msg === 'NAME_REQUIRED') {
    return {
      status: 400,
      body: { success: false, error: 'Nombre requerido', code: 'NAME_REQUIRED' },
    }
  }
  if (msg === 'AGENT_NOT_FOUND') {
    return {
      status: 404,
      body: { success: false, error: 'Agente no encontrado', code: 'AGENT_NOT_FOUND' },
    }
  }
  if (msg === 'MODEL_NOT_ALLOWED') {
    return {
      status: 400,
      body: { success: false, error: 'Modelo no permitido', code: 'MODEL_NOT_ALLOWED' },
    }
  }
  if (msg === 'SOCIAL_ACCOUNT_NOT_FOUND') {
    return {
      status: 404,
      body: { success: false, error: 'Cuenta social no encontrada', code: 'SOCIAL_ACCOUNT_NOT_FOUND' },
    }
  }
  if (msg === 'SOCIAL_ACCOUNT_ID_REQUIRED') {
    return {
      status: 400,
      body: {
        success: false,
        error: 'Indicá la cuenta social (socialAccountId)',
        code: 'SOCIAL_ACCOUNT_ID_REQUIRED',
      },
    }
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2028') {
      return {
        status: 503,
        body: {
          success: false,
          error:
            'La base de datos tardó demasiado (transacción cerrada). Reintentá en unos segundos.',
          code: 'P2028',
        },
      }
    }
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target)
        ? (error.meta?.target as string[]).join(',')
        : String(error.meta?.target || '')
      if (/name/i.test(target) || /tenantId_name/i.test(target)) {
        return {
          status: 409,
          body: {
            success: false,
            error: 'Ya existe un agente con ese nombre en este tenant',
            code: 'NAME_CONFLICT',
          },
        }
      }
      return {
        status: 409,
        body: {
          success: false,
          error: 'Conflicto de unicidad — ese registro ya existe',
          code: 'UNIQUE_CONFLICT',
        },
      }
    }
  }

  return null
}

function asTone(v: unknown): ChatAgentTonePreset {
  if (v === 'formal' || v === 'playful' || v === 'warm_concise') return v
  return 'warm_concise'
}

function asMode(v: unknown): ChatAgentOperationMode {
  if (v === 'ai_full' || v === 'ai_suggest' || v === 'human_only') return v
  return 'ai_suggest'
}

function asStatus(v: unknown): ChatAgentStatus {
  if (v === 'draft' || v === 'live' || v === 'archived') return v
  return 'draft'
}

function snapshotAgent(row: {
  id: string
  name: string
  emoji: string
  description: string | null
  systemInstructions: string
  tonePreset: string
  model: string
  operationMode: string
  enabledTools: string[]
  status: string
  version: number
}) {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    systemInstructions: row.systemInstructions,
    tonePreset: row.tonePreset,
    model: row.model,
    operationMode: row.operationMode,
    enabledTools: row.enabledTools,
    status: row.status,
    version: row.version,
  }
}

export async function listChatAgents(tenantId: string) {
  if (!(await isChatAgentSchemaReady())) {
    return { schemaReady: false as const, agents: [] as const }
  }
  try {
    const agents = await prisma.chatAgent.findMany({
      where: { tenantId, status: { not: 'archived' } },
      orderBy: { updatedAt: 'desc' },
      include: {
        bindings: {
          where: { isActive: true },
          select: {
            id: true,
            scope: true,
            socialAccountId: true,
            isActive: true,
          },
        },
      },
    })
    return { schemaReady: true as const, agents }
  } catch (error) {
    if (isMissingRelationError(error)) {
      return { schemaReady: false as const, agents: [] as const }
    }
    throw error
  }
}

export async function createChatAgent(input: {
  tenantId: string
  actorUserId: string
  actorName: string
  actorRole: string
  name: string
  emoji?: string
  description?: string | null
  systemInstructions?: string
  tonePreset?: ChatAgentTonePreset
  enabledTools?: string[]
}) {
  if (!(await isChatAgentSchemaReady())) throw new Error('SCHEMA_NOT_READY')
  const name = input.name.trim().slice(0, AGENT_NAME_MAX)
  if (!name) throw new Error('NAME_REQUIRED')
  const systemInstructions = (
    input.systemInstructions?.trim() || DEFAULT_FORGE_VOICE
  ).slice(0, AGENT_INSTRUCTIONS_MAX)
  const enabledTools = (input.enabledTools || [...A1_TOOL_NAMES]).filter(isA1ToolName)

  // Single write — do NOT nest logAuditEvent inside $transaction (audit uses
  // global prisma and held interactive txns open → P2028 under Supabase latency).
  const row = await prisma.chatAgent.create({
    data: {
      tenantId: input.tenantId,
      name,
      emoji: (input.emoji || '✨').slice(0, 8),
      description: input.description?.trim() || null,
      systemInstructions,
      tonePreset: asTone(input.tonePreset),
      model: 'grok-4.6',
      operationMode: 'ai_suggest',
      enabledTools,
      paymentAlwaysHuman: true,
      status: 'draft',
      version: 1,
      createdBy: input.actorUserId,
      updatedBy: input.actorUserId,
    },
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'CREATE',
    entityType: 'ChatAgent',
    entityId: row.id,
    entityName: row.name,
    oldValues: null,
    newValues: snapshotAgent(row),
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_agent_create',
  })
  return row
}

export async function updateChatAgent(input: {
  tenantId: string
  agentId: string
  actorUserId: string
  actorName: string
  actorRole: string
  patch: {
    name?: string
    emoji?: string
    description?: string | null
    systemInstructions?: string
    tonePreset?: ChatAgentTonePreset
    operationMode?: ChatAgentOperationMode
    enabledTools?: string[]
    status?: ChatAgentStatus
    model?: string
  }
}) {
  if (!(await isChatAgentSchemaReady())) throw new Error('SCHEMA_NOT_READY')
  const existing = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
  })
  if (!existing) throw new Error('AGENT_NOT_FOUND')

  const data: Prisma.ChatAgentUpdateInput = {
    updatedBy: input.actorUserId,
  }
  let bumpVersion = false

  if (typeof input.patch.name === 'string') {
    data.name = input.patch.name.trim().slice(0, AGENT_NAME_MAX)
  }
  if (typeof input.patch.emoji === 'string') {
    data.emoji = input.patch.emoji.slice(0, 8)
  }
  if (input.patch.description !== undefined) {
    data.description = input.patch.description?.trim() || null
  }
  if (typeof input.patch.systemInstructions === 'string') {
    data.systemInstructions = input.patch.systemInstructions
      .trim()
      .slice(0, AGENT_INSTRUCTIONS_MAX)
    bumpVersion = true
  }
  if (input.patch.tonePreset) {
    data.tonePreset = asTone(input.patch.tonePreset)
    bumpVersion = true
  }
  if (input.patch.operationMode) {
    data.operationMode = asMode(input.patch.operationMode)
    bumpVersion = true
  }
  if (input.patch.enabledTools) {
    data.enabledTools = input.patch.enabledTools.filter(isA1ToolName)
    bumpVersion = true
  }
  if (input.patch.status) {
    data.status = asStatus(input.patch.status)
  }
  if (typeof input.patch.model === 'string') {
    if (!isAllowedChatAgentModel(input.patch.model)) {
      throw new Error('MODEL_NOT_ALLOWED')
    }
    data.model = input.patch.model
    bumpVersion = true
  }
  if (bumpVersion) {
    data.version = { increment: 1 }
  }

  // Single write — audit AFTER commit (never inside interactive $transaction).
  const row = await prisma.chatAgent.update({
    where: { id: existing.id },
    data,
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgent',
    entityId: row.id,
    entityName: row.name,
    oldValues: snapshotAgent(existing),
    newValues: snapshotAgent(row),
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_agent_update',
  })
  return row
}

export async function listAgentAudit(tenantId: string, agentId: string, take = 20) {
  return prisma.auditLog.findMany({
    where: {
      tenantId,
      entityType: 'ChatAgent',
      entityId: agentId,
    },
    orderBy: { timestamp: 'desc' },
    take,
    select: {
      id: true,
      action: true,
      oldValues: true,
      newValues: true,
      userId: true,
      userName: true,
      userRole: true,
      reason: true,
      timestamp: true,
    },
  })
}

/**
 * SD54-01 — SocialAccount must belong to the acting tenant before any bind/panic write.
 * Throws SOCIAL_ACCOUNT_NOT_FOUND (map to HTTP 404; no existence leak across tenants).
 */
export async function requireTenantSocialAccount(
  tenantId: string,
  socialAccountId: string,
  deps?: {
    findFirst?: (args: {
      where: { id: string; tenantId: string }
      select: { id: true }
    }) => Promise<{ id: string } | null>
  },
): Promise<{ id: string }> {
  const id = socialAccountId.trim()
  if (!id) throw new Error('SOCIAL_ACCOUNT_NOT_FOUND')
  const findFirst =
    deps?.findFirst ||
    ((args) => prisma.socialAccount.findFirst(args))
  const account = await findFirst({
    where: { id, tenantId },
    select: { id: true },
  })
  if (!account) throw new Error('SOCIAL_ACCOUNT_NOT_FOUND')
  return account
}

export async function setAgentBinding(input: {
  tenantId: string
  agentId: string
  socialAccountId: string
  actorUserId: string
  active: boolean
  actorName: string
  actorRole: string
}) {
  if (!(await isChatAgentSchemaReady())) throw new Error('SCHEMA_NOT_READY')
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')

  await requireTenantSocialAccount(input.tenantId, input.socialAccountId)

  if (!input.active) {
    await prisma.chatAgentBinding.updateMany({
      where: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        socialAccountId: input.socialAccountId,
        scope: 'social_account',
        isActive: true,
      },
      data: { isActive: false },
    })
    return { ok: true }
  }

  // Deactivate other active bindings for this account first.
  await prisma.chatAgentBinding.updateMany({
    where: {
      tenantId: input.tenantId,
      socialAccountId: input.socialAccountId,
      scope: 'social_account',
      isActive: true,
    },
    data: { isActive: false },
  })

  const binding = await prisma.chatAgentBinding.create({
    data: {
      tenantId: input.tenantId,
      agentId: input.agentId,
      scope: 'social_account',
      socialAccountId: input.socialAccountId,
      isActive: true,
      createdBy: input.actorUserId,
    },
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'CREATE',
    entityType: 'ChatAgentBinding',
    entityId: binding.id,
    entityName: `${agent.name}→${input.socialAccountId}`,
    newValues: {
      agentId: input.agentId,
      socialAccountId: input.socialAccountId,
      scope: 'social_account',
    },
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
  })
  return binding
}

export async function panicPauseChannel(input: {
  tenantId: string
  socialAccountId: string
  actorUserId: string
  actorName: string
  actorRole: string
}) {
  await requireTenantSocialAccount(input.tenantId, input.socialAccountId)

  const result = await prisma.chatAgentBinding.updateMany({
    where: {
      tenantId: input.tenantId,
      socialAccountId: input.socialAccountId,
      scope: 'social_account',
      isActive: true,
    },
    data: { isActive: false },
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgentBinding',
    entityId: input.socialAccountId,
    entityName: 'panic_pause_channel',
    oldValues: { isActive: true },
    newValues: { isActive: false, count: result.count },
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'panic_pause_channel',
  })
  return result
}

export async function panicHumanOnly(input: {
  tenantId: string
  agentId: string
  actorUserId: string
  actorName: string
  actorRole: string
}) {
  return updateChatAgent({
    tenantId: input.tenantId,
    agentId: input.agentId,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    patch: { operationMode: 'human_only' },
  })
}

export async function panicRemoveAllowlist(input: {
  tenantId: string
  socialAccountId: string
  actorUserId: string
  actorName: string
  actorRole: string
}) {
  await requireTenantSocialAccount(input.tenantId, input.socialAccountId)

  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: {
      tenantId: input.tenantId,
      scope: input.tenantId,
      key: CHAT_AGENT_LAYER_V1_FLAG,
    },
  })
  const before = parseChatAgentLayerConfig(flag?.config)
  const after = {
    ...before,
    accountAllowlist: before.accountAllowlist.filter((id) => id !== input.socialAccountId),
    aiFullUnlock: { ...before.aiFullUnlock },
  }
  delete after.aiFullUnlock[input.socialAccountId]

  await prisma.tenantFeatureFlag.upsert({
    where: {
      scope_key: {
        scope: input.tenantId,
        key: CHAT_AGENT_LAYER_V1_FLAG,
      },
    },
    create: {
      tenantId: input.tenantId,
      scope: input.tenantId,
      key: CHAT_AGENT_LAYER_V1_FLAG,
      enabled: flag?.enabled ?? false,
      config: chatAgentLayerConfigToJson(after) as Prisma.InputJsonValue,
    },
    update: {
      config: chatAgentLayerConfigToJson(after) as Prisma.InputJsonValue,
    },
  })

  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'TenantFeatureFlag',
    entityId: CHAT_AGENT_LAYER_V1_FLAG,
    entityName: 'panic_remove_allowlist',
    oldValues: chatAgentLayerConfigToJson(before),
    newValues: chatAgentLayerConfigToJson(after),
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'panic_remove_allowlist',
  })
  return after
}

/**
 * Resolve panic/bind target account id: require client id, or (only when omitted)
 * the sole entry in this tenant's chat_agent_layer_v1 allowlist. Never a hardcoded Forge default.
 */
export async function resolvePanicSocialAccountId(input: {
  tenantId: string
  socialAccountId?: string | null
}): Promise<string> {
  const explicit =
    typeof input.socialAccountId === 'string' ? input.socialAccountId.trim() : ''
  if (explicit) {
    await requireTenantSocialAccount(input.tenantId, explicit)
    return explicit
  }
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: {
      tenantId: input.tenantId,
      scope: input.tenantId,
      key: CHAT_AGENT_LAYER_V1_FLAG,
    },
    select: { config: true },
  })
  const allowlist = parseChatAgentLayerConfig(flag?.config).accountAllowlist
  if (allowlist.length === 1) {
    await requireTenantSocialAccount(input.tenantId, allowlist[0])
    return allowlist[0]
  }
  throw new Error('SOCIAL_ACCOUNT_ID_REQUIRED')
}

export async function probeAgent(input: {
  tenantId: string
  agentId: string
  inboundText: string
  socialAccountId?: string | null
  actorUserId: string
}) {
  return runAgentTestTurn(input)
}

export async function ensurePilotDefaults(input: {
  tenantId: string
  actorUserId: string
}) {
  if (!(await isChatAgentSchemaReady())) return { ok: false, reason: 'schema_not_ready' }

  let pred = await prisma.chatAgent.findFirst({
    where: { tenantId: input.tenantId, name: 'Predeterminado' },
  })
  if (!pred) {
    pred = await prisma.chatAgent.create({
      data: {
        tenantId: input.tenantId,
        name: 'Predeterminado',
        emoji: '👤',
        description: 'Tenant default — solo humanos',
        systemInstructions: 'Este agente no responde; solo humanos.',
        tonePreset: 'warm_concise',
        model: 'grok-4.6',
        operationMode: 'human_only',
        enabledTools: [],
        paymentAlwaysHuman: true,
        status: 'live',
        version: 1,
        createdBy: input.actorUserId,
        updatedBy: input.actorUserId,
      },
    })
  }

  const existingDefault = await prisma.chatAgentBinding.findFirst({
    where: {
      tenantId: input.tenantId,
      scope: 'tenant_default',
      isActive: true,
    },
  })
  if (!existingDefault) {
    await prisma.chatAgentBinding.create({
      data: {
        tenantId: input.tenantId,
        agentId: pred.id,
        scope: 'tenant_default',
        socialAccountId: null,
        isActive: true,
        createdBy: input.actorUserId,
      },
    })
  }

  let forge = await prisma.chatAgent.findFirst({
    where: { tenantId: input.tenantId, name: 'Forge ventas' },
  })
  if (!forge) {
    forge = await prisma.chatAgent.create({
      data: {
        tenantId: input.tenantId,
        name: 'Forge ventas',
        emoji: '✨',
        description: 'Ventas Forge WA',
        systemInstructions: DEFAULT_FORGE_VOICE,
        tonePreset: 'warm_concise',
        model: 'grok-4.6',
        operationMode: 'ai_suggest',
        enabledTools: [...A1_TOOL_NAMES],
        paymentAlwaysHuman: true,
        status: 'draft',
        version: 1,
        createdBy: input.actorUserId,
        updatedBy: input.actorUserId,
      },
    })
  }

  const forgeBinding = await prisma.chatAgentBinding.findFirst({
    where: {
      tenantId: input.tenantId,
      scope: 'social_account',
      socialAccountId: FORGE_WA_SOCIAL_ACCOUNT_ID,
      isActive: true,
    },
  })
  if (!forgeBinding) {
    await prisma.chatAgentBinding.create({
      data: {
        tenantId: input.tenantId,
        agentId: forge.id,
        scope: 'social_account',
        socialAccountId: FORGE_WA_SOCIAL_ACCOUNT_ID,
        isActive: true,
        createdBy: input.actorUserId,
      },
    })
  }

  return { ok: true, predId: pred.id, forgeId: forge.id }
}

export { FORGE_WA_SOCIAL_ACCOUNT_ID }
