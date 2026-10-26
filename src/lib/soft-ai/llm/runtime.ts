/**
 * Soft Agent Layer LLM runtime loop — ≤2 model calls, ≤4 tool calls.
 */

import { classifyProviderFailure, type ProviderFailureKind } from '@/lib/soft-ai/provider-outage-core'
import { extractShortcutTag } from '@/lib/soft-ai/reply-images'
import {
  extractSoftAiFunctionCalls,
  isRetryableSoftAiError,
  parseSoftAiResponseText,
  readSoftAiUsage,
  softAiResponsesCreate as rawSoftAiResponsesCreate,
  SOFT_AI_FIRST_CALL_TIMEOUT_MS,
  SOFT_AI_RETRY_MIN_LEFT_MS,
  SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS,
  SOFT_AI_TURN_BUDGET_MS,
  type SoftAiResponsesCreateArgs,
} from '@/lib/soft-ai/llm/client'
import {
  SOFT_AI_MAX_MODEL_CALLS,
  SOFT_AI_MAX_TOOL_CALLS,
  buildSoftAiPromptCacheKey,
} from '@/lib/soft-ai/llm/model-policy'
import { softAiToolDefinitions } from '@/lib/soft-ai/llm/tool-definitions'
import { runA1Tool, type SoftAiToolRunContext } from '@/lib/soft-ai/llm/tool-runner'
import { validateAgentOutput, type FreeShippingRule } from '@/lib/soft-ai/llm/output-validator'
import type { StockGuard } from '@/lib/soft-ai/product-availability-core'
import type { LinkAllowlist } from '@/lib/soft-ai/links'
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
import { HANDOFF_REASON, type TurnHandoff } from '@/lib/soft-ai/agent-turn-outcome'
import { hasPaymentWord, paymentHandoffReason } from '@/lib/soft-ai/payment-classifier'

export type SoftAiLlmRuntimeInput = {
  /**
   * luna-10 D2: when the turn's 35 s budget started (before the "¿ya pagó?" check). Retries / repair / follow-ups fit
   * in what is LEFT, so check + model + send stay inside the 42 s job and the 45 s lease.
   */
  budgetStartedAt?: number
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
  /** Meter label for sandbox turns: manual Probar vs automatic checks (quick check, unlock, test runs). */
  usageFeature?: 'probar' | 'agent_test' | 'agent_activation'
  pricingVersion: string
  brandFactsBlock?: string | null
  shortcutCatalog?: string | null
  replyStyleSnippet?: string | null
  /** Sales flow (Phase A): code-owned selling rules, per-turn sales data, and the amounts that data makes valid. */
  salesSystemBlock?: string | null
  salesTurnBlock?: string | null
  /** agents2-hours: "Fuera de horario: …" line for this turn (user prompt), null in hours. */
  afterHoursLine?: string | null
  salesAllowedAmounts?: number[]
  /** Code says a person must follow up this turn (e.g. close with payment data not shareable). */
  salesNeedsHuman?: boolean
  /** Customer message has a receipt / "ya pagué" cue (sales-state): a TRUE hand-off whatever the model writes. */
  salesReceiptCue?: boolean
  /** Close with payment data not shared by chat: "Enseguida te paso cómo pagar 😊" + team review, chat stays on IA. */
  salesPaymentDataByTeam?: boolean
  /** Deal wording the owner's active promo allows (free shipping / special price); nothing else. */
  salesAllowedDeals?: Array<'free_shipping' | 'special_price'>
  /** Promo makes shipping free: the store's fixed shipping amounts are no longer valid prices. */
  salesFreeShipping?: boolean
  /** Store rule "envío gratis desde ₡X": the words pass only next to that amount (output-validator). */
  salesFreeShippingRule?: FreeShippingRule | null
  /** Lane C D6: prices of bundles with shipping included ('₡32 800 con envío incluido' is not a free-shipping offer). */
  salesIncludedShippingAmounts?: number[]
  /** Sleeping C3: the store's own per-unit rates ("Pack 3 bolsas (90 noches)"), the only source of a per-night amount. */
  salesUnitRates?: Array<{ price: number; count: number; unit: string }>
  /** Out-of-stock switch (SQL 055): sold-out products + names on sale for the stock checks (null = none sold out). */
  salesStockGuard?: StockGuard | null
  /** INT-109 / INT-112: links a reply may carry (brandFactsLinkAllowlist) — any other is 'foreign_link'. */
  linkAllowlist?: LinkAllowlist
  /** Sales flow: contra entrega offered by a shipping method, for [[PAGO_CONTRA_ENTREGA]] (agents2-format). */
  salesPaymentOptions?: { codAvailable?: boolean; codNote?: string | null; chosenMethod?: string | null; dataListFirst?: 'shipping' | 'pickup' | null }
  /** Sales state for the turn trace (debug only; not sent to the model separately). */
  salesTrace?: { stage: string; said: Record<string, boolean>; chosenMethod?: string | null } | null
}

