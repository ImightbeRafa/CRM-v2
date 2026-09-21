/**
 * Soft Agent Layer A1 tool definitions (Responses API function schemas).
 */

import { A1_TOOL_NAMES, type A1ToolName } from '@/lib/soft-ai/agent-types'

export type SoftAiToolDefinition = {
  type: 'function'
  name: A1ToolName
  description: string
  parameters: Record<string, unknown>
  strict?: boolean
}

const TOOL_DEFS: Record<A1ToolName, SoftAiToolDefinition> = {
  search_inventory: {
    type: 'function',
    name: 'search_inventory',
    description:
      'Busca productos activos del inventario del tenant. Devuelve nombre, sku, stock y precio de venta en CRC. Nunca unitCost.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Texto a buscar (nombre, sku, categoría)' },
      },
      required: ['query'],
    },
    strict: true,
  },
  get_order_status: {
    type: 'function',
    name: 'get_order_status',
    description:
      'Consulta el estado de un pedido del cliente de esta conversación. No reveles pedidos ajenos.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        orderNumberHint: {
          type: 'string',
          description: 'Número o id de pedido mencionado por el cliente',
        },
      },
      required: ['orderNumberHint'],
    },
    strict: true,
  },
  get_shipping_status: {
    type: 'function',
    name: 'get_shipping_status',
    description:
      'Consulta la guía / estado de envío Correos para un pedido del cliente de esta conversación.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        orderNumberHint: { type: 'string' },
        guiaNumber: { type: 'string' },
      },
      required: [],
    },
    strict: true,
  },
  escalate_to_human: {
    type: 'function',
    name: 'escalate_to_human',
    description:
      'Pasa la conversación a un humano. Usá para pagos, media, opt-out, o cuando no podés ayudar con certeza.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        reason: {
          type: 'string',
          description:
            'payment_or_sinpe | media_inbound | opt_out | llm_unavailable | ownership | other',
        },
        note: { type: 'string' },
      },
      required: ['reason'],
    },
    strict: true,
  },
}

export function softAiToolDefinitions(
  enabledTools: readonly string[],
): SoftAiToolDefinition[] {
  const allow = new Set(
    enabledTools.filter((t): t is A1ToolName =>
      (A1_TOOL_NAMES as readonly string[]).includes(t),
    ),
  )
  // escalate_to_human is always available for safety.
  allow.add('escalate_to_human')
  return A1_TOOL_NAMES.filter((n) => allow.has(n)).map((n) => TOOL_DEFS[n])
}
