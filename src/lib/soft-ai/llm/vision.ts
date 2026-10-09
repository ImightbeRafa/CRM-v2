/**
 * Image input for the inbox AI (F3: product photos in "Crear desde fuentes"; later customer photos).
 * Uses the same metered Responses client. Which model actually reads images is verified in production with the
 * owner's "Probar lectura de imágenes" button (/super-admin/ia) — the first allowlisted model that passes wins.
 */
import 'server-only'

import { softAiResponsesCreate, parseSoftAiResponseText } from '@/lib/soft-ai/llm/client'
import { DEFAULT_CHAT_AGENT_MODEL, LUNA_CHAT_AGENT_MODEL } from '@/lib/soft-ai/agent-types'

/** Order of preference. Both are on the agent model allowlist (provider keys already configured). */
export const VISION_MODEL_CANDIDATES = [DEFAULT_CHAT_AGENT_MODEL, LUNA_CHAT_AGENT_MODEL] as const

export type VisionImage = { mime: 'image/jpeg' | 'image/png'; base64: string }

/** One user message with text + images (data URLs; nothing is uploaded anywhere else). */
export function buildImageInput(prompt: string, images: VisionImage[]): unknown[] {
  return [
    {
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        ...images.map((img) => ({
          type: 'input_image',
          image_url: `data:${img.mime};base64,${img.base64}`,
          detail: 'high',
        })),
      ],
    },
  ]
}

/** Vision model to use: an env override (must be a candidate) or the first candidate. */
export function resolveVisionModel(): string {
  const env = (process.env.SOFT_AI_VISION_MODEL || '').trim()
  return (VISION_MODEL_CANDIDATES as readonly string[]).includes(env) ? env : VISION_MODEL_CANDIDATES[0]
}

export async function describeImages(input: {
  model?: string
  instructions: string
  prompt: string
  images: VisionImage[]
  schema: { name: string; schema: Record<string, unknown> }
  usage: { tenantId: string | null; agentId?: string | null; userId?: string | null }
  maxOutputTokens?: number
  timeoutMs?: number
}): Promise<{ text: string; model: string }> {
  const model = input.model || resolveVisionModel()
  const response = await softAiResponsesCreate({
    model,
    instructions: input.instructions,
    input: buildImageInput(input.prompt, input.images),
    store: false,
    temperature: 0,
    reasoningEffort: 'low',
    maxOutputTokens: input.maxOutputTokens ?? 1500,
    timeoutMs: input.timeoutMs ?? 45_000,
    textFormat: { name: input.schema.name, schema: input.schema.schema },
    usage: { tenantId: input.usage.tenantId, feature: 'vision', agentId: input.usage.agentId, userId: input.usage.userId },
  })
  return { text: parseSoftAiResponseText(response), model }
}
