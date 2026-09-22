/**
 * Persist a reviewed shortcut import and charge extraction tokens.
 * One agent version bump and one audit row. No Meta writes.
 */

import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hashSoftAiOutput, loadDailyTestTokens } from '@/lib/soft-ai/agent-claim-gates'
import {
  CHAT_AGENT_LAYER_V1_FLAG,
  parseChatAgentLayerConfig,
} from '@/lib/soft-ai/agent-config'
import { isChatAgentSchemaReady } from '@/lib/soft-ai/agent-schema'
import { parseBrandFactsSafe } from '@/lib/soft-ai/brand-facts'
import {
  parseSoftAiResponseText,
  readSoftAiUsage,
  resolveSoftAiModel,
  softAiResponsesCreate,
} from '@/lib/soft-ai/llm/client'
import {
  SHORTCUT_IMPORT_INSTRUCTIONS,
  extractShortcutImport,
  planShortcutImportApply,
  signProposalToken,
  verifyProposalToken,
  type ShortcutImportApplyRequest,
  type ShortcutImportProposal,
} from '@/lib/soft-ai/shortcut-import'

function importSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET?.trim()
  if (!secret) throw new Error('IMPORT_TOKEN_INVALID')
  return secret
}

function payloadHashFromAudit(newValues: unknown): string | null {
  if (!newValues || typeof newValues !== 'object' || Array.isArray(newValues)) return null
  const hash = (newValues as { payloadHash?: unknown }).payloadHash
  return typeof hash === 'string' ? hash : null
}

async function resolveChargeAccount(tenantId: string, agentId: string): Promise<string | null> {
  const binding = await prisma.chatAgentBinding.findFirst({
    where: { tenantId, agentId, isActive: true, socialAccountId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: { socialAccountId: true },
  })
  if (binding?.socialAccountId) return binding.socialAccountId
  const account = await prisma.socialAccount.findFirst({
    where: { tenantId, isActive: true },
    orderBy: { linkedAt: 'asc' },
    select: { id: true },
  })
  return account?.id ?? null
}

export async function runShortcutExtract(input: {
  tenantId: string
  agentId: string
  paste: string
}) {
  if (!(await isChatAgentSchemaReady())) throw new Error('SCHEMA_NOT_READY')
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
    select: { id: true, version: true, model: true },
  })
  if (!agent) throw new Error('AGENT_NOT_FOUND')

  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: {
      tenantId: input.tenantId,
      scope: input.tenantId,
      key: CHAT_AGENT_LAYER_V1_FLAG,
    },
    select: { config: true },
  })
  const config = parseChatAgentLayerConfig(flag?.config)
  const testTokensUsed = await loadDailyTestTokens(input.tenantId)
  const socialAccountId = await resolveChargeAccount(input.tenantId, agent.id)
  const llmReady = Boolean(process.env.XAI_API_KEY?.trim())
  let charged = false

  const proposal = await extractShortcutImport(
    { paste: input.paste, agentVersion: agent.version },
    {
      testTokensUsed,
      testDailyTokenCap: config.testDailyTokenCap,
      complete: llmReady
        ? async (prompt) => {
            const model = resolveSoftAiModel(agent.model)
            const response = await softAiResponsesCreate({
              model,
              instructions: SHORTCUT_IMPORT_INSTRUCTIONS,
              input: [{ type: 'message', role: 'user', content: prompt }],
              store: false,
              reasoningEffort: 'low',
              temperature: 0.1,
              maxOutputTokens: 1400,
            })
            const usage = readSoftAiUsage(response)
            return { text: parseSoftAiResponseText(response), usage }
          }
        : undefined,
      persistUsage: async (usage, extractionId) => {
        if (!socialAccountId) return
        await prisma.chatAgentTurn.create({
          data: {
            tenantId: input.tenantId,
            conversationId: null,
            socialAccountId,
            agentId: agent.id,
            automationDeliveryKey: `shortcut-import:${agent.id}:${extractionId}`,
            mode: 'test',
            model: agent.model || 'grok-4.6',
            agentVersion: agent.version,
            status: 'test',
            outputText: null,
            outputHash: hashSoftAiOutput(extractionId),
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
            reasoningTokens: usage.reasoningTokens,
            estimatedCostMicros: BigInt(0),
            pricingVersion: 'xai-2026-09',
            completedAt: new Date(),
          },
        })
        charged = true
      },
    },
  )

  const proposalToken = signProposalToken(proposal, {
    tenantId: input.tenantId,
    agentId: agent.id,
  }, importSecret())

  return {
    proposal,
    proposalToken,
    persisted: false as const,
    tokenAccounting: {
      bucket: 'testDailyTokenCap' as const,
      charged,
      testTokensUsed,
      testDailyTokenCap: config.testDailyTokenCap,
    },
  }
}

