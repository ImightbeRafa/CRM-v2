import 'server-only';

import { z } from 'zod';
import { LUNA_CHAT_AGENT_MODEL } from '@/lib/soft-ai/agent-types';
import { isSoftAiProviderConfigured, parseSoftAiResponseText, softAiResponsesCreate } from '@/lib/soft-ai/llm/client';
import type { CustomerPasteCandidate } from '@/lib/customer-paste';

/**
 * Ventas "Pegar cliente" AI clean-up. luna-10 (Rafael 2026-10-17: one model for the whole site): gpt-6-luna through
 * the inbox AI client (SOFT_AI_OPENAI_API_KEY, metered as 'customer_paste'). Never the staff bot's client or key.
 */
const candidateSchema = z.object({
  name: z.string().max(160),
  phone: z.string().max(40),
  email: z.string().max(254),
  username: z.string().max(160),
  province: z.string().max(80),
  canton: z.string().max(100),
  district: z.string().max(120),
  address: z.string().max(600),
}).strict();

const FIELDS = ['name', 'phone', 'email', 'username', 'province', 'canton', 'district', 'address'] as const;

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...FIELDS],
  properties: Object.fromEntries(FIELDS.map(key => [key, { type: 'string' }])),
};

export const CUSTOMER_PASTE_TIMEOUT_MS = 9_000;

export function isCustomerPasteAiConfigured(): boolean {
  return isSoftAiProviderConfigured(LUNA_CHAT_AGENT_MODEL);
}

export async function enhanceCustomerPasteWithAi(input: {
  tenantId: string;
  userId: string;
  rawText: string;
  heuristic: CustomerPasteCandidate;
}) {
  const response = await softAiResponsesCreate({
    model: LUNA_CHAT_AGENT_MODEL,
    instructions: [
      'Extract only customer contact and Costa Rica delivery-address fields.',
      'Never invent missing values. Return an empty string when uncertain.',
      'Do not return products, prices, payment, order, inventory, invoice, or shipping actions.',
      'Keep the supplied heuristic value when it is clearly supported by the raw text.',
    ].join(' '),
    input: [{
      type: 'message',
      role: 'user',
      content: JSON.stringify({ rawText: input.rawText.slice(0, 6_000), heuristic: input.heuristic }),
    }],
    // Extraction needs no reasoning: 'none' keeps it fast and deterministic (temperature 0).
    reasoningEffort: 'none',
    temperature: 0,
    maxOutputTokens: 700,
    timeoutMs: CUSTOMER_PASTE_TIMEOUT_MS,
    store: false,
    textFormat: { name: 'customer_paste_candidate', schema: JSON_SCHEMA, strict: true },
    usage: { tenantId: input.tenantId, feature: 'customer_paste', userId: input.userId },
  });
  return candidateSchema.parse(JSON.parse(parseSoftAiResponseText(response)));
}

export type AiCustomerPasteCandidate = z.infer<typeof candidateSchema>;
