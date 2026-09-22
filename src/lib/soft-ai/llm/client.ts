/**
 * Soft-only xAI Responses client. Never imports staff bot; never reads WhatsApp env secrets.
 */

import OpenAI from 'openai'
import { DEFAULT_CHAT_AGENT_MODEL, isAllowedChatAgentModel } from '@/lib/soft-ai/agent-types'

export const SOFT_AI_XAI_BASE_URL = 'https://api.x.ai/v1'
export const SOFT_AI_FIRST_CALL_TIMEOUT_MS = 9_000
export const SOFT_AI_TOOL_FOLLOWUP_TIMEOUT_MS = 7_000
export const SOFT_AI_META_SEND_TIMEOUT_MS = 7_000

export function resolveSoftAiModel(override?: string | null): string {
  const fromEnv =
    typeof process.env.SOFT_AI_XAI_MODEL === 'string'
      ? process.env.SOFT_AI_XAI_MODEL.trim()
      : ''
  const candidate = (override || fromEnv || DEFAULT_CHAT_AGENT_MODEL).trim()
  if (!isAllowedChatAgentModel(candidate)) {
    throw new Error('SOFT_AI_MODEL_NOT_ALLOWED')
  }
  return candidate
}

export function createSoftAiXaiClient(timeoutMs = SOFT_AI_FIRST_CALL_TIMEOUT_MS) {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) throw new Error('XAI_NOT_CONFIGURED')
  return new OpenAI({
    apiKey,
    baseURL: SOFT_AI_XAI_BASE_URL,
    timeout: timeoutMs,
    maxRetries: 0,
  })
}

export type SoftAiResponsesCreateArgs = {
  model: string
  instructions: string
  input: unknown[]
  tools?: unknown[]
  promptCacheKey?: string
  maxOutputTokens?: number
  temperature?: number
  reasoningEffort?: 'low' | 'medium' | 'high'
  timeoutMs?: number
  store?: boolean
}

export async function softAiResponsesCreate(args: SoftAiResponsesCreateArgs) {
  const model = resolveSoftAiModel(args.model)
  const timeoutMs = args.timeoutMs ?? SOFT_AI_FIRST_CALL_TIMEOUT_MS
  const client = createSoftAiXaiClient(timeoutMs)
  const body: Record<string, unknown> = {
    model,
    instructions: args.instructions,
    input: args.input,
    store: args.store === true ? true : false,
    temperature: args.temperature ?? 0.1,
    max_output_tokens: args.maxOutputTokens ?? 700,
    reasoning: { effort: args.reasoningEffort ?? 'low' },
  }
  if (args.tools && args.tools.length > 0) body.tools = args.tools
  if (args.promptCacheKey) body.prompt_cache_key = args.promptCacheKey

  return client.responses.create(
    body as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming,
    { timeout: timeoutMs, maxRetries: 0 },
  )
}

export function parseSoftAiResponseText(response: unknown): string {
  if (!response || typeof response !== 'object') return ''
  const r = response as {
    output_text?: string
    output?: Array<{
      type?: string
      content?: Array<{ type?: string; text?: string }>
    }>
  }
  if (typeof r.output_text === 'string' && r.output_text.trim()) {
    return r.output_text.trim()
  }
  const chunks: string[] = []
  for (const item of r.output || []) {
    if (item.type !== 'message') continue
    for (const part of item.content || []) {
      if (part.type === 'output_text' && typeof part.text === 'string') {
        chunks.push(part.text)
      }
    }
  }
  return chunks.join('\n').trim()
}

export function extractSoftAiFunctionCalls(response: unknown): Array<{
  callId: string
  name: string
  argumentsJson: string
}> {
  if (!response || typeof response !== 'object') return []
  const r = response as {
    output?: Array<{
      type?: string
      call_id?: string
      id?: string
      name?: string
      arguments?: string
    }>
  }
  const out: Array<{ callId: string; name: string; argumentsJson: string }> = []
  for (const item of r.output || []) {
    if (item.type !== 'function_call') continue
    const callId = item.call_id || item.id || ''
    const name = item.name || ''
    if (!callId || !name) continue
    out.push({
      callId,
      name,
      argumentsJson: typeof item.arguments === 'string' ? item.arguments : '{}',
    })
  }
  return out
}

export function readSoftAiUsage(response: unknown): {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningTokens: number
} {
  const usage =
    response && typeof response === 'object'
      ? ((response as { usage?: Record<string, unknown> }).usage || {})
      : {}
  const inputTokens = Number(usage.input_tokens || usage.prompt_tokens || 0) || 0
  const outputTokens = Number(usage.output_tokens || usage.completion_tokens || 0) || 0
  const cachedInputTokens =
    Number(
      (usage.input_tokens_details as { cached_tokens?: number } | undefined)
        ?.cached_tokens ||
        usage.cached_tokens ||
        0,
    ) || 0
  const reasoningTokens =
    Number(
      (usage.output_tokens_details as { reasoning_tokens?: number } | undefined)
        ?.reasoning_tokens || 0,
    ) || 0
  return { inputTokens, cachedInputTokens, outputTokens, reasoningTokens }
}