export async function runShortcutApply(input: {
  tenantId: string
  agentId: string
  actorUserId: string
  actorName: string
  actorRole: string
  request: ShortcutImportApplyRequest
}) {
  if (!(await isChatAgentSchemaReady())) throw new Error('SCHEMA_NOT_READY')
  if (input.request.reviewed !== true || input.request.schemaVersion !== 1) {
    throw new Error('IMPORT_TOKEN_INVALID')
  }
  const secret = importSecret()
  const claims = verifyProposalToken(input.request.proposalToken, secret)
  if (!claims || claims.tenantId !== input.tenantId || claims.agentId !== input.agentId) {
    throw new Error('IMPORT_TOKEN_INVALID')
  }

  const reason = `chat_agent_shortcut_import:${claims.extractionId}`
  const lockKey = `${input.tenantId}:${input.agentId}:${claims.extractionId}`

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
    const agent = await tx.chatAgent.findFirst({
      where: { id: input.agentId, tenantId: input.tenantId },
    })
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    const audit = await tx.auditLog.findFirst({
      where: { tenantId: input.tenantId, entityType: 'ChatAgent', entityId: agent.id, reason },
      orderBy: { timestamp: 'desc' },
    })
    const plan = planShortcutImportApply({
      token: input.request.proposalToken,
      secret,
      tenantId: input.tenantId,
      agentId: input.agentId,
      currentFacts: parseBrandFactsSafe(agent.brandFacts),
      request: { facts: input.request.facts, shortcuts: input.request.shortcuts },
      existingPayloadHash: payloadHashFromAudit(audit?.newValues),
    })
    if (plan.action === 'noop') {
      return {
        applied: false as const,
        agentVersion: agent.version,
        createdShortcutIds: [] as string[],
      }
    }
    if (plan.action === 'conflict') throw new Error('IDEMPOTENCY_CONFLICT')
    if (plan.action === 'reject') throw new Error(plan.code)
    if (agent.version !== claims.agentVersion) throw new Error('VERSION_CONFLICT')

    const updated = await tx.chatAgent.update({
      where: { id: agent.id },
      data: {
        brandFacts: plan.facts as Prisma.InputJsonValue,
        version: { increment: 1 },
        updatedBy: input.actorUserId,
      },
    })
    const createdShortcutIds: string[] = []
    for (const draft of plan.shortcuts) {
      const existing = await tx.chatAgentShortcut.findFirst({
        where: { agentId: agent.id, key: draft.key },
      })
      if (existing) {
        const row = await tx.chatAgentShortcut.update({
          where: { id: existing.id },
          data: {
            title: draft.title,
            body: draft.body,
            kind: draft.kind,
            intents: draft.intents,
            keywords: draft.keywords,
            deliveryMode: draft.deliveryMode,
            isActive: draft.isActive !== false,
            updatedBy: input.actorUserId,
            version: { increment: 1 },
          },
        })
        createdShortcutIds.push(row.id)
        continue
      }
      const row = await tx.chatAgentShortcut.create({
        data: {
          tenantId: input.tenantId,
          agentId: agent.id,
          key: draft.key,
          title: draft.title,
          kind: draft.kind,
          intents: draft.intents,
          keywords: draft.keywords,
          body: draft.body,
          deliveryMode: draft.deliveryMode,
          isActive: draft.isActive !== false,
          sortOrder: draft.sortOrder ?? 80,
          createdBy: input.actorUserId,
          updatedBy: input.actorUserId,
        },
      })
      createdShortcutIds.push(row.id)
    }
    await tx.auditLog.create({
      data: {
        action: 'UPDATE',
        entityType: 'ChatAgent',
        entityId: agent.id,
        entityName: agent.name,
        reason,
        oldValues: { version: agent.version },
        newValues: {
          payloadHash: plan.payloadHash,
          factPaths: plan.factPaths,
          shortcutKeys: plan.shortcuts.map((row) => row.key),
          version: updated.version,
        },
        userName: input.actorName || 'Sistema',
        userRole: input.actorRole || 'ADMIN',
        tenantId: input.tenantId,
      },
    })
    return {
      applied: true as const,
      agentVersion: updated.version,
      createdShortcutIds,
    }
  })
}

export function shortcutImportErrorStatus(error: unknown): { status: number; code: string } | null {
  const code = error instanceof Error ? error.message : ''
  if (code === 'AGENT_NOT_FOUND') return { status: 404, code }
  if (code === 'paste_empty' || code === 'paste_too_long' || code === 'IMPORT_TOKEN_INVALID') {
    return { status: 400, code }
  }
  if (
    code === 'confirmation_wording' ||
    code === 'empty_import' ||
    code === 'BRAND_FACTS_INVALID' ||
    code === 'shortcut_invalid'
  ) {
    return { status: 422, code }
  }
  if (code === 'IDEMPOTENCY_CONFLICT' || code === 'VERSION_CONFLICT') return { status: 409, code }
  if (code === 'TEST_BUDGET_BLOCKED') return { status: 429, code }
  if (code === 'SCHEMA_NOT_READY') return { status: 503, code }
  if (code === 'XAI_NOT_CONFIGURED' || code === 'SOFT_AI_MODEL_NOT_ALLOWED') {
    return { status: 503, code }
  }
  return null
}

export type { ShortcutImportProposal }
