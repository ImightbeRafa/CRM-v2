/**
 * OpenAI Responses API helpers for the Betsy staff bot (gpt-6-luna, luna-10).
 *
 * Chat Completions is legacy. Local conversation-memory stays the source of
 * truth (pending confirmations, sanitized history). Every request uses
 * store:false so the provider does not retain WhatsApp/Telegram PII.
 * Tool follow-ups replay in-memory output items plus function_call_output;
 * we never send previous_response_id (that requires store:true).
 */

import { createHmac } from 'crypto';
import type OpenAI from 'openai';

export type StaffBotReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export type NormalizedFunctionCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ResponsesFunctionTool = {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
};

function promptCacheSecret(): string {
  return process.env.NEXTAUTH_SECRET || 'betsy-ai-cache';
}

export function buildPromptCacheKey(parts: {
  tenantId?: string;
  platform: string;
  platformId: string;
}): string {
  const material = [
    parts.tenantId || 'unknown-tenant',
    parts.platform,
    parts.platformId,
  ].join(':');
  const digest = createHmac('sha256', promptCacheSecret())
    .update(material)
    .digest('hex')
    .slice(0, 32);
  return `betsy:${digest}`;
}

export function toResponsesInputMessages(
  history: Array<{ role: string; content: string }>,
): OpenAI.Responses.EasyInputMessage[] {
  return history
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      type: 'message' as const,
      role: message.role as 'user' | 'assistant',
      content: message.content,
    }));
}

export function parseResponseFunctionCalls(
  response: Pick<OpenAI.Responses.Response, 'output'>,
): NormalizedFunctionCall[] {
  const calls: NormalizedFunctionCall[] = [];
  for (const item of response.output) {
    if (item.type !== 'function_call') continue;
    calls.push({
      id: item.call_id,
      name: item.name,
      arguments: item.arguments,
    });
  }
  return calls;
}

export function parseResponseText(
  response: Pick<OpenAI.Responses.Response, 'output' | 'output_text'>,
): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  const chunks: string[] = [];
  for (const item of response.output) {
    if (item.type !== 'message') continue;
    for (const content of item.content) {
      if (content.type === 'output_text' && content.text) {
        chunks.push(content.text);
      }
    }
  }
  return chunks.join('\n');
}

export function toFunctionCallOutputs(
  calls: Array<{ id: string }>,
  results: string[],
): OpenAI.Responses.ResponseInputItem.FunctionCallOutput[] {
  return calls.map((call, index) => ({
    type: 'function_call_output' as const,
    call_id: call.id,
    output: results[index] || '',
  }));
}

export function buildToolFollowUpInput(
  priorOutput: OpenAI.Responses.Response['output'],
  toolOutputs: OpenAI.Responses.ResponseInputItem.FunctionCallOutput[],
): OpenAI.Responses.ResponseInput {
  return [...priorOutput, ...toolOutputs];
}

export type StaffBotResponseBody = {
  model: string;
  input: OpenAI.Responses.ResponseInput;
  max_output_tokens: number;
  temperature?: number;
  reasoning: { effort: StaffBotReasoningEffort };
  prompt_cache_key: string;
  store: false;
  include?: Array<'reasoning.encrypted_content'>;
  instructions?: string;
  tools?: ResponsesFunctionTool[];
  tool_choice?: 'auto' | 'required';
  text?: {
    format: {
      type: 'json_schema';
      name: string;
      schema: Record<string, unknown>;
      strict: boolean;
    };
  };
};

export function buildStaffBotResponseBody(args: {
  model: string;
  input: OpenAI.Responses.ResponseInput;
  promptCacheKey: string;
  maxOutputTokens: number;
  temperature: number;
  reasoningEffort: StaffBotReasoningEffort;
  includeEncryptedReasoning?: boolean;
  instructions?: string;
  tools?: ResponsesFunctionTool[];
  toolChoice?: 'auto' | 'required';
  textFormat?: {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
  };
}): StaffBotResponseBody {
  // OpenAI reasoning models (gpt-6-luna): temperature only with reasoning 'none'; otherwise the reasoning tokens
  // count against max_output_tokens (room is added) and, with store:false, a tool follow-up must replay the
  // encrypted reasoning items — so they are always requested.
  const reasoningOn = args.reasoningEffort !== 'none';
  const headroom = !reasoningOn ? 0 : args.reasoningEffort === 'low' ? 800 : args.reasoningEffort === 'medium' ? 1_800 : 3_500;
  const body: StaffBotResponseBody = {
    model: args.model,
    input: args.input,
    max_output_tokens: args.maxOutputTokens + headroom,
    reasoning: { effort: args.reasoningEffort },
    prompt_cache_key: args.promptCacheKey,
    store: false,
  };
  if (!reasoningOn) body.temperature = args.temperature;

  if (reasoningOn || args.includeEncryptedReasoning) {
    body.include = ['reasoning.encrypted_content'];
  }
  if (args.instructions) body.instructions = args.instructions;
  if (args.tools) body.tools = args.tools;
  if (args.toolChoice) body.tool_choice = args.toolChoice;
  if (args.textFormat) {
    body.text = {
      format: {
        type: 'json_schema',
        name: args.textFormat.name,
        schema: args.textFormat.schema,
        strict: args.textFormat.strict ?? true,
      },
    };
  }

  return body;
}
