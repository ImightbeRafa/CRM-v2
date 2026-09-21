/**
 * Probar request validation. History is client-supplied and untrusted.
 */

import { z } from 'zod'

export const TestHistoryMessageSchema = z.object({
  direction: z.enum(['inbound', 'outbound']),
  content: z.string().max(2000),
  sentAt: z.string().min(1).max(40),
})

export const AgentTestRequestSchema = z.object({
  inboundText: z.string().trim().min(1).max(2000),
  socialAccountId: z.string().trim().min(1).max(80),
  testSessionId: z.string().uuid(),
  messageType: z.enum(['text', 'image', 'audio', 'document', 'video']).default('text'),
  history: z.array(TestHistoryMessageSchema).max(40).default([]),
  windowOpen: z.boolean().optional(),
})

export type AgentTestRequest = z.infer<typeof AgentTestRequestSchema>

export function parseAgentTestRequest(raw: unknown): AgentTestRequest {
  const parsed = AgentTestRequestSchema.safeParse(raw)
  if (!parsed.success) throw new Error('TEST_REQUEST_INVALID')
  return parsed.data
}
