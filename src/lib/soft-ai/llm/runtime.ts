/**
 * Soft Agent Layer LLM runtime loop — ≤2 model calls, ≤4 tool calls.
 */

import {
  extractSoftAiFunctionCalls,
  parseSoftAiResponseText,
  readSoftAiUsage,
  softAiResponsesCreate,
  SOFT_AI_FIRST_CALL_TIMEOUT_MS,
  SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS,
  SOFT_AI_TURN_BUDGET_MS,
} from '@/lib/soft-ai/llm/client'
import {
  SOFT_AI_MAX_MODEL_CALLS,
  SOFT_AI_MAX_TOOL_CALLS,
  buildSoftAiPromptCacheKey,
} from '@/lib/soft-ai/llm/model-policy'
import { softAiToolDefinitions } from '@/lib/soft-ai/llm/tool-definitions'
import { runA1Tool, type SoftAiToolRunContext } from '@/lib/soft-ai/llm/tool-runner'
import { validateAgentOutput } from '@/lib/soft-ai/llm/output-validator'
import { runAgentFallback } from '@/lib/soft-ai/llm/fallback'
import { redactToolTrace } from '@/lib/soft-ai/llm/redact'
import { billedTokens, estimateCostMicros } from '@/lib/soft-ai/llm/usage'
import type { SoftAiHistoryMessage } from '@/lib/soft-ai/llm/prompt'
import {
  buildAgentSystemInstructions,
  buildAgentUserPrompt,
} from '@/lib/soft-ai/llm/prompt'
import { softAiProviderFor, type ChatAgentTonePreset } from '@/lib/soft-ai/agent-types'
import type { ApprovedKnowledgeSlice } from '@/lib/soft-ai/knowledge-types'
import { isAgentIntent } from '@/lib/soft-ai/agent-intents'

export type SoftAiLlmRuntimeInput = {
  tenantId: string
  agentId: string
  agentVersion: number
  socialAccountId: string
  model: string
  systemInstructions: string
  tonePreset: ChatAgentTonePreset
  description?: string | null
  canalContext?: string | null
  introductionNames?: string[] | null
  knowledge?: ApprovedKnowledgeSlice | null
  enabledTools: readonly string[]
  history: SoftAiHistoryMessage[]
  inboundText: string
  clientName?: string | null
  linkedOrderId?: string | null
  toolCtx: SoftAiToolRunContext
  pricingVersion: string
  brandFactsBlock?: string | null
  shortcutCatalog?: string | null
  replyStyleSnippet?: string | null
  /** Sales flow (Phase A): code-owned selling rules, per-turn sales data, and the amounts that data makes valid. */
  salesSystemBlock?: string | null
  salesTurnBlock?: string | null
  salesAllowedAmounts?: number[]
  /** Code says a person must follow up this turn (e.g. close with payment data not shareable). */
  salesNeedsHuman?: boolean
  /** Sales state for the turn trace (debug only; not sent to the model separately). */
  salesTrace?: { stage: string; said: Record<string, boolean> } | null
}

export type SoftAiLlmRuntimeResult = {
  text: string
  status: 'generated' | 'fallback' | 'failed'
  needsHuman: boolean
  escalate: boolean
  escalateReason?: string
  toolTrace: unknown
  citedToolNames: string[]
  knowledgeVersions: ApprovedKnowledgeSlice['versions']
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
  estimatedCostMicros: number
  billedTokens: number
  latencyMs: number
  fallbackUsed: boolean
  errorCode?: string
  validationReasons?: string[]
  inventoryPrices?: number[]
  intent?: string
  shortcutKey?: string | null
}

