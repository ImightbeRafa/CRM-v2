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
import { guideShortcutCatalog, renderShortcutTemplate } from '@/lib/soft-ai/shortcuts'
import { brandFactsLinkAllowlist } from '@/lib/soft-ai/llm/output-validator'
import { linkSourceTexts } from '@/lib/soft-ai/agent-tuning-core'
import {
  deriveSalesState,
  formatSalesTurnBlock,
  salesAllowedAmounts,
  salesDataListFirst,
  salesAllowedDeals,
  salesCloseWithoutPaymentData,
  salesFreeShippingRule,
  salesNeedsHuman,
  salesPaymentOptions,
  salesSystemBlock,
  type SalesContext,
} from '@/lib/soft-ai/sales-state'
import {
  PAYMENT_METHOD_TOKENS,
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
  /** Saved replies (ids) that carry images: the catalog tells the model so it doesn't say it can't send photos. */
  replyImageShortcutIds?: ReadonlySet<string>
  knowledge: ApprovedKnowledgeSlice | null
  decision: InboundDecision
  /** agents2-hours: code-owned per-turn line when outside the agent's "Horario de atención" (null = in hours). */
  afterHoursLine?: string | null
  /** Sales flow context (same loader for live and test chat). Null = previous behaviour. */
  salesContext?: SalesContext | null
  toolCtxBase: Omit<
    SoftAiToolRunContext,
    'enabledTools' | 'inboundText' | 'agentId' | 'paymentClassification' | 'shortcuts' | 'brandFacts'
  >
}): SoftAiLlmRuntimeInput {
  const enabledTools = effectiveEnabledTools(input.agent.enabledTools)
  const sales = input.salesContext ?? null
  // With the sales flow, shipping comes only from Betsy's shipping list (promo applied); the store's own shipping
  // text would show a second, stale price (e.g. ₡3.000 during a free-shipping promo).
  const promptFacts = sales ? { ...input.agent.brandFacts, shipping: undefined } : input.agent.brandFacts
  const salesState = sales ? deriveSalesState({ history: input.history, inboundText: input.inboundText, ctx: sales }) : null
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
    brandFactsBlock: formatBrandFactsForPrompt(promptFacts),
    // Bodies rendered for the model (no raw {{brand.…}}); payment numbers stay out. agents2-format: a payment summary
    // becomes the method NAMES (the agent asks which one first), a SINPE field becomes [[PAGO_SINPE]].
    shortcutCatalog: guideShortcutCatalog(
      input.shortcuts.map((row) => ({
        ...row,
        // Same facts as the brand block (no store shipping under the sales flow); no customer name in the system
        // instructions (it is customer-controlled and would break prompt caching) — the name is in the chat anyway.
        body: renderShortcutTemplate(
          row.body
            .replace(/\{\{\s*brand\.payment\.sinpe\.[a-zA-Z0-9_.]+\s*\}\}/g, PAYMENT_METHOD_TOKENS.sinpe)
            .replace(/\{\{\s*brand\.payment\.(?!methods(?:List)?\s*\}\})[a-zA-Z0-9_.]+\s*\}\}/g, '{{brand.payment.methods}}'),
          {
            facts: promptFacts,
            clientFirstName: null,
          },
        ),
      })),
      input.replyImageShortcutIds,
    ),
    replyStyleSnippet: replyStyleSnippet(input.agent.replyStyle),
    salesSystemBlock: sales ? salesSystemBlock(sales) : null,
    salesTurnBlock: sales && salesState ? formatSalesTurnBlock(sales, salesState) : null,
    afterHoursLine: input.afterHoursLine ?? null,
    // B4: + totals for the quantities the customer asked for (computed by code, listed in BETSY_DATOS).
    // Multi-unit totals are never quotable (SecureDog INT-94): unit prices, shipping, one unit + shipping, combos only.
    salesAllowedAmounts: sales ? salesAllowedAmounts(sales) : undefined,
    salesNeedsHuman: Boolean(sales && salesState && salesNeedsHuman(sales, salesState)),
    salesReceiptCue: Boolean(salesState?.receiptCue),
    salesPaymentDataByTeam: Boolean(sales && salesState && salesCloseWithoutPaymentData(sales, salesState)),
    salesAllowedDeals: sales ? salesAllowedDeals(sales) : [],
    salesFreeShipping: Boolean(sales?.promo?.freeShipping),
    salesFreeShippingRule: sales ? salesFreeShippingRule(sales) : null,
    // INT-112: same allowlist for live and Probar — brand site, map link, and links the owner wrote in ACTIVE saved
    // replies and APPROVED bound knowledge (PatchHouse ↔ sleep.shopping cross-links pass this way).
    linkAllowlist: brandFactsLinkAllowlist(
      input.agent.brandFacts,
      linkSourceTexts({
        shortcuts: input.shortcuts,
        knowledge: input.knowledge
          ? [...input.knowledge.brandBook, ...input.knowledge.policies, ...input.knowledge.faqs, ...input.knowledge.channelOverlay]
          : [],
      }),
    ),
    // chosenMethod: a contra-entrega / efectivo block is an order for a person only when the customer chose it (#9).
    // Sleeping C6: at the close, the data list goes before the payment question (code orders the reply).
    salesPaymentOptions: sales
      ? {
          ...salesPaymentOptions(sales),
          chosenMethod: salesState?.chosenMethod ?? null,
          dataListFirst: salesState ? salesDataListFirst(salesState, input.history, input.inboundText, sales) : null,
        }
      : undefined,
    salesTrace: salesState ? { stage: salesState.stage, said: salesState.said, chosenMethod: salesState.chosenMethod ?? null } : null,
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
