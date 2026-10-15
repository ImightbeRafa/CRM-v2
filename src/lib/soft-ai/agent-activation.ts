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
import {
  buildSuite,
  cancelLineTestRuns,
  latestTestRun,
  recordRunActivation,
  startAgentTestRun,
  type TestRunRow,
} from '@/lib/soft-ai/test-engine/run'
import { selectQuickSuite } from '@/lib/soft-ai/test-engine/generate'
import { agentHasInventoryMap } from '@/lib/soft-ai/agent-inventory-map'
import { CHAT_AGENT_LAYER_V1_FLAG, isAllowedChatAgentModel, type AiFullUnlockRecord } from '@/lib/soft-ai/agent-types'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'
import { aiFullUnlockStatus } from '@/lib/soft-ai/agent-config'
import { isPlatformAiPaused, readAgentKillState } from '@/lib/soft-ai/agent-kill-switch'
import { setAgentBinding } from '@/lib/soft-ai/agent-admin'
import { sweepWaitingChats } from '@/lib/soft-ai/waiting-sweep'

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
  | 'AI_PAUSED'
  | 'MODEL_NOT_ALLOWED'
  | 'CHECK_ALREADY_RUNNING'

export const ACTIVATION_REFUSAL_COPY: Record<ActivationRefusalCode, string> = {
  CHANNEL_NOT_FOUND: 'Ese canal no es de este negocio.',
  CHANNEL_NOT_SUPPORTED: 'Por ahora el agente responde en WhatsApp e Instagram.',
  AGENT_NOT_FOUND: 'Agente no encontrado.',
  AGENT_NOT_BOUND: 'Este agente no atiende ese canal. Asignalo en Líneas primero.',
  AI_NOT_ENABLED: 'La IA no está habilitada para este negocio. Pedile al administrador de Betsy.',
  AI_TERMS_NOT_ACCEPTED: 'Primero aceptá el uso de IA en nombre de tu negocio (arriba, en Agentes).',
  PROVIDER_NOT_CONFIGURED: 'El modelo de respuestas no está configurado.',
  TESTS_NOT_RUN: 'Primero corré las pruebas de este agente en este canal.',
  TESTS_NOT_PASSED: 'Las pruebas no quedaron en verde. Revisá lo que falló, ajustá y volvé a probar.',
  TESTS_OUTDATED: 'Cambiaste el agente (datos, productos o modelo) después de la prueba, o tiene más de 30 días. Volvé a probar.',
  INVENTORY_MAP_REQUIRED: 'Agregá los productos que vende este canal antes de activarlo.',
  CHANNEL_OWNED_BY_OTHER_AGENT: 'Esta línea la atiende otro agente: apagala ahí primero.',
  AI_PAUSED: 'La IA está pausada en Betsy en este momento. Los chats quedan para tu equipo.',
  MODEL_NOT_ALLOWED: 'El modelo de este agente no está disponible. Elegí otro en Avanzado.',
  CHECK_ALREADY_RUNNING: 'Ya hay una prueba completa corriendo en esta línea. Esperá a que termine y volvé a encender.',
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
  const full = await buildSuite(input.tenantId, agent)
  // The one switch's 6-case check (selectQuickSuite of the same data) counts like the full suite.
  const current = run.suiteHash === full.suiteHash ? full : selectQuickSuite(full)
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

// ── Agentes IA 2.0 (A): one switch per line ────────────────────────────────────────────────────────────────────

export type PowerActor = { actorUserId: string; actorName: string; actorRole: string }

/** Pure: may a finished run be reused by the switch (same agent version + model + today's suite, < 30 days)? */
export function isReusableGreenRun(
  run: { status: string; agentVersion: number; model: string; suiteHash: string; finishedAt: Date | null; createdAt: Date } | null,
  agent: { version: number; model: string },
  hashes: { full: string; quick: string },
  nowMs = Date.now(),
): boolean {
  if (!run || run.status !== 'passed') return false
  if (run.agentVersion !== agent.version || run.model !== agent.model) return false
  if (run.suiteHash !== hashes.full && run.suiteHash !== hashes.quick) return false
  return nowMs - new Date(run.finishedAt || run.createdAt).getTime() <= RUN_MAX_AGE_DAYS * 86_400_000
}

function actorOf(a: PowerActor): PowerActor {
  return { actorUserId: a.actorUserId, actorName: a.actorName, actorRole: a.actorRole }
}

/** After the line turned on: answer the chats left waiting on it (builder C's sweep; never throws). */
async function afterActivated(tenantId: string, socialAccountId: string): Promise<void> {
  try {
    await sweepWaitingChats(tenantId, socialAccountId)
  } catch (error) {
    console.error('[soft-ai/power-on] sweep', error instanceof Error ? error.name : 'unknown')
  }
}

/**
 * Turn the line ON for this agent (one click). Never writes tenant flags (Rafael: Betsy's admin enables AI for a
 * business). Refuses with a code + plain copy; otherwise:
 *  - binds the line to this agent when nobody serves it or the serving agent has it off (never takes a line that
 *    another agent has ON: CHANNEL_OWNED_BY_OTHER_AGENT);
 *  - a still-valid green run (quick or full, same version + model + today's suite, < 30 days) activates now;
 *  - else starts the quick 6-case check: the quick run IS the intent (finish() activates it when it passes).
 * After a successful activation the waiting chats of the line are swept (sweepWaitingChats).
 */
export async function powerOnLine(
  input: { tenantId: string; agentId: string; socialAccountId: string; takeOver?: boolean } & PowerActor,
): Promise<{ state: 'on' } | { state: 'checking'; runId: string; total: number }> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: input.socialAccountId, tenantId: input.tenantId },
    select: { id: true, platform: true },
  })
  if (!account) throw new ActivationRefusal('CHANNEL_NOT_FOUND')
  const platform = (account.platform || '').toLowerCase()
  if (platform !== 'whatsapp' && platform !== 'instagram') throw new ActivationRefusal('CHANNEL_NOT_SUPPORTED')
  const agent = await prisma.chatAgent.findFirst({
    where: { id: input.agentId, tenantId: input.tenantId },
    select: {
      id: true,
      name: true,
      model: true,
      version: true,
      status: true,
      operationMode: true,
      systemInstructions: true,
      brandFacts: true,
      enabledTools: true,
    },
  })
  if (!agent) throw new ActivationRefusal('AGENT_NOT_FOUND')

  if (!(await flagsEnabled(input.tenantId))) throw new ActivationRefusal('AI_NOT_ENABLED')
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: { tenantId: input.tenantId, scope: input.tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
    select: { config: true },
  })
  const config = parseChatAgentLayerConfig(flag?.config)
  if (!aiTermsAccepted(config)) throw new ActivationRefusal('AI_TERMS_NOT_ACCEPTED')
  if ((await isPlatformAiPaused()) || (await readAgentKillState(input.tenantId)).armed) throw new ActivationRefusal('AI_PAUSED')
  if (!isAllowedChatAgentModel(agent.model)) throw new ActivationRefusal('MODEL_NOT_ALLOWED')
  if (!isSoftAiProviderConfigured(agent.model)) throw new ActivationRefusal('PROVIDER_NOT_CONFIGURED')
  if (agent.enabledTools.includes('search_inventory') && (await agentHasInventoryMap(input.tenantId, agent.id)) !== true) {
    throw new ActivationRefusal('INVENTORY_MAP_REQUIRED')
  }

  // Another agent has this line ON (its activation record): refuse, never rebind silently.
  const record = config.aiFullUnlock[account.id]
  if (record?.agentId && record.agentId !== agent.id && config.accountAllowlist.includes(account.id)) {
    throw new ActivationRefusal('CHANNEL_OWNED_BY_OTHER_AGENT')
  }
  const binding = await prisma.chatAgentBinding.findFirst({
    where: { tenantId: input.tenantId, scope: 'social_account', socialAccountId: account.id, isActive: true },
    select: { agentId: true },
  })
  // Already on for this agent: nothing to do.
  const already = aiFullUnlockStatus(config, account.id, { agentId: agent.id, model: agent.model, agentVersion: agent.version })
  if (
    already.unlocked &&
    config.accountAllowlist.includes(account.id) &&
    binding?.agentId === agent.id &&
    agent.status === 'live' &&
    agent.operationMode === 'ai_full'
  ) {
    return { state: 'on' }
  }

  // Served by another agent (line off there): only an explicit "Pasar a este agente" (takeOver) moves it.
  if (binding && binding.agentId !== agent.id && !input.takeOver) throw new ActivationRefusal('CHANNEL_OWNED_BY_OTHER_AGENT')
  // The line follows this agent (explicit owner action; setAgentBinding audits it).
  if (binding?.agentId !== agent.id) {
    await setAgentBinding({
      tenantId: input.tenantId,
      agentId: agent.id,
      socialAccountId: account.id,
      active: true,
      ...actorOf(input),
    })
  }

  const full = await buildSuite(input.tenantId, agent)
  const quick = selectQuickSuite(full)
  const latest = await latestTestRun(input.tenantId, agent.id, account.id)
  if (isReusableGreenRun(latest, agent, { full: full.suiteHash, quick: quick.suiteHash })) {
    await activateAgentChannel({ tenantId: input.tenantId, agentId: agent.id, socialAccountId: account.id, ...actorOf(input) })
    await afterActivated(input.tenantId, account.id)
    return { state: 'on' }
  }
  if (latest && (latest.status === 'queued' || latest.status === 'running') && !latest.quick) {
    throw new ActivationRefusal('CHECK_ALREADY_RUNNING')
  }
  const run = await startAgentTestRun({
    tenantId: input.tenantId,
    agentId: agent.id,
    socialAccountId: account.id,
    userId: input.actorUserId,
    quick: true,
  })
  await logAuditEvent({
    tenantId: input.tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgent',
    entityId: agent.id,
    entityName: agent.name,
    description: 'Encender línea: prueba automática iniciada (se enciende sola si pasa)',
    newValues: { socialAccountId: account.id, testRunId: run.id, cases: run.cases.length },
    userId: input.actorUserId,
    userName: input.actorName,
    userRole: input.actorRole,
    reason: 'chat_agent_line_power_on',
  }).catch(() => {})
  return { state: 'checking', runId: run.id, total: run.cases.length }
}

