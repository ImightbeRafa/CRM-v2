/**
 * Agentes IA 2.0 (A) — server loader for the line truth (agent-status.ts is the pure, client-safe half).
 * Reads every real switch the send path checks, in a handful of queries for any number of lines (once per line per
 * request): both tenant flags, AI terms, kill switch / platform pause, schema, line connection, serving binding +
 * agent (live, Responder, model allowed, provider key, products), allowlist, activation of THIS agent + model
 * (aiFullUnlockStatus), tenant + per-agent daily budget, the latest test run of that agent on the line, and what
 * really happened to the line's latest AI turn in the last hour. Read-only.
 */
import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { SOFT_TENANT_AI_V1_FLAG } from '@/lib/feature-flags'
import { aiFullUnlockStatus, aiTermsAccepted, parseChatAgentLayerConfig } from '@/lib/soft-ai/agent-config'
import { CHAT_AGENT_LAYER_V1_FLAG, isAllowedChatAgentModel } from '@/lib/soft-ai/agent-types'
import { readAgentKillState } from '@/lib/soft-ai/agent-kill-switch'
import { agentsServingUnboundChannels } from '@/lib/soft-ai/agent-settings'
import { isSoftAiProviderConfigured } from '@/lib/soft-ai/llm/client'
import { isChatAgentSchemaReady, isMissingRelationError } from '@/lib/soft-ai/agent-schema'
import { isTableReady } from '@/lib/soft-ai/table-ready'
import { agentHasInventoryMap } from '@/lib/soft-ai/agent-inventory-map'
import { isQuickRunCases, parseRunActivation } from '@/lib/soft-ai/test-engine/run'
import { isSoftAiOutboundMetadata } from '@/lib/soft-ai/agent-inbox-projection'
import { resolveAiAllowance } from '@/lib/soft-ai/ai-allowance'
import { isUnexpectedTurnOutcome, lineAiStatus, type LineAiStatus, type LineRunInput } from '@/lib/soft-ai/agent-status'

type ServingAgent = {
  agentId: string
  agentName: string
  status: string
  operationMode: string
  model: string
  version: number
  enabledTools: string[]
}

export type LoadedLineRun = {
  id: string
  status: LineRunInput['status']
  done: number
  total: number
  quick: boolean
  finishedAt: string | null
  cases: Array<{ id: string; title: string; group: string }>
  results: Array<{ id: string; title: string; pass: boolean; reply: string; notes: string[]; error?: string | null; why?: string | null; retried?: boolean }>
}

export type LoadedLine = {
  status: LineAiStatus
  /** The agent evaluated for this line (viewing agent, or the serving one), if any. */
  agentId: string | null
  /** Latest run of that agent on this line (for "Probando… n de 6" and "Ver respuesta"). */
  run: LoadedLineRun | null
}

const OFF: LineAiStatus = { state: 'off', code: 'OFF', label: 'Sin IA', hint: 'Encendé la línea para que la IA responda.' }

