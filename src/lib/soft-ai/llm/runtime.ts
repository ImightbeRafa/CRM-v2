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
} from '@/lib/soft-ai/llm/client'
import { SOFT_AI_MAX_MODEL_CALLS, SOFT_AI_MAX_TOOL_CALLS } from '@/lib/soft-ai/llm/model-policy'
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
import type { ChatAgentTonePreset } from '@/lib/soft-ai/agent-types'

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
  enabledTools: readonly string[]
  history: SoftAiHistoryMessage[]
  inboundText: string
  clientName?: string | null
  linkedOrderId?: string | null
  toolCtx: SoftAiToolRunContext
  pricingVersion: string
}

export type SoftAiLlmRuntimeResult = {
  text: string
  status: 'generated' | 'fallback' | 'failed'
  needsHuman: boolean
  escalate: boolean
  escalateReason?: string
  toolTrace: unknown
  citedToolNames: string[]
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
  let escalate = false
  let escalateReason: string | undefined

  const instructions = buildAgentSystemInstructions({
    systemInstructions: input.systemInstructions,
    tonePreset: input.tonePreset,
    description: input.description,
    canalContext: input.canalContext,
    introductionNames: input.introductionNames,
  })
  const userPrompt = buildAgentUserPrompt({
    history: input.history,
    inboundText: input.inboundText,
    clientName: input.clientName,
    linkedOrderId: input.linkedOrderId,
  })
  const tools = softAiToolDefinitions(input.enabledTools)
  const promptCacheKey = [
    input.tenantId,
    input.agentId,
    String(input.agentVersion),
    input.socialAccountId,
  ].join(':')

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
      const timeoutMs =
        modelCalls === 1
          ? SOFT_AI_FIRST_CALL_TIMEOUT_MS
          : SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS
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
        if (toolCalls >= SOFT_AI_MAX_TOOL_CALLS) break
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

    if (!finalText && toolCalls > 0 && modelCalls < SOFT_AI_MAX_MODEL_CALLS) {
      const response = await softAiResponsesCreate({
        model: input.model,
        instructions,
        input: inputItems,
        tools: tools.length > 0 ? tools : undefined,
        promptCacheKey,
        timeoutMs: SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS,
        temperature: 0.1,
        reasoningEffort: 'low',
        store: false,
        maxOutputTokens: 700,
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
        toolTrace: redactToolTrace([...toolTrace, ...fb.toolTrace]),
        citedToolNames,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
        estimatedCostMicros: estimateCostMicros({
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

    const validation = validateAgentOutput({
      text: finalText,
      citedToolNames,
    })
    if (validation.needsHuman) {
      escalate = true
      escalateReason = escalateReason || 'provenance'
    }

    return {
      text: finalText,
      status: 'generated',
      needsHuman: validation.needsHuman || escalate,
      escalate,
      escalateReason,
      toolTrace: redactToolTrace(toolTrace),
      citedToolNames,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      estimatedCostMicros: estimateCostMicros({
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
    const errorCode =
      error instanceof Error && error.message === 'XAI_NOT_CONFIGURED'
        ? 'XAI_NOT_CONFIGURED'
        : error instanceof Error && /timeout|abort/i.test(error.message)
          ? 'XAI_TIMEOUT'
          : 'XAI_ERROR'
    return {
      text: fb.text,
      status: 'fallback',
      needsHuman: true,
      escalate: fb.escalate,
      escalateReason: fb.escalateReason,
      toolTrace: redactToolTrace([...toolTrace, ...fb.toolTrace]),
      citedToolNames,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningTokens,
      estimatedCostMicros: estimateCostMicros({
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