/**
 * finish() of a green QUICK run: turn the line on, only if this run is still the latest of the agent on that line
 * (a newer run or a switch-off wins). The actor is the run's creator. A refusal is stored on the run
 * (summary.activation) and shown by the line status as a problem.
 */
export async function activateAfterQuickRun(run: TestRunRow): Promise<void> {
  const latest = await latestTestRun(run.tenantId, run.agentId, run.socialAccountId)
  if (!latest || latest.id !== run.id) return
  if (await runVoidedByOff(run.tenantId, run.id).catch(() => true)) return
  const user = await prisma.user.findFirst({ where: { id: run.createdBy }, select: { name: true, email: true } }).catch(() => null)
  try {
    await activateAgentChannel({
      tenantId: run.tenantId,
      agentId: run.agentId,
      socialAccountId: run.socialAccountId,
      actorUserId: run.createdBy,
      actorName: user?.name?.trim() || user?.email?.trim() || run.createdBy,
      actorRole: 'line_switch',
    })
  } catch (error) {
    const code = error instanceof ActivationRefusal ? error.code : 'ERROR'
    await recordRunActivation(run.tenantId, run.id, { ok: false, code }).catch(() => {})
    return
  }
  // OFF pressed while we were activating: undo, never sweep (SecureDog INT-95).
  if (await runVoidedByOff(run.tenantId, run.id).catch(() => true)) {
    await deactivateAgentChannel({
      tenantId: run.tenantId,
      agentId: run.agentId,
      socialAccountId: run.socialAccountId,
      actorUserId: run.createdBy,
      actorName: user?.name?.trim() || user?.email?.trim() || run.createdBy,
      actorRole: 'line_switch',
    }).catch(() => {})
    return
  }
  await recordRunActivation(run.tenantId, run.id, { ok: true }).catch(() => {})
  await afterActivated(run.tenantId, run.socialAccountId)
}