async function latestRuns(tenantId: string, accountIds: string[]): Promise<Array<Record<string, unknown>>> {
  if (!accountIds.length || !(await isTableReady('ChatAgentTestRun'))) return []
  try {
    // Latest run per (line, agent); the loader then picks the evaluated agent's.
    return await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT DISTINCT ON ("socialAccountId", "agentId")
             "id", "agentId", "socialAccountId", "status", "cases", "results", "cursor", "summary", "finishedAt"
        FROM "ChatAgentTestRun"
       WHERE "tenantId" = ${tenantId} AND "socialAccountId" IN (${Prisma.join(accountIds)})
       ORDER BY "socialAccountId", "agentId", "createdAt" DESC`
  } catch (error) {
    if (isMissingRelationError(error)) return []
    throw error
  }
}

function toRun(r: Record<string, unknown> | undefined): LoadedLineRun | null {
  if (!r) return null
  const cases = Array.isArray(r.cases) ? (r.cases as Array<{ id: string; title: string; group: string }>) : []
  const results = Array.isArray(r.results) ? (r.results as LoadedLineRun['results']) : []
  return {
    id: String(r.id),
    status: String(r.status) as LineRunInput['status'],
    done: Number(r.cursor || 0),
    total: cases.length,
    quick: isQuickRunCases(r.cases),
    finishedAt: r.finishedAt ? new Date(r.finishedAt as Date).toISOString() : null,
    cases: cases.map((c) => ({ id: c.id, title: c.title, group: c.group })),
    results: results.map((x) => ({
      id: x.id,
      title: x.title,
      pass: x.pass,
      reply: x.reply,
      notes: x.notes || [],
      error: x.error ?? null,
      why: typeof x.why === 'string' ? x.why.slice(0, 300) : null,
      retried: x.retried === true,
    })),
  }
}

/** Latest real (non-test) AI turn per line since `since`, only when it did not answer for an unexpected reason. */
async function lastTurnProblems(
  tenantId: string,
  accountIds: string[],
  since: Date,
): Promise<Map<string, { status: string; reason: string | null; at: Date }>> {
  const out = new Map<string, { status: string; reason: string | null; at: Date }>()
  if (!accountIds.length) return out
  try {
    const rows = await prisma.chatAgentTurn.findMany({
      where: { tenantId, socialAccountId: { in: accountIds }, createdAt: { gte: since }, mode: { not: 'test' } },
      select: { socialAccountId: true, status: true, skipReason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const seen = new Set<string>()
    for (const r of rows) {
      if (seen.has(r.socialAccountId)) continue
      seen.add(r.socialAccountId)
      if (isUnexpectedTurnOutcome({ status: r.status, skipReason: r.skipReason })) {
        out.set(r.socialAccountId, { status: r.status, reason: r.skipReason, at: r.createdAt })
      }
    }
  } catch (error) {
    if (!isMissingRelationError(error)) throw error
  }
  return out
}

/**
 * Line truth for many lines at once (inbox list, agent page). `viewingAgentId` = the agent page's agent: a line
 * another agent serves reads "La atiende …" and the evaluated run is the viewing agent's.
 */
export async function loadLinesAiStatus(
  tenantId: string,
  socialAccountIds: string[],
  opts?: { viewingAgentId?: string | null },
): Promise<Map<string, LoadedLine>> {
  const ids = [...new Set(socialAccountIds.filter(Boolean))].slice(0, 200)
  const out = new Map<string, LoadedLine>()
  if (!ids.length) return out
  for (const id of ids) out.set(id, { status: OFF, agentId: null, run: null })

  const schemaReady = await isChatAgentSchemaReady()
  const [accounts, flags, kill] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, platform: true, tokenStatus: true, isActive: true, disconnectedAt: true },
    }),
    prisma.tenantFeatureFlag.findMany({
      where: { tenantId, scope: tenantId, key: { in: [SOFT_TENANT_AI_V1_FLAG, CHAT_AGENT_LAYER_V1_FLAG] } },
      select: { key: true, enabled: true, config: true },
    }),
    readAgentKillState(tenantId),
  ])
  const softFlag = flags.find((f) => f.key === SOFT_TENANT_AI_V1_FLAG)
  const layerFlag = flags.find((f) => f.key === CHAT_AGENT_LAYER_V1_FLAG)
  const config = parseChatAgentLayerConfig(layerFlag?.config)

  const [bindings, runRows] = schemaReady
    ? await Promise.all([
        prisma.chatAgentBinding.findMany({
          where: {
            tenantId,
            isActive: true,
            OR: [{ scope: 'social_account', socialAccountId: { in: ids } }, { scope: 'tenant_default' }],
          },
          select: {
            scope: true,
            socialAccountId: true,
            agent: { select: { id: true, name: true, status: true, operationMode: true, model: true, version: true, enabledTools: true } },
          },
        }),
        latestRuns(tenantId, ids),
      ])
    : [[], []]

  const exact = new Map<string, ServingAgent>()
  let tenantDefault: ServingAgent | null = null
  for (const b of bindings) {
    if (!b.agent) continue
    const agent: ServingAgent = {
      agentId: b.agent.id,
      agentName: b.agent.name,
      status: b.agent.status,
      operationMode: b.agent.operationMode,
      model: b.agent.model,
      version: b.agent.version,
      enabledTools: b.agent.enabledTools || [],
    }
    if (b.scope === 'tenant_default') tenantDefault = agent
    else if (b.socialAccountId) exact.set(b.socialAccountId, agent)
  }
  // Same rule as the resolver: a default agent covers a line without its own only when allowed (SQL 049).
  const defaultServes = tenantDefault ? (await agentsServingUnboundChannels(tenantId)).has(tenantDefault.agentId) : false
  const serving = new Map<string, ServingAgent>()
  for (const id of ids) {
    const a = exact.get(id) || (defaultServes ? tenantDefault : null)
    if (a) serving.set(id, a)
  }

  // Live replies are not token-capped. The line stays on so chats do not flip to "Sin IA" after a busy day.
  const agents = new Map<string, ServingAgent>()
  for (const a of serving.values()) agents.set(a.agentId, a)
  const agentInfo = new Map<string, { inventoryMissing: boolean }>()
  await Promise.all(
    [...agents.values()].map(async (a) => {
      const inventoryMissing = a.enabledTools.includes('search_inventory') && (await agentHasInventoryMap(tenantId, a.agentId)) !== true
      agentInfo.set(a.agentId, { inventoryMissing })
    }),
  )

  // Real outcomes: the latest AI turn of the last hour, but never one from before the line was (re)activated.
  const turnProblems = await lastTurnProblems(tenantId, ids, new Date(Date.now() - 3_600_000))
  // The business's AI allowance (one read per call; never throws, fails open).
  const allowanceExhausted = (await resolveAiAllowance(tenantId)).exhausted

  const viewing = opts?.viewingAgentId || null
  for (const account of accounts) {
    const binding = serving.get(account.id) || null
    const evaluatedAgentId = viewing || binding?.agentId || null
    const unlock = binding
      ? aiFullUnlockStatus(config, account.id, { agentId: binding.agentId, model: binding.model, agentVersion: binding.version })
      : aiFullUnlockStatus(config, account.id)
    const runRow = evaluatedAgentId ? runRows.find((r) => String(r.socialAccountId) === account.id && String(r.agentId) === evaluatedAgentId) : undefined
    const run = toRun(runRow)
    const info = binding ? agentInfo.get(binding.agentId) : undefined
    const passedAt = unlock.record?.passedAt ? new Date(unlock.record.passedAt) : null
    const turn = turnProblems.get(account.id)
    const turnCounts = turn && (!passedAt || Number.isNaN(passedAt.getTime()) || turn.at > passedAt)
    const status = lineAiStatus({
      platform: account.platform,
      account: { isActive: account.isActive, disconnected: Boolean(account.disconnectedAt), tokenStatus: account.tokenStatus },
      schemaReady,
      flags: { softAi: Boolean(softFlag?.enabled), agentLayer: Boolean(layerFlag?.enabled) },
      aiTermsAccepted: aiTermsAccepted(config),
      kill,
      binding: binding
        ? {
            agentId: binding.agentId,
            agentName: binding.agentName,
            status: binding.status,
            operationMode: binding.operationMode,
            modelAllowed: isAllowedChatAgentModel(binding.model),
            providerConfigured: isSoftAiProviderConfigured(binding.model),
            inventoryMapMissing: Boolean(info?.inventoryMissing),
          }
        : null,
      viewingAgentId: viewing,
      allowlisted: config.accountAllowlist.includes(account.id),
      unlock: { unlocked: unlock.unlocked, reason: unlock.reason, versionWarning: unlock.versionWarning, agentId: unlock.record?.agentId ?? null },
      budget: { tenantExhausted: allowanceExhausted, agentExhausted: false },
      run: run
        ? {
            status: run.status,
            done: run.done,
            total: run.total,
            quick: run.quick,
            activation: parseRunActivation((runRow?.summary as { activation?: unknown } | null)?.activation),
            failedTitles: run.results.filter((r) => !r.pass).map((r) => r.title),
          }
        : null,
      lastTurnProblem: turnCounts && turn ? { status: turn.status, reason: turn.reason } : null,
    })
    out.set(account.id, { status, agentId: evaluatedAgentId, run })
  }
  return out
}

export async function loadLineAiStatus(
  tenantId: string,
  socialAccountId: string,
  opts?: { viewingAgentId?: string | null },
): Promise<LineAiStatus> {
  const map = await loadLinesAiStatus(tenantId, [socialAccountId], opts)
  return map.get(socialAccountId)?.status ?? OFF
}

/** Conversations (of these) where a person wrote in the last `hours`: outbound that is not an AI send. One query. */
export async function conversationsWithRecentHuman(tenantId: string, conversationIds: string[], hours = 24): Promise<Set<string>> {
  const out = new Set<string>()
  const ids = conversationIds.filter(Boolean).slice(0, 200)
  if (!ids.length) return out
  try {
    const rows = await prisma.chatMessage.findMany({
      where: {
        tenantId,
        conversationId: { in: ids },
        direction: 'outbound',
        sentAt: { gte: new Date(Date.now() - hours * 3_600_000) },
      },
      select: { conversationId: true, metadata: true },
      orderBy: { sentAt: 'desc' },
      take: 1000,
    })
    for (const r of rows) if (r.conversationId && !isSoftAiOutboundMetadata(r.metadata)) out.add(r.conversationId)
  } catch {
    // Display only. On error every NULL-mode chat reads as the person's (fail toward the person).
    for (const id of ids) out.add(id)
  }
  return out
}
