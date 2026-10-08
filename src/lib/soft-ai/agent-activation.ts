/**
 * "Activar" (F1, Rafael 2026-10-08): an agent answers a channel directly once ITS OWN generated test suite passed
 * on that channel. One click, audited. Replaces the replay + canary unlock (one fixed fixture set, WhatsApp only).
 *
 * Writes (in the layer-config row lock): channel allowlisted + the unlock record (agentId + model; the suite hash
 * and run id are kept for audit). Then the agent is set live + ai_full. Deactivate removes the unlock record.
 * The send gate only checks agentId + model, so editing the agent's data later never silences it — the UI asks
 * to re-test instead.
 */
import 'server-only'

import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { aiTermsAccepted, parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { mutateChatAgentLayerConfig } from '@/lib/soft-ai/agent-layer-config-mutate'
import { isSoftAiProviderConfigured } from '@/lib/soft-ai/llm/client'
import { buildSuite, latestTestRun } from '@/lib/soft-ai/test-engine/run'
import { agentHasInventoryMap } from '@/lib/soft-ai/agent-inventory-map'
import { CHAT_AGENT_LAYER_V1_FLAG, type AiFullUnlockRecord } from '@/lib/soft-ai/agent-types'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'

export const RUN_MAX_AGE_DAYS = 30

export type ActivationRefusalCode =
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_NOT_SUPPORTED'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_NOT_BOUND'
  | 'AI_NOT_ENABLED'
  | 'AI_TERMS_NOT_ACCEPTED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'TESTS_NOT_RUN'
  | 'TESTS_NOT_PASSED'
  | 'TESTS_OUTDATED'
  | 'INVENTORY_MAP_REQUIRED'
  | 'CHANNEL_OWNED_BY_OTHER_AGENT'

export const ACTIVATION_REFUSAL_COPY: Record<ActivationRefusalCode, string> = {
  CHANNEL_NOT_FOUND: 'Ese canal no es de este negocio.',
  CHANNEL_NOT_SUPPORTED: 'Por ahora el agente responde en WhatsApp e Instagram.',
  AGENT_NOT_FOUND: 'Agente no encontrado.',
  AGENT_NOT_BOUND: 'Este agente no atiende ese canal. Asignalo en Líneas primero.',
  AI_NOT_ENABLED: 'La IA todavía no está habilitada para este negocio. Pedile al administrador de Betsy que la active.',
  AI_TERMS_NOT_ACCEPTED: 'Primero aceptá el uso de IA en nombre de tu negocio (arriba, en Agentes).',
  PROVIDER_NOT_CONFIGURED: 'El modelo de respuestas no está configurado.',
  TESTS_NOT_RUN: 'Primero corré las pruebas de este agente en este canal.',
  TESTS_NOT_PASSED: 'Las pruebas no quedaron en verde. Revisá lo que falló, ajustá y volvé a probar.',
  TESTS_OUTDATED: 'Cambiaste el agente (datos, productos o modelo) después de la prueba, o tiene más de 30 días. Volvé a probar.',
  INVENTORY_MAP_REQUIRED: 'Agregá los productos que vende este canal antes de activarlo.',
  CHANNEL_OWNED_BY_OTHER_AGENT: 'Este canal está activado para otro agente. Desactivalo desde ese agente.',
}

export class ActivationRefusal extends Error {
  constructor(readonly code: ActivationRefusalCode) {
    super(code)
    this.name = 'ActivationRefusal'
  }
}

async function flagsEnabled(tenantId: string): Promise<boolean> {
  const rows = await prisma.tenantFeatureFlag.findMany({
    where: { tenantId, scope: tenantId, key: { in: [SOFT_TENANT_AI_V1_FLAG, CHAT_AGENT_LAYER_V1_FLAG] } },
    select: { key: true, enabled: true },
  })
  const on = new Set(rows.filter((r) => r.enabled).map((r) => r.key))
  return on.has(SOFT_TENANT_AI_V1_FLAG) && on.has(CHAT_AGENT_LAYER_V1_FLAG)
}

export async function activateAgentChannel(input: {
  tenantId: string
  agentId: string
  socialAccountId: string
  actorUserId: string
  actorName: string
  actorRole: string
}): Promise<{ record: AiFullUnlockRecord; agentName: string }> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: input.socialAccountId, tenantId: input.tenantId },
    select: { id: true, platform: true },
  })
  if (!account) throw new ActivationRefusal('CHANNEL_NOT_FOUND')
  const platform = (account.platform || '').toLowerCase()
  if (platform !== 'whatsapp' && platform !== 'instagram') throw new ActivationRefusal('CHANNEL_NOT_SUPPORTED')

  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
    select: { id: true, name: true, model: true, version: true, systemInstructions: true, brandFacts: true, enabledTools: true },
  })
  if (!agent) throw new ActivationRefusal('AGENT_NOT_FOUND')
  const binding = await prisma.chatAgentBinding.findFirst({
    where: { tenantId: input.tenantId, scope: 'social_account', socialAccountId: account.id, isActive: true },
    select: { agentId: true },
  })
  if (!binding || binding.agentId !== agent.id) throw new ActivationRefusal('AGENT_NOT_BOUND')

  if (!(await flagsEnabled(input.tenantId))) throw new ActivationRefusal('AI_NOT_ENABLED')
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: { tenantId: input.tenantId, scope: input.tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
    select: { config: true },
  })
  if (!aiTermsAccepted(parseChatAgentLayerConfig(flag?.config))) throw new ActivationRefusal('AI_TERMS_NOT_ACCEPTED')
  if (!isSoftAiProviderConfigured(agent.model)) throw new ActivationRefusal('PROVIDER_NOT_CONFIGURED')

  const run = await latestTestRun(input.tenantId, agent.id, account.id)
  if (!run || run.status === 'queued' || run.status === 'running') throw new ActivationRefusal('TESTS_NOT_RUN')
  if (run.status !== 'passed') throw new ActivationRefusal('TESTS_NOT_PASSED')
  const ageMs = Date.now() - new Date(run.finishedAt || run.createdAt).getTime()
  if (run.model !== agent.model || ageMs > RUN_MAX_AGE_DAYS * 86_400_000) throw new ActivationRefusal('TESTS_OUTDATED')
  // The green run must be of TODAY's agent: same version AND the same suite its current data builds (prices,
  // products, payment number and instructions included — some of those change without a version bump).
  if (run.agentVersion !== agent.version) throw new ActivationRefusal('TESTS_OUTDATED')
  const current = await buildSuite(input.tenantId, agent)
  if (current.suiteHash !== run.suiteHash) throw new ActivationRefusal('TESTS_OUTDATED')
  if (agent.enabledTools.includes('search_inventory') && (await agentHasInventoryMap(input.tenantId, agent.id)) !== true) {
    throw new ActivationRefusal('INVENTORY_MAP_REQUIRED')
  }

  const record: AiFullUnlockRecord = {
    passedAt: new Date().toISOString(),
    approvedBy: input.actorUserId,
    fixtureSetHash: run.suiteHash,
    passRate: run.summary && run.summary.total > 0 ? (run.summary.rulePassed + run.summary.judgedPassed) / run.summary.total : 1,
    agentId: agent.id,
    agentVersion: agent.version,
    model: agent.model,
    canaryCount: 0,
  }
  await mutateChatAgentLayerConfig(input.tenantId, (current) => ({
    ...current,
    accountAllowlist: current.accountAllowlist.includes(account.id)
      ? current.accountAllowlist
      : [...current.accountAllowlist, account.id],
    aiFullUnlock: { ...current.aiFullUnlock, [account.id]: record },
  }))
  await prisma.chatAgent.updateMany({
    where: { id: agent.id, tenantId: input.tenantId },
    data: { status: 'live', operationMode: 'ai_full', updatedBy: input.actorUserId },
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgent',
    entityId: agent.id,
    entityName: agent.name,
    description: `Agente activado en el canal (responde directo)`,
    newValues: { socialAccountId: account.id, platform, model: agent.model, testRunId: run.id, suiteHash: run.suiteHash, summary: run.summary },
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_agent_activate',
  }).catch(() => {})
  return { record, agentName: agent.name }
}

export async function deactivateAgentChannel(input: {
  tenantId: string
  agentId: string
  socialAccountId: string
  actorUserId: string
  actorName: string
  actorRole: string
}): Promise<void> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: input.socialAccountId, tenantId: input.tenantId },
    select: { id: true },
  })
  if (!account) throw new ActivationRefusal('CHANNEL_NOT_FOUND')
  await mutateChatAgentLayerConfig(input.tenantId, (current) => {
    const record = current.aiFullUnlock[account.id]
    // Only this agent's activation is removed (never another agent's on the same channel) — and say so.
    if (record?.agentId && record.agentId !== input.agentId) throw new ActivationRefusal('CHANNEL_OWNED_BY_OTHER_AGENT')
    const aiFullUnlock = { ...current.aiFullUnlock }
    delete aiFullUnlock[account.id]
    return {
      ...current,
      aiFullUnlock,
      // Off the allowlist too: a deactivated channel never reaches the AI provider.
      accountAllowlist: current.accountAllowlist.filter((id) => id !== account.id),
    }
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgent',
    entityId: input.agentId,
    description: 'Agente desactivado en el canal',
    newValues: { socialAccountId: account.id },
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_agent_deactivate',
  }).catch(() => {})
}