/**
 * Turn the line OFF for this agent: cancel its pending checks, remove the activation and the allowlist entry
 * (deactivateAgentChannel; refuses when another agent owns it). The binding stays; chats there read "Sin IA".
 */
export async function powerOffLine(input: { tenantId: string; agentId: string; socialAccountId: string } & PowerActor): Promise<void> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: input.socialAccountId, tenantId: input.tenantId },
    select: { id: true },
  })
  if (!account) throw new ActivationRefusal('CHANNEL_NOT_FOUND')
  // SecureDog INT-95: a check that already passed may be activating right now — mark it void first so it undoes
  // itself (activateAfterQuickRun re-checks this mark after its own write).
  const latest = await latestTestRun(input.tenantId, input.agentId, account.id).catch(() => null)
  if (latest) await recordRunActivation(input.tenantId, latest.id, { ok: false, code: 'OFF' }).catch(() => {})
  await cancelLineTestRuns(input.tenantId, input.agentId, account.id)
  await deactivateAgentChannel({ tenantId: input.tenantId, agentId: input.agentId, socialAccountId: account.id, ...actorOf(input) })
}

/** True when the owner switched the line off after this run started (powerOffLine stamps code 'OFF'). */
async function runVoidedByOff(tenantId: string, runId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ code: string | null }>>`
    SELECT "summary"->'activation'->>'code' AS "code" FROM "ChatAgentTestRun" WHERE "id" = ${runId} AND "tenantId" = ${tenantId} LIMIT 1`
  return rows[0]?.code === 'OFF'
}
