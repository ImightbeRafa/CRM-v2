import OpenAI from 'openai';
import { z } from 'zod';
import { buildPromptCacheKey, buildXaiResponseBody, parseResponseText } from '@/lib/bot/xai-responses';
import type { CustomerPasteCandidate } from '@/lib/customer-paste';

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

const JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'phone', 'email', 'username', 'province', 'canton', 'district', 'address'],
  properties: Object.fromEntries(
    ['name', 'phone', 'email', 'username', 'province', 'canton', 'district', 'address']
      .map(key => [key, { type: 'string' }]),
  ),
};

export async function enhanceCustomerPasteWithGrok(input: {
  tenantId: string;
  userId: string;
  rawText: string;
  heuristic: CustomerPasteCandidate;
}) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_NOT_CONFIGURED');

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.x.ai/v1',
    timeout: 9_000,
    maxRetries: 0,
  });
  const body = buildXaiResponseBody({
    model: process.env.XAI_MODEL || 'grok-4.6',
    input: [{
      type: 'message',
      role: 'user',
      content: JSON.stringify({ rawText: input.rawText.slice(0, 6_000), heuristic: input.heuristic }),
    }],
    promptCacheKey: buildPromptCacheKey({
      tenantId: input.tenantId,
      platform: 'ventas-customer-paste',
      platformId: input.userId,
    }),
    maxOutputTokens: 700,
    temperature: 0,
    reasoningEffort: 'low',
    instructions: [
      'Extract only customer contact and Costa Rica delivery-address fields.',
      'Never invent missing values. Return an empty string when uncertain.',
      'Do not return products, prices, payment, order, inventory, invoice, or shipping actions.',
      'Keep the supplied heuristic value when it is clearly supported by the raw text.',
    ].join(' '),
    textFormat: { name: 'customer_paste_candidate', schema: JSON_SCHEMA, strict: true },
  });

  const response = await client.responses.create(
    body as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming,
    { timeout: 9_000, maxRetries: 0 },
  );
  return candidateSchema.parse(JSON.parse(parseResponseText(response)));
}

export type GrokCustomerPasteCandidate = z.infer<typeof candidateSchema>;
