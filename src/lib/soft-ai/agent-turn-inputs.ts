/**
 * Shared runtime-input assembly for live turns and Probar.
 * Live tool semantics: force `search_approved_knowledge` only.
 */

import { prisma } from '@/lib/db'
import { softAiCanalContextLine } from '@/lib/soft-ai/channel-context'
import type { SoftAiLlmRuntimeInput } from '@/lib/soft-ai/llm/runtime'
import type { SoftAiToolRunContext } from '@/lib/soft-ai/llm/tool-runner'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'
import { selectHistoryWindow } from '@/lib/soft-ai/llm/prompt'
import {
  DEFAULT_PRICING_VERSION,
  isAgentToolName,
  type AgentToolName,
  type ChatAgentOperationMode,
  type ChatAgentStatus,
  type ChatAgentTonePreset,
} from '@/lib/soft-ai/agent-types'
import type { ResolvedChatAgent } from '@/lib/soft-ai/agent-resolver'
import type { ApprovedKnowledgeSlice } from '@/lib/soft-ai/knowledge-types'
import type { InboundDecision } from '@/lib/soft-ai/inbound-decision'
import type { RuntimeShortcut } from '@/lib/soft-ai/shortcuts'
import { guideShortcutCatalog } from '@/lib/soft-ai/shortcuts'
import {
  formatBrandFactsForPrompt,
  parseBrandFactsSafe,
  parseReplyStyleSafe,
  replyStyleSnippet,
} from '@/lib/soft-ai/brand-facts'

export type RuntimeCanalAccount = {
  found: boolean
  id: string
  platform: string
  accountId: string
  displayName: string | null
}

export type ChatAgentRuntimeRow = {
  id: string
  tenantId: string
  name: string
  emoji: string
  description: string | null
  systemInstructions: string
  tonePreset: string
  model: string
  operationMode: string
  enabledTools: string[]
  introductionNames?: string[] | null
  brandFacts?: unknown
  replyStyle?: unknown
  status: string
  version: number
}

/**
 * Preserve configured order, drop duplicates and unknown names,
 * and force-add `search_approved_knowledge` only.
 */
export function effectiveEnabledTools(enabledTools: readonly string[]): AgentToolName[] {
  const out: AgentToolName[] = []
  const seen = new Set<string>()
  for (const name of enabledTools) {
    if (!isAgentToolName(name) || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  if (!seen.has('search_approved_knowledge')) {
    out.push('search_approved_knowledge')
  }
  return out
}

/** Prisma filter so the trigger inbound is not also loaded into history (G18). */
export function chatHistoryWhere(
  conversationId: string,
  triggerMessageId: string,
): { conversationId: string; id: { not: string } } {
  return { conversationId, id: { not: triggerMessageId } }
}

export function windowedAgentHistory(messages: SoftAiHistoryMessage[]): SoftAiHistoryMessage[] {
  return selectHistoryWindow(messages)
}

/** Null serving id, or a different agent, means this agent does not attend the channel. */
export function channelBindingBlocker(
  requestedAgentId: string,
  boundAgentId: string | null,
): 'not_bound_to_channel' | null {
  return boundAgentId === requestedAgentId ? null : 'not_bound_to_channel'
}

export async function loadCanalContextForAccount(input: {
  tenantId: string
  socialAccountId: string
  fallbackPlatform: string
}): Promise<RuntimeCanalAccount> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: input.socialAccountId, tenantId: input.tenantId },
    select: { id: true, platform: true, accountId: true, displayName: true },
  })
  if (!account) {
    return {
      found: false,
      id: input.socialAccountId,
      platform: input.fallbackPlatform,
      accountId: '',
      displayName: null,
    }
  }
  return {
    found: true,
    id: account.id,
    platform: account.platform || input.fallbackPlatform,
    accountId: account.accountId || '',
    displayName: account.displayName,
  }
}

function asTone(value: string): ChatAgentTonePreset {
  if (value === 'formal' || value === 'playful' || value === 'warm_concise') return value
  return 'warm_concise'
}

function asMode(value: string): ChatAgentOperationMode {
  if (value === 'ai_full' || value === 'ai_suggest' || value === 'human_only') return value
  return 'human_only'
}

function asStatus(value: string): ChatAgentStatus {
  if (value === 'draft' || value === 'live' || value === 'archived') return value
  return 'draft'
}

export function toResolvedChatAgent(row: ChatAgentRuntimeRow): ResolvedChatAgent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    emoji: row.emoji,
    description: row.description,
    systemInstructions: row.systemInstructions,
    tonePreset: asTone(row.tonePreset),
    model: row.model,
    operationMode: asMode(row.operationMode),
    enabledTools: row.enabledTools || [],
    introductionNames: row.introductionNames || [],
    brandFacts: parseBrandFactsSafe(row.brandFacts),
    replyStyle: parseReplyStyleSafe(row.replyStyle),
    status: asStatus(row.status),
    version: row.version,
  }
}

export function assembleAgentRuntimeInputs(input: {
  agent: ResolvedChatAgent
  account: RuntimeCanalAccount
  history: SoftAiHistoryMessage[]
  inboundText: string
  clientName: string | null
  shortcuts: RuntimeShortcut[]
  knowledge: ApprovedKnowledgeSlice | null
  decision: InboundDecision
  toolCtxBase: Omit<
    SoftAiToolRunContext,
    'enabledTools' | 'inboundText' | 'agentId' | 'paymentClassification' | 'shortcuts' | 'brandFacts'
  >
}): SoftAiLlmRuntimeInput {
  const enabledTools = effectiveEnabledTools(input.agent.enabledTools)
  return {
    tenantId: input.toolCtxBase.tenantId,
    agentId: input.agent.id,
    agentVersion: input.agent.version,
    socialAccountId: input.account.id,
    model: input.agent.model,
    systemInstructions: input.agent.systemInstructions,
    tonePreset: input.agent.tonePreset,
    description: input.agent.description,
    introductionNames: input.agent.introductionNames,
    canalContext: softAiCanalContextLine({
      id: input.account.id,
      platform: input.account.platform,
      accountId: input.account.accountId,
      displayName: input.account.displayName,
    }),
    knowledge: input.knowledge,
    enabledTools,
    history: input.history,
    inboundText: input.inboundText,
    clientName: input.clientName,
    linkedOrderId: null,
    pricingVersion: DEFAULT_PRICING_VERSION,
    brandFactsBlock: formatBrandFactsForPrompt(input.agent.brandFacts),
    shortcutCatalog: guideShortcutCatalog(input.shortcuts),
    replyStyleSnippet: replyStyleSnippet(input.agent.replyStyle),
    toolCtx: {
      ...input.toolCtxBase,
      enabledTools,
      inboundText: input.inboundText,
      agentId: input.agent.id,
      paymentClassification: input.decision.paymentClass,
      shortcuts: input.shortcuts,
      brandFacts: input.agent.brandFacts,
    },
  }
}