export async function runSoftAiLlmRuntime(
  input: SoftAiLlmRuntimeInput,
): Promise<SoftAiLlmRuntimeResult> {
  const started = Date.now()
  let inputTokens = 0
  let cachedInputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  const toolTrace: unknown[] = []
  const citedToolNames: string[] = []
  const inventoryPrices: number[] = []
  let escalate = false
  let escalateReason: string | undefined

  const built = buildAgentSystemInstructions({
    systemInstructions: input.systemInstructions,
    tonePreset: input.tonePreset,
    description: input.description,
    canalContext: input.canalContext,
    introductionNames: input.introductionNames,
    knowledge: input.knowledge,
    brandFactsBlock: input.brandFactsBlock,
    shortcutCatalog: input.shortcutCatalog,
    replyStyleSnippet: input.replyStyleSnippet,
    salesSystemBlock: input.salesSystemBlock,
  })
  const instructions = built.instructions
  const knowledgeVersions = built.knowledgeVersions
  const userPrompt = buildAgentUserPrompt({
    history: input.history,
    inboundText: input.inboundText,
    clientName: input.clientName,
    linkedOrderId: input.linkedOrderId,
    salesTurnBlock: input.salesTurnBlock,
  })
  const tools = softAiToolDefinitions(input.enabledTools)
  const promptCacheKey = buildSoftAiPromptCacheKey({
    tenantId: input.tenantId,
    agentId: input.agentId,
    agentVersion: input.agentVersion,
    socialAccountId: input.socialAccountId,
    model: input.model,
  })

  const inputItems: unknown[] = [
    {
      type: 'message',
      role: 'user',
      content: userPrompt,
    },
  ]

  try {
    let modelCalls = 0
    let toolCalls = 0
    let finalText = ''

    while (modelCalls < SOFT_AI_MAX_MODEL_CALLS) {
      modelCalls += 1
      const timeoutMs = Math.max(
        3_000,
        Math.min(
          modelCalls === 1 ? SOFT_AI_FIRST_CALL_TIMEOUT_MS : SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS,
          SOFT_AI_TURN_BUDGET_MS - (Date.now() - started),
        ),
      )
      const response = await softAiResponsesCreate({
        model: input.model,
        instructions,
        input: inputItems,
        tools: tools.length > 0 ? tools : undefined,
        promptCacheKey,
        timeoutMs,
        temperature: 0.1,
        reasoningEffort: 'low',
        store: false,
        maxOutputTokens: 700,
        usage: {
          tenantId: input.tenantId,
          feature: input.toolCtx.sandbox ? 'probar' : 'inbox_agent',
          agentId: input.agentId,
          conversationId: input.toolCtx.sandbox ? null : input.toolCtx.conversationId,
        },
      })
      const usage = readSoftAiUsage(response)
      inputTokens += usage.inputTokens
      cachedInputTokens += usage.cachedInputTokens
      outputTokens += usage.outputTokens
      reasoningTokens += usage.reasoningTokens

      const calls = extractSoftAiFunctionCalls(response)
      if (calls.length === 0) {
        finalText = parseSoftAiResponseText(response)
        break
      }

      inputItems.push(...(Array.isArray((response as { output?: unknown[] }).output)
        ? ((response as { output: unknown[] }).output as unknown[])
        : calls.map((c) => ({
            type: 'function_call',
            call_id: c.callId,
            name: c.name,
            arguments: c.argumentsJson,
          }))))

      for (const call of calls) {
        if (toolCalls >= SOFT_AI_MAX_TOOL_CALLS) {
          // Every replayed call needs an output or the provider rejects the next request.
          inputItems.push({
            type: 'function_call_output',
            call_id: call.callId,
            output: JSON.stringify({ error: 'tool_call_limit_reached' }),
          })
          continue
        }
        toolCalls += 1
        const result = await runA1Tool(input.toolCtx, call.name, call.argumentsJson)
        citedToolNames.push(result.name)
        toolTrace.push({
          callId: call.callId,
          name: result.name,
          args: call.argumentsJson,
          result: result.result,
          ok: result.ok,
        })
        if (result.name === 'search_inventory' && result.ok) {
          const items = (result.result as { items?: Array<{ sellingPrice?: number }> }).items
          if (Array.isArray(items)) {
            for (const item of items) {
              if (typeof item.sellingPrice === 'number') inventoryPrices.push(item.sellingPrice)
            }
          }
        }
        if (result.escalate) {
          escalate = true
          escalateReason = result.escalateReason || 'other'
        }
        inputItems.push({
          type: 'function_call_output',
          call_id: call.callId,
          output: JSON.stringify(result.result),
        })
      }

      if (toolCalls >= SOFT_AI_MAX_TOOL_CALLS || modelCalls >= SOFT_AI_MAX_MODEL_CALLS) {
        // One more model call only if budget remains
        if (modelCalls >= SOFT_AI_MAX_MODEL_CALLS) break
      }
    }

    // The model used every round on lookups (e.g. inventory, then shipping knowledge) and never wrote the answer:
    // one last call that MUST answer in text from what it found (no more tools), inside the turn's time budget.
    // Before (2026-10-09) this was skipped when the rounds were used up → empty output → human hand-off.
    const remainingMs = SOFT_AI_TURN_BUDGET_MS - (Date.now() - started)
    if (!finalText && toolCalls > 0 && remainingMs > 3_000) {
      const response = await softAiResponsesCreate({
        model: input.model,
        instructions,
        input: inputItems,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: 'none',
        promptCacheKey,
        timeoutMs: Math.min(SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS, remainingMs),
        temperature: 0.1,
        reasoningEffort: 'low',
        store: false,
        maxOutputTokens: 700,
        usage: {
          tenantId: input.tenantId,
          feature: input.toolCtx.sandbox ? 'probar' : 'inbox_agent',
          agentId: input.agentId,
          conversationId: input.toolCtx.sandbox ? null : input.toolCtx.conversationId,
        },
      })
      modelCalls += 1
      const usage = readSoftAiUsage(response)
      inputTokens += usage.inputTokens
      cachedInputTokens += usage.cachedInputTokens
      outputTokens += usage.outputTokens
      reasoningTokens += usage.reasoningTokens
      finalText = parseSoftAiResponseText(response)
    }

    if (!finalText) {
      const fb = await runAgentFallback({
        inboundText: input.inboundText,
        toolCtx: input.toolCtx,
        linkedOrderId: input.linkedOrderId,
      })
      return {
        text: fb.text,
        status: 'fallback',
        needsHuman: fb.escalate,
        escalate: fb.escalate,
        escalateReason: fb.escalateReason,
        toolTrace: redactToolTrace([
          { knowledgeVersions },
          ...toolTrace,
          ...fb.toolTrace,
        ]),
        citedToolNames,
        knowledgeVersions,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
        estimatedCostMicros: estimateCostMicros({
          model: input.model,
          inputTokens,
          cachedInputTokens,
          outputTokens,
        }),
        billedTokens: billedTokens({ inputTokens, outputTokens }),
        latencyMs: Date.now() - started,
        fallbackUsed: true,
        errorCode: 'empty_model_output',
      }
    }

    const structured = parseStructuredAgentOutput(finalText)
    finalText = structured.text
    const validation = validateAgentOutput({
      text: finalText,
      citedToolNames,
      inventoryPrices,
      // Prices / shipping / totals listed for this turn by code are sourced (no lookup call needed).
      quoteAmounts: input.salesAllowedAmounts,
    })
    if (validation.needsHuman || structured.needsHuman) {
      escalate = true
      escalateReason = escalateReason || 'provenance'
    }

    return {
      text: finalText,
      status: 'generated',
      needsHuman: validation.needsHuman || structured.needsHuman || escalate,
      intent: structured.intent,
      shortcutKey: structured.shortcutKey,
      inventoryPrices,
      escalate,
      escalateReason,
      toolTrace: redactToolTrace([{ knowledgeVersions }, ...toolTrace]),
      citedToolNames,
      knowledgeVersions,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      estimatedCostMicros: estimateCostMicros({
        model: input.model,
        inputTokens,
        cachedInputTokens,
        outputTokens,
      }),
      billedTokens: billedTokens({ inputTokens, outputTokens }),
      latencyMs: Date.now() - started,
      fallbackUsed: false,
      validationReasons: validation.reasons,
    }
  } catch (error) {
    const fb = await runAgentFallback({
      inboundText: input.inboundText,
      toolCtx: input.toolCtx,
      linkedOrderId: input.linkedOrderId,
    })
    const openai = softAiProviderFor(input.model) === 'openai'
    logLlmFailure(input.model, error)
    const authFailure = isAuthFailure(error)
    const errorCode =
      error instanceof Error && error.message === 'XAI_NOT_CONFIGURED'
        ? 'XAI_NOT_CONFIGURED'
        : error instanceof Error && error.message === 'LLM_NOT_CONFIGURED'
          ? 'LLM_NOT_CONFIGURED'
          : authFailure
            ? 'LLM_AUTH'
            : error instanceof Error && /timed? ?out|abort/i.test(error.message)
            ? openai
              ? 'LLM_TIMEOUT'
              : 'XAI_TIMEOUT'
            : openai
              ? 'LLM_ERROR'
              : 'XAI_ERROR'
    return {
      text: fb.text,
      status: 'fallback',
      needsHuman: true,
      escalate: fb.escalate,
      escalateReason: fb.escalateReason,
      toolTrace: redactToolTrace([
        { knowledgeVersions },
        ...toolTrace,
        ...fb.toolTrace,
      ]),
      citedToolNames,
      knowledgeVersions,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      estimatedCostMicros: estimateCostMicros({
        model: input.model,
        inputTokens,
        cachedInputTokens,
        outputTokens,
      }),
      billedTokens: billedTokens({ inputTokens, outputTokens }),
      latencyMs: Date.now() - started,
      fallbackUsed: true,
      errorCode,
    }
  }
}

