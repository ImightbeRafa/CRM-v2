/**
 * Audited ai_full unlock. Qualification runs before the flag-row lock.
 * The audit row is written after the config transaction commits (P2028).
 */

import 'server-only'

import { prisma } from '@/lib/db'
import { logAuditEvent } from '@/lib/auditLogger'
import { parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { mutateChatAgentLayerConfig } from '@/lib/soft-ai/agent-layer-config-mutate'
import { assessUnlockCanaryTurn, replayFixtures } from '@/lib/soft-ai/agent-replay'
import { findServingAgentBinding } from '@/lib/soft-ai/agent-resolver'
import { loadDailyTestTokens } from '@/lib/soft-ai/agent-claim-gates'
import { runAgentTestTurn } from '@/lib/soft-ai/agent-turn'
import {
  CHAT_AGENT_LAYER_V1_FLAG,
  type AiFullUnlockRecord,
  type AiFullUnlockRefusalCode,
  type ChatAgentLayerConfig,
} from '@/lib/soft-ai/agent-types'
import {
  canSharePaymentFacts,
  parseBrandFactsSafe,
  parseReplyStyleSafe,
} from '@/lib/soft-ai/brand-facts'
import { listRuntimeShortcuts } from '@/lib/soft-ai/shortcut-repository'
import type { RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import {
  FORGE_WA_V2_FIXTURES,
  type ReplayFixtureV2,
} from '@/lib/soft-ai/__fixtures__/forge-wa-v2'

const CANARY_MESSAGE_TYPES = ['text', 'image', 'audio', 'document', 'video'] as const

const REFUSAL_COPY: Record<AiFullUnlockRefusalCode, string> = {
  ACCOUNT_NOT_TENANT: 'Esa cuenta no pertenece a este espacio.',
  ACCOUNT_NOT_ALLOWLISTED: 'La IA no está permitida en este canal.',
  ACCOUNT_NOT_WHATSAPP: 'El envío real solo se aprueba en WhatsApp.',
  AGENT_NOT_BOUND: 'Este agente no atiende ese canal.',
  AGENT_NOT_LIVE: 'El agente tiene que estar activo para aprobar el envío.',
  REPLAY_FAILED: 'La prueba de este canal no quedó en verde.',
  HASH_MISMATCH: 'La prueba no coincide con la versión vigente.',
  CANARY_FAILED: 'Una prueba de envío no pasó.',
  TEST_BUDGET_BLOCKED: 'Se alcanzó el tope de pruebas de hoy.',
  XAI_NOT_CONFIGURED: 'El modelo de respuestas no está configurado.',
}

export class AgentUnlockRefusal extends Error {
  readonly code: AiFullUnlockRefusalCode

  constructor(code: AiFullUnlockRefusalCode) {
    super(code)
    this.name = 'AgentUnlockRefusal'
    this.code = code
  }
}

export function isAgentUnlockRefusal(error: unknown): error is AgentUnlockRefusal {
  return error instanceof AgentUnlockRefusal
}

export function agentUnlockHttpError(code: AiFullUnlockRefusalCode): {
  status: 400
  body: { success: false; error: string; code: AiFullUnlockRefusalCode }
} {
  return {
    status: 400,
    body: { success: false, error: REFUSAL_COPY[code], code },
  }
}

type UnlockAccount = { id: string; platform: string }

type UnlockAgent = {
  id: string
  name: string
  status: string
  model: string
  version: number
  brandFacts: unknown
  replyStyle: unknown
}

type UnlockServing = {
  agentId: string
  scope: 'social_account' | 'tenant_default'
  status: string
  model: string
  version: number
}

export type UnlockCanaryTurn = {
  text: string
  outcome: 'send' | 'suggest' | 'skip'
  fallbackUsed: boolean
  escalate: boolean
  blockedBy?: string[]
}

export type AgentUnlockDeps = {
  now?: () => Date
  findAccount?: (tenantId: string, socialAccountId: string) => Promise<UnlockAccount | null>
  readConfig?: (tenantId: string) => Promise<ChatAgentLayerConfig>
  findAgent?: (tenantId: string, agentId: string) => Promise<UnlockAgent | null>
  findServing?: (tenantId: string, socialAccountId: string) => Promise<UnlockServing | null>
  listShortcuts?: (tenantId: string, agentId: string) => Promise<RuntimeShortcut[]>
  loadTestTokens?: (tenantId: string) => Promise<number>
  xaiConfigured?: () => boolean
  canaryFixtures?: () => ReplayFixtureV2[]
  replay?: (input: { agent: UnlockAgent; shortcuts: RuntimeShortcut[] }) => ReturnType<typeof replayFixtures>
  runCanaryTurn?: (input: {
    tenantId: string
    agentId: string
    socialAccountId: string
    actorUserId: string
    fixture: ReplayFixtureV2
  }) => Promise<UnlockCanaryTurn>
  mutate?: typeof mutateChatAgentLayerConfig
  audit?: (event: {
    tenantId: string
    agentId: string
    agentName: string
    actorUserId: string
    actorName: string
    actorRole: string
    details: Record<string, unknown>
  }) => Promise<void>
}

export type AgentUnlockSuccess = {
  record: AiFullUnlockRecord
  bindingScope: 'social_account' | 'tenant_default'
  agentName: string
}

function asMessageType(value: string | undefined): (typeof CANARY_MESSAGE_TYPES)[number] {
  if (value && (CANARY_MESSAGE_TYPES as readonly string[]).includes(value)) {
    return value as (typeof CANARY_MESSAGE_TYPES)[number]
  }
  return 'text'
}

function defaultReplay(input: { agent: UnlockAgent; shortcuts: RuntimeShortcut[] }) {
  const facts = parseBrandFactsSafe(input.agent.brandFacts)
  return replayFixtures({
    brandFacts: facts,
    replyStyle: parseReplyStyleSafe(input.agent.replyStyle),
    shortcuts: input.shortcuts,
    sharePaymentFacts: canSharePaymentFacts(facts),
  })
}

async function defaultFindAccount(tenantId: string, socialAccountId: string) {
  const id = socialAccountId.trim()
  if (!id) return null
  return prisma.socialAccount.findFirst({
    where: { id, tenantId },
    select: { id: true, platform: true },
  })
}

async function defaultReadConfig(tenantId: string) {
  const flag = await prisma.tenantFeatureFlag.findFirst({
    where: { tenantId, scope: tenantId, key: CHAT_AGENT_LAYER_V1_FLAG },
    select: { config: true },
  })
  return parseChatAgentLayerConfig(flag?.config)
}

async function defaultFindAgent(tenantId: string, agentId: string) {
  return prisma.chatAgent.findFirst({
    where: { id: agentId, tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      model: true,
      version: true,
      brandFacts: true,
      replyStyle: true,
    },
  })
}

async function defaultFindServing(tenantId: string, socialAccountId: string) {
  const found = await findServingAgentBinding(tenantId, socialAccountId)
  if (!found?.row.agent) return null
  return {
    agentId: found.row.agentId,
    scope: found.usedExact ? ('social_account' as const) : ('tenant_default' as const),
    status: found.row.agent.status,
    model: found.row.agent.model,
    version: found.row.agent.version,
  }
}

async function defaultRunCanaryTurn(input: {
  tenantId: string
  agentId: string
  socialAccountId: string
  actorUserId: string
  fixture: ReplayFixtureV2
}): Promise<UnlockCanaryTurn> {
  const turn = await runAgentTestTurn({
    tenantId: input.tenantId,
    agentId: input.agentId,
    inboundText: input.fixture.text,
    socialAccountId: input.socialAccountId,
    actorUserId: input.actorUserId,
    testSessionId: `unlock:${input.agentId}:${input.socialAccountId}`,
    messageType: asMessageType(input.fixture.messageType),
    history: [],
    windowOpen: true,
    conversationAiMode: 'ai_active',
    ignoreLayerFlag: true,
  })
  return {
    text: turn.text,
    outcome: turn.outcome,
    fallbackUsed: turn.fallbackUsed,
    escalate: turn.escalate,
    blockedBy: turn.blockedBy,
  }
}

async function defaultAudit(event: {
  tenantId: string
  agentId: string
  agentName: string
  actorUserId: string
  actorName: string
  actorRole: string
  details: Record<string, unknown>
}) {
  await logAuditEvent({
    tenantId: event.tenantId,
    action: 'UPDATE',
    entityType: 'ChatAgent',
    entityId: event.agentId,
    entityName: event.agentName,
    newValues: event.details,
    userId: event.actorUserId,
    userName: event.actorName,
    userRole: event.actorRole,
    reason: 'chat_agent_ai_full_unlock',
  })
}

export async function approveAgentAiFullUnlock(
  input: {
    tenantId: string
    agentId: string
    socialAccountId: string
    actorUserId: string
    actorName: string
    actorRole: string
  },
  deps: AgentUnlockDeps = {},
): Promise<AgentUnlockSuccess> {
  const findAccount = deps.findAccount ?? defaultFindAccount
  const readConfig = deps.readConfig ?? defaultReadConfig
  const findAgent = deps.findAgent ?? defaultFindAgent
  const findServing = deps.findServing ?? defaultFindServing
  const listShortcuts = deps.listShortcuts ?? listRuntimeShortcuts
  const loadTestTokens = deps.loadTestTokens ?? loadDailyTestTokens
  const xaiConfigured = deps.xaiConfigured ?? (() => Boolean(process.env.XAI_API_KEY?.trim()))
  const canaryFixtures = deps.canaryFixtures ?? (() => FORGE_WA_V2_FIXTURES.filter((row) => row.canary))
  const replay = deps.replay ?? defaultReplay
  const runCanaryTurn = deps.runCanaryTurn ?? defaultRunCanaryTurn
  const mutate = deps.mutate ?? mutateChatAgentLayerConfig
  const audit = deps.audit ?? defaultAudit
  const now = deps.now ?? (() => new Date())

  const account = await findAccount(input.tenantId, input.socialAccountId)
  if (!account) throw new AgentUnlockRefusal('ACCOUNT_NOT_TENANT')

  const config = await readConfig(input.tenantId)
  if (!config.accountAllowlist.includes(account.id)) {
    throw new AgentUnlockRefusal('ACCOUNT_NOT_ALLOWLISTED')
  }
  if ((account.platform || '').toLowerCase() !== 'whatsapp') {
    throw new AgentUnlockRefusal('ACCOUNT_NOT_WHATSAPP')
  }

  const agent = await findAgent(input.tenantId, input.agentId)
  if (!agent) throw new Error('AGENT_NOT_FOUND')

  const serving = await findServing(input.tenantId, account.id)
  if (!serving || serving.agentId !== agent.id) {
    throw new AgentUnlockRefusal('AGENT_NOT_BOUND')
  }
  if (agent.status !== 'live' || serving.status !== 'live') {
    throw new AgentUnlockRefusal('AGENT_NOT_LIVE')
  }

  const shortcuts = await listShortcuts(input.tenantId, agent.id)
  const report = replay({ agent, shortcuts })
  if (
    report.passRate < 1 ||
    report.policyViolations > 0 ||
    report.capped ||
    report.examined === 0
  ) {
    throw new AgentUnlockRefusal('REPLAY_FAILED')
  }
  if (report.fixtureSetHash !== config.fixtureSetHash) {
    throw new AgentUnlockRefusal('HASH_MISMATCH')
  }

  let canaryCount = 0
  if (config.unlockCanaries) {
    const used = await loadTestTokens(input.tenantId)
    if (used >= config.testDailyTokenCap) {
      throw new AgentUnlockRefusal('TEST_BUDGET_BLOCKED')
    }
    if (!xaiConfigured()) throw new AgentUnlockRefusal('XAI_NOT_CONFIGURED')

    const facts = parseBrandFactsSafe(agent.brandFacts)
    const sharePaymentFacts = canSharePaymentFacts(facts)
    const fixtures = canaryFixtures()
    for (const fixture of fixtures) {
      const turn = await runCanaryTurn({
        tenantId: input.tenantId,
        agentId: agent.id,
        socialAccountId: account.id,
        actorUserId: input.actorUserId,
        fixture,
      })
      const assessed = assessUnlockCanaryTurn({
        fixture,
        sharePaymentFacts,
        outcome: turn.outcome,
        fallbackUsed: turn.fallbackUsed,
        escalate: turn.escalate,
        text: turn.text,
        blockedBy: turn.blockedBy,
      })
      if (!assessed.ok) {
        throw new AgentUnlockRefusal(
          assessed.reason === 'budget' ? 'TEST_BUDGET_BLOCKED' : 'CANARY_FAILED',
        )
      }
    }
    canaryCount = fixtures.length
  }

  const freshAgent = await findAgent(input.tenantId, input.agentId)
  if (!freshAgent) throw new Error('AGENT_NOT_FOUND')
  const freshServing = await findServing(input.tenantId, account.id)
  if (!freshServing || freshServing.agentId !== freshAgent.id) {
    throw new AgentUnlockRefusal('AGENT_NOT_BOUND')
  }
  if (freshAgent.status !== 'live' || freshServing.status !== 'live') {
    throw new AgentUnlockRefusal('AGENT_NOT_LIVE')
  }
  if (
    config.unlockCanaries &&
    (freshAgent.model !== agent.model || freshAgent.version !== agent.version)
  ) {
    throw new AgentUnlockRefusal('CANARY_FAILED')
  }

  const record: AiFullUnlockRecord = {
    passedAt: now().toISOString(),
    approvedBy: input.actorUserId,
    fixtureSetHash: report.fixtureSetHash,
    passRate: report.passRate,
    agentId: freshAgent.id,
    agentVersion: freshAgent.version,
    model: freshAgent.model,
    canaryCount,
  }

  const { after } = await mutate(input.tenantId, (current) => {
    if (!current.accountAllowlist.includes(account.id)) {
      throw new AgentUnlockRefusal('ACCOUNT_NOT_ALLOWLISTED')
    }
    if (current.fixtureSetHash !== report.fixtureSetHash) {
      throw new AgentUnlockRefusal('HASH_MISMATCH')
    }
    return {
      ...current,
      aiFullUnlock: {
        ...current.aiFullUnlock,
        [account.id]: record,
      },
    }
  })

  const stored = after.aiFullUnlock[account.id] ?? record
  await audit({
    tenantId: input.tenantId,
    agentId: freshAgent.id,
    agentName: freshAgent.name,
    actorUserId: input.actorUserId,
    actorName: input.actorName,
    actorRole: input.actorRole,
    details: {
      socialAccountId: account.id,
      agentId: freshAgent.id,
      agentVersion: stored.agentVersion ?? freshAgent.version,
      model: stored.model ?? freshAgent.model,
      bindingScope: freshServing.scope,
      passRate: stored.passRate,
      canaryCount: stored.canaryCount ?? canaryCount,
      fixtureSetHash: stored.fixtureSetHash,
    },
  })

  return {
    record: stored,
    bindingScope: freshServing.scope,
    agentName: freshAgent.name,
  }
}