export type SoftAiLlmRuntimeResult = {
  text: string
  status: 'generated' | 'fallback' | 'failed'
  needsHuman: boolean
  /** TRUE hand-off only (escalate_to_human called by the model, payment fallback). Validator / technical problems are not. */
  escalate: boolean
  escalateReason?: string
  /**
   * Agentes IA 2.0 (B1): 'handoff' → the chat goes to a person after the customer gets the hand-off text; 'review' →
   * the customer gets the safe line, the chat stays on IA, a person is asked to look. Null = normal answer.
   */
  handoff: TurnHandoff | null
  /** The returned text passed every runtime check (or is a fixed code text) and may be sent as written. */
  textOk: boolean
  /** Same as handoff.kind, named for the review: 'technical' = validator / provider / tool problem, never a flip. */
  escalateKind: 'technical' | 'handoff' | null
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
  /** Lane D 2026-10-22: the model call failed on the provider side (no credit / 429 / auth / 5xx / timeout / network). */
  providerFailure?: ProviderFailureKind | null
  validationReasons?: string[]
  inventoryPrices?: number[]
  intent?: string
  shortcutKey?: string | null
}

export async function runSoftAiLlmRuntime(
  input: SoftAiLlmRuntimeInput,
): Promise<SoftAiLlmRuntimeResult> {
  const started = Date.now()
  const budgetStarted = Math.min(started, input.budgetStartedAt ?? started)
  let inputTokens = 0
  let cachedInputTokens = 0
  let outputTokens = 0
  let reasoningTokens = 0
  const toolTrace: unknown[] = []
  const citedToolNames: string[] = []
  const inventoryPrices: number[] = []
  let escalate = false
  let escalateReason: string | undefined
  /** An unknown / not-allowed tool was requested: a person reviews, the chat stays on IA. */
  let toolProblem = false
  /** B2: ONE retry per turn (provider error / timeout, or an empty / tag-only answer). */
  let retried = false
  const addUsage = (response: unknown) => {
    const usage = readSoftAiUsage(response)
    inputTokens += usage.inputTokens
    cachedInputTokens += usage.cachedInputTokens
    outputTokens += usage.outputTokens
    reasoningTokens += usage.reasoningTokens
  }
  // Every model call of the turn goes through this (one retry per turn at most; all usage tagged and metered).
  const softAiResponsesCreate = async (args: SoftAiResponsesCreateArgs) => {
    try {
      return await rawSoftAiResponsesCreate(args)
    } catch (error) {
      // Only when a FULL attempt (same timeout) still fits in the turn budget (35 s, inside the 42 s job / 45 s lease).
      const timeoutMs = args.timeoutMs ?? SOFT_AI_FIRST_CALL_TIMEOUT_MS
      if (retried || !isRetryableSoftAiError(error) || !retryFits(budgetStarted, timeoutMs)) throw error
      retried = true
      toolTrace.push({ retry: { reason: 'model_error' } })
      return rawSoftAiResponsesCreate({ ...args, timeoutMs })
    }
  }

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
    afterHoursLine: input.afterHoursLine,
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
          SOFT_AI_TURN_BUDGET_MS - (Date.now() - budgetStarted),
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
          feature: input.toolCtx.sandbox ? (input.usageFeature ?? 'probar') : 'inbox_agent',
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
        let output: Record<string, unknown> = result.result
        if (result.escalate) {
          if (result.name === 'escalate_to_human' && result.ok) {
            // The model (or the payment rule) asked for a person: a TRUE hand-off.
            escalate = true
            escalateReason = result.escalateReason || 'other'
          } else if (result.name === 'escalate_to_human') {
            // Unknown / not-allowed tool: technical, a person reviews (B1).
            toolProblem = true
          } else {
            // B8: an order lookup that found no order of THIS customer is not a hand-off: ask for the order number.
            // The answer stays the same for "unknown" and "someone else's" (no probing which orders exist).
            output = { ...result.result, next: ORDER_LOOKUP_MISS_HINT }
          }
        }
        inputItems.push({
          type: 'function_call_output',
          call_id: call.callId,
          output: JSON.stringify(output),
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
    const remainingMs = SOFT_AI_TURN_BUDGET_MS - (Date.now() - budgetStarted)
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
          feature: input.toolCtx.sandbox ? (input.usageFeature ?? 'probar') : 'inbox_agent',
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

    // A reply that is only [[ATAJO:…]] (or empty JSON text) is no reply: fallback / hand-off, never an empty send.
    if (finalText && !extractShortcutTag(parseStructuredAgentOutput(finalText).text).text) finalText = ''

    // B2: empty or tag-only answer → ONE more try (text only) before the safe line, when the turn budget allows.
    if (!finalText && !retried && !escalate && retryFits(budgetStarted, SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS)) {
      retried = true
      toolTrace.push({ retry: { reason: 'empty_output' } })
      try {
        const response = await softAiResponsesCreate({
          model: input.model,
          instructions,
          input: inputItems,
          tools: tools.length > 0 ? tools : undefined,
          toolChoice: 'none',
          promptCacheKey,
          timeoutMs: SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS,
          temperature: 0.1,
          reasoningEffort: 'low',
          store: false,
          maxOutputTokens: 700,
          usage: {
            tenantId: input.tenantId,
            feature: input.toolCtx.sandbox ? (input.usageFeature ?? 'probar') : 'inbox_agent',
            agentId: input.agentId,
            conversationId: input.toolCtx.sandbox ? null : input.toolCtx.conversationId,
          },
        })
        modelCalls += 1
        addUsage(response)
        finalText = parseSoftAiResponseText(response)
        if (finalText && !extractShortcutTag(parseStructuredAgentOutput(finalText).text).text) finalText = ''
      } catch {
        // Still nothing: the safe line below.
      }
    }

    if (!finalText) {
      const fb = await runAgentFallback({
        inboundText: input.inboundText,
        toolCtx: input.toolCtx,
        linkedOrderId: input.linkedOrderId,
      })
      const fbHandoff = escalate ? modelHandoff(escalateReason, input.inboundText) : fallbackHandoff(fb, input.inboundText)
      return {
        text: fb.text,
        status: 'fallback',
        needsHuman: fb.escalate || escalate,
        escalate: fbHandoff?.kind === 'handoff',
        escalateReason: escalate ? escalateReason : fb.escalateReason,
        handoff: fbHandoff,
        escalateKind: escalateKindOf(fbHandoff),
        // Fallback texts are code-written (reserved line or the owned order's status).
        textOk: true,
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
    // [[ATAJO:clave]] names the saved reply it used (its images are attached by code); never shown to the customer.
    let tagged = extractShortcutTag(structured.text)
    finalText = tagged.text
    const validate = (text: string) =>
      validateAgentOutput({
        text,
        citedToolNames,
        inventoryPrices,
        // Prices / shipping / totals listed for this turn by code are sourced (no lookup call needed).
        quoteAmounts: input.salesAllowedAmounts,
        allowedDeals: input.salesAllowedDeals,
        freeShippingRule: input.salesFreeShippingRule,
        includedShippingAmounts: input.salesIncludedShippingAmounts,
        unitRates: input.salesUnitRates,
        ownText: input.brandFactsBlock ?? null,
        // SecureDog round 6: the whole burst since the store last wrote, not only the newest message.
        customerText: burstCustomerText(input.history, input.inboundText),
        linkAllowlist: input.linkAllowlist,
        paymentContext: conversationPaymentContext(input.history, input.inboundText),
        modelText: true,
        stockGuard: input.salesStockGuard,
      })
    let validation = validate(finalText)
    // B7: a reply that breaks a rule (made-up amount, a deal, "ya quedó pagado"…) gets ONE rewrite with the reasons
    // before anything is handed to a person. The rewrite passes the same checks or the original hand-off stands.
    const repairLeftMs = SOFT_AI_TURN_BUDGET_MS - (Date.now() - budgetStarted)
    // Never on payment wording (a "ya quedó pagado" reply means the customer is talking about a payment → person).
    const repairable = validation.reasons.length > 0 && validation.reasons.every((r) => REPAIRABLE_REASONS.has(r))
    if (validation.needsHuman && repairable && !structured.needsHuman && !escalate && repairLeftMs > 5_000) {
      try {
        const response = await softAiResponsesCreate({
          model: input.model,
          instructions,
          input: [
            ...inputItems,
            { type: 'message', role: 'assistant', content: finalText },
            { type: 'message', role: 'user', content: repairInstruction(validation.reasons) },
          ],
          tools: tools.length > 0 ? tools : undefined,
          toolChoice: 'none',
          promptCacheKey,
          timeoutMs: Math.min(SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS, repairLeftMs - 1_000),
          temperature: 0.1,
          reasoningEffort: 'low',
          store: false,
          maxOutputTokens: 500,
          usage: {
            tenantId: input.tenantId,
            feature: input.toolCtx.sandbox ? (input.usageFeature ?? 'probar') : 'inbox_agent',
            agentId: input.agentId,
            conversationId: input.toolCtx.sandbox ? null : input.toolCtx.conversationId,
          },
        })
        const usage = readSoftAiUsage(response)
        inputTokens += usage.inputTokens
        cachedInputTokens += usage.cachedInputTokens
        outputTokens += usage.outputTokens
        reasoningTokens += usage.reasoningTokens
        const repairedRaw = parseStructuredAgentOutput(parseSoftAiResponseText(response))
        const repaired = extractShortcutTag(repairedRaw.text)
        const recheck = repaired.text ? validate(repaired.text) : null
        toolTrace.push({ repair: { reasons: validation.reasons, ok: Boolean(recheck?.ok && !repairedRaw.needsHuman) } })
        if (recheck?.ok && !repairedRaw.needsHuman) {
          finalText = repaired.text
          tagged = { text: repaired.text, key: repaired.key }
          validation = recheck
        }
      } catch {
        // Timeout / provider error: keep the original verdict (hand-off).
      }
    }
    // SecureDog INT-93: a reply that sounds like it confirms a payment, or the model asking for a person on a message
    // about a payment, is a real PAYMENT hand-off (fixed "ya lo reviso" text + the chat goes to a person) — never the
    // "safe line and stay on IA" path, which would let the model try again on the next message.
    // luna-10 live (2026-10-17): a lone "confirmad[oa]" ("No tengo información confirmada sobre…" on a side-effects
    // question) is still never sent, but it is only a PAYMENT hand-off ("Pago por verificar") when payment or an order
    // is in play: the reply or the customer's message has a payment word, or the reply talks about the order.
    // SecureDog r9 F2: the customer side is the whole recent burst (not only the planned text), and the store's last
    // message counts ("listo" right after the SINPE details is payment talk).
    const customerSide = burstCustomerText(input.history, input.inboundText || '')
    const lastStoreText = [...input.history].reverse().find((m) => m.direction === 'outbound')?.content || ''
    const confirmationIsPayment =
      // INT-158 H3: an odd-letter reply may be a disguised claim ("confırmado"): same rule.
      (validation.reasons.includes('confirmation_wording') || validation.reasons.includes('unsafe_letters')) &&
      (hasPaymentWord(finalText) ||
        hasPaymentWord(customerSide) ||
        hasPaymentWord(lastStoreText) ||
        /(?<![\p{L}])(pedido|orden|compra)(?![\p{L}])/iu.test(finalText))
    const paymentRisk =
      confirmationIsPayment ||
      validation.reasons.includes('payment_status_claim') ||
      (structured.needsHuman && (hasPaymentWord(customerSide) || hasPaymentWord(lastStoreText)))
    if (paymentRisk) {
      escalate = true
      escalateReason = 'payment_claim'
    }
    if (validation.needsHuman || structured.needsHuman) {
      // B1: a reply that still breaks a rule is never sent as written and is NOT a hand-off: the customer gets the
      // safe line, the chat stays on IA and a person reviews (agent-turn planModelTurnDelivery).
      escalateReason = escalateReason || 'provenance'
    }
    const reviewNeeded = validation.needsHuman || structured.needsHuman || toolProblem
    const handoff: TurnHandoff | null = escalate
      ? modelHandoff(escalateReason, input.inboundText)
      : reviewNeeded
        ? { kind: 'review', reason: HANDOFF_REASON.review }
        : null

    return {
      text: finalText,
      status: 'generated',
      needsHuman: validation.needsHuman || structured.needsHuman || escalate || toolProblem,
      handoff,
      escalateKind: escalateKindOf(handoff),
      textOk: validation.ok && !structured.needsHuman && Boolean(finalText.trim()),
      intent: structured.intent,
      shortcutKey: tagged.key || structured.shortcutKey || lastUsedShortcutKey(toolTrace),
      inventoryPrices,
      escalate: handoff?.kind === 'handoff',
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
    logLlmFailure(input.model, error)
    const authFailure = isAuthFailure(error)
    const errorCode =
      error instanceof Error && error.message === 'LLM_NOT_CONFIGURED'
        ? 'LLM_NOT_CONFIGURED'
        : error instanceof Error && error.message === 'TEST_BUDGET_EXCEEDED'
          ? 'TEST_BUDGET_EXCEEDED'
          : authFailure
          ? 'LLM_AUTH'
          : error instanceof Error && /timed? ?out|abort/i.test(error.message)
            ? 'LLM_TIMEOUT'
            : 'LLM_ERROR'
    const fbHandoff = escalate ? modelHandoff(escalateReason, input.inboundText) : fallbackHandoff(fb, input.inboundText)
    return {
      text: fb.text,
      status: 'fallback',
      needsHuman: true,
      escalate: fbHandoff?.kind === 'handoff',
      escalateReason: escalate ? escalateReason : fb.escalateReason,
      handoff: fbHandoff,
      escalateKind: escalateKindOf(fbHandoff),
      textOk: true,
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
      providerFailure: classifyProviderFailure(error),
    }
  }
}

/** B8: what the model gets after an order lookup that found nothing for this customer. */
export const ORDER_LOOKUP_MISS_HINT =
  'No encontré un pedido de este cliente con ese dato. Pedile con amabilidad el número de pedido (o el nombre y teléfono con que compró) para buscarlo. No digas nada de otros pedidos ni inventes estados.'

/** escalate_to_human called by the model (or forced by the payment rule) → hand-off with a plain reason for the team. */
/** B2: a retry runs only when a FULL attempt with this timeout still fits in the turn budget. */
export function retryFits(startedAt: number, timeoutMs: number, now = Date.now()): boolean {
  return SOFT_AI_TURN_BUDGET_MS - (now - startedAt) - 1_000 >= Math.max(timeoutMs, SOFT_AI_RETRY_MIN_LEFT_MS)
}

/** Explicit kind of a non-answer: 'handoff' (a person takes the chat) or 'technical' (safe line, chat stays on IA). */
export function escalateKindOf(handoff: TurnHandoff | null): 'technical' | 'handoff' | null {
  return handoff ? (handoff.kind === 'handoff' ? 'handoff' : 'technical') : null
}

/**
 * MEDIA-15: the payment-status backstop also applies when the conversation (not only this message) is about a
 * payment: a payment word or a photo / file / audio in the last 3 customer messages, or the store talked about paying.
 */
type TimedMessage = { direction: string; content?: string | null; sentAt?: string | Date | null }

/**
 * SecureDog round 7: the customer's earlier messages that belong to this turn — every one since the store last wrote,
 * PLUS any sent in the last `windowMs` (the store's reply is stored when it is SENT, so a message the customer typed
 * while it was being written sorts before it). Oldest first, without the current message, at most `max`.
 */
export function recentCustomerTexts(history: TimedMessage[], windowMs: number, max: number, now = Date.now()): string[] {
  const keep = new Set<number>()
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].direction === 'outbound') break
    keep.add(i)
  }
  history.forEach((m, i) => {
    if (m.direction !== 'inbound' || !m.sentAt) return
    const at = new Date(m.sentAt).getTime()
    if (Number.isFinite(at) && now - at <= windowMs) keep.add(i)
  })
  return [...keep]
    .sort((a, b) => a - b)
    .map((i) => history[i])
    .filter((m) => m.direction === 'inbound' && m.content)
    .map((m) => String(m.content))
    .slice(-max)
}

/** The customer text the reply checks read: the recent customer messages (30 min, last 3) plus this one. */
export function burstCustomerText(history: TimedMessage[], inboundText: string): string {
  return [...recentCustomerTexts(history, 30 * 60_000, 3), inboundText || ''].join('\n')
}

export function conversationPaymentContext(history: Array<{ direction: string; content?: string | null }>, inboundText: string): boolean {
  const inbound = history.filter((m) => m.direction === 'inbound').slice(-3).map((m) => m.content || '')
  const mediaRe = /\[(image|imagen|foto|audio|voice|video|document|documento|archivo|sticker)/i
  if ([inboundText, ...inbound].some((t) => hasPaymentWord(t) || mediaRe.test(t))) return true
  return history.some((m) => m.direction === 'outbound' && hasPaymentWord(m.content || ''))
}

export function modelHandoff(reason: string | undefined, inboundText: string): TurnHandoff {
  switch (reason) {
    case 'payment_or_sinpe':
    case 'payment_claim':
      return { kind: 'handoff', reason: paymentHandoffReason(inboundText) }
    case 'opt_out':
      return { kind: 'handoff', reason: HANDOFF_REASON.optOut }
    case 'media_inbound':
      return { kind: 'handoff', reason: HANDOFF_REASON.payment }
    // SecureDog M2: a complaint / refund the model names is the complaint hand-off (empathetic line, its own alert).
    case 'complaint':
      return { kind: 'handoff', reason: HANDOFF_REASON.refund }
    case 'llm_unavailable':
      // Technical by name: the safe line, the chat stays on IA.
      return { kind: 'review', reason: HANDOFF_REASON.review }
    default:
      // Never the model's own words in a team notification.
      return { kind: 'handoff', reason: HANDOFF_REASON.modelAsked }
  }
}

/** Fallback after a failed / empty model call: payment text → hand-off; "model unavailable" → review (B1). */
export function fallbackHandoff(fb: { escalate: boolean; escalateReason: string }, inboundText: string): TurnHandoff | null {
  if (!fb.escalate) return null
  if (fb.escalateReason === 'payment_or_sinpe') return { kind: 'handoff', reason: paymentHandoffReason(inboundText) }
  return { kind: 'review', reason: HANDOFF_REASON.review }
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

/** Reasons a rewrite may fix. Not confirmation_wording: payment talk always goes to a person (SecureDog 2026-10-09). */
export const REPAIRABLE_REASONS: ReadonlySet<string> = new Set([
  'unsourced_money',
  'unsourced_amount',
  'money_mismatch_inventory',
  'deal_offer',
  'write_claim',
  'unit_cost_leak',
  'style_too_long',
  'results_claim',
  // Sleeping C9 / C7.
  'data_echo',
  'repeat_refusal',
  'foreign_link',
  'sold_out_offered',
  'restock_date_invented',
  'non_spanish_reply',
  'affirm_first',
])

const REPAIR_REASON_TEXT: Record<string, string> = {
  // SecureDog wave D r2 (M1): a reply in English / PT / FR with no payment in play is rewritten in Spanish (repairable).
  non_spanish_reply: 'respondiste en otro idioma; respondé en español de Costa Rica',
  // SecureDog wave D r4 (INT-206): in a payment chat a reply may not open with a yes (it reads as "your payment is fine").
  affirm_first: 'en un chat de pago no empieces con una palabra de acuerdo ni con un emoji solo (sí, claro, perfecto, listo, dale, genial, excelente, ok, exacto, de una, pura vida, por supuesto). Empezá directo con el dato o con una pregunta, sin afirmar nada sobre un pago',
  unsourced_money: 'pusiste un monto que no está en los precios / envíos de BETSY_DATOS ni en lo que consultaste',
  unsourced_amount: 'pusiste un número o monto que no sale de los datos',
  money_mismatch_inventory: 'el precio no coincide con el del producto',
  deal_offer: 'ofreciste un descuento o promoción que el negocio no tiene',
  write_claim: 'dijiste que ya creaste o registraste algo',
  unit_cost_leak: 'mencionaste un costo interno',
  style_too_long: 'quedó muy largo',
  foreign_link: 'pusiste un enlace que no es del sitio del negocio (no pongas enlaces)',
  data_echo: 'copiaste datos personales (nombre, teléfono, dirección) en vez de responder; respondé lo que el cliente necesita sin repetir datos de nadie',
  repeat_refusal: 'dijiste que ya lo habías dicho; el cliente lo volvió a preguntar: repetilo breve, sin decir que ya lo compartiste',
  sold_out_offered:
    'cerraste la venta de un producto AGOTADO (pediste datos o preguntaste cómo pagar); decí que está agotado, el "vuelve aprox." solo si la lista lo trae, y ofrecé un producto disponible sin pedir datos ni pago',
  restock_date_invented: 'diste una fecha de regreso que no está en la lista; usá solo el "vuelve aprox." de la lista o decí que todavía no hay fecha',
  results_claim:
    'prometiste un resultado o efecto (cambios, en cuántos días, lo que notan otras personas, curar o bajar de peso) o aseguraste que es seguro / sin efectos secundarios; decí solo los ingredientes y el modo de uso de los datos del negocio, que cada organismo responde diferente y que ante embarazo, lactancia, una condición o medicamentos consulte a su médico',
}

/** Rewrite request (B7): only reason names from code, never customer text. */
export function repairInstruction(reasons: string[]): string {
  const why = reasons.map((r) => REPAIR_REASON_TEXT[r]).filter(Boolean)
  return [
    `Tu respuesta anterior no se puede enviar: ${why.length ? why.join('; ') : 'rompe una regla fija'}.`,
    'Reescribila para el cliente arreglando eso: usá solo precios y montos de BETSY_DATOS o de lo que consultaste (si no tenés el dato, preguntá o decí que lo confirmás), sin descuentos inventados y sin decir que un pago está confirmado.',
    // Verifier final: "mismo tono" kept the "¡Perfecto!" opener on an affirm_first rewrite.
    reasons.includes('affirm_first') ? 'Corta, sin abrir con una palabra de acuerdo. Respondé solo el texto final para el cliente.' : 'Mismo tono y corta. Respondé solo el texto final para el cliente.',
  ].join(' ')
}

/** Key of the last saved reply the model fetched with use_shortcut (fallback when it forgot the tag). */
function lastUsedShortcutKey(trace: unknown[]): string | null {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    const row = trace[i] as Record<string, unknown> | null
    const result = row?.result as { key?: unknown } | undefined
    if (row?.name === 'use_shortcut' && row.ok === true && typeof result?.key === 'string') return result.key
  }
  return null
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