/** Provider 401/403 (wrong, revoked or restricted key): a distinct code so ops can see it. */
function isAuthFailure(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status
  return status === 401 || status === 403
}

/**
 * One safe line per failure. Never the error message (a 401 text contains a masked key fragment)
 * and never headers (org/project ids).
 */
function logLlmFailure(model: string, error: unknown) {
  const e = (error ?? {}) as { status?: unknown; type?: unknown; code?: unknown; request_id?: unknown; name?: unknown }
  console.error('[soft-ai llm]', {
    provider: softAiProviderFor(model),
    model,
    status: typeof e.status === 'number' ? e.status : null,
    type: typeof e.type === 'string' ? e.type : null,
    code: typeof e.code === 'string' ? e.code : null,
    requestId: typeof e.request_id === 'string' ? e.request_id : null,
    name: typeof e.name === 'string' ? e.name : null,
  })
}

function parseStructuredAgentOutput(raw: string): {
  text: string
  intent?: string
  shortcutKey?: string | null
  needsHuman: boolean
} {
  const trimmed = (raw || '').trim()
  if (!trimmed.startsWith('{')) return { text: raw, needsHuman: false }
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>
    if (!value || typeof value.text !== 'string') return { text: raw, needsHuman: false }
    const intent = typeof value.intent === 'string' && isAgentIntent(value.intent) ? value.intent : undefined
    const shortcutKey = typeof value.shortcutKey === 'string' ? value.shortcutKey : null
    return {
      text: value.text,
      intent,
      shortcutKey,
      needsHuman: value.needsHuman === true,
    }
  } catch {
    return { text: raw, needsHuman: false }
  }
}
