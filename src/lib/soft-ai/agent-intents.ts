/** Fixed intent enum for the Soft Agent Layer. */

export const AGENT_INTENTS = [
  'greeting',
  'price',
  'stock',
  'catalog_photo',
  'how_to_buy',
  'shipping_info',
  'payment_info',
  'payment_proof',
  'order_status',
  'hours_location',
  'website',
  'returns_policy',
  'offtopic',
  'human_request',
  'other',
] as const

export type AgentIntent = (typeof AGENT_INTENTS)[number]

export function isAgentIntent(value: string): value is AgentIntent {
  return (AGENT_INTENTS as readonly string[]).includes(value)
}
